import { FACE_KEYS, FACE_LABELS, ANALYZE_PROMPT } from './gemini.mjs';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.1';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1.5';
const FALLBACK_OPENAI_IMAGE_MODEL = 'gpt-image-1';

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          photoIndex: { type: 'integer' },
          face: { type: 'string', enum: [...FACE_KEYS, 'unknown'] },
        },
        required: ['photoIndex', 'face'],
      },
    },
    roomDescription: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['assignments', 'roomDescription', 'reasoning'],
};

/**
 * Image-reasoning step via OpenAI's Responses API. Same contract as the
 * Gemini analyzeRoom: takes ordered photos [{ mimeType, base64 }] and returns
 * { assignments, roomDescription, reasoning }.
 * `effort` defaults to "low" to stay inside serverless time limits.
 */
export async function analyzeRoomOpenAI(apiKey, model, photos, { effort = 'low' } = {}) {
  const content = photos.flatMap((photo, i) => [
    { type: 'input_text', text: `Photo ${i}:` },
    { type: 'input_image', image_url: `data:${photo.mimeType};base64,${photo.base64}` },
  ]);
  content.push({ type: 'input_text', text: ANALYZE_PROMPT });

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      reasoning: { effort },
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'room_analysis',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const message = (data.output ?? []).find((item) => item.type === 'message');
  const text = (message?.content ?? []).find((c) => c.type === 'output_text')?.text ?? '';
  if (!text) {
    throw new Error('OpenAI returned no text output for the analysis request.');
  }
  return JSON.parse(text);
}

/**
 * Face generation via OpenAI's Images Edits API — used as fallback when
 * Gemini's image quota is exhausted. `references` is an ordered list of
 * { face, mimeType, base64 } for the already-known faces. Returns a data URL,
 * or null if the model produced nothing. If the configured model is not
 * available on this account, retries once with the older gpt-image-1.
 */
export async function generateFaceOpenAI(apiKey, model, face, references, roomDescription = '', { quality = 'medium' } = {}) {
  const labels = references.map((r) => FACE_LABELS[r.face] ?? r.face);
  const prompt =
    `The attached reference photos show surfaces of the same real room, in this order: ${labels.join(', ')}. ` +
    (roomDescription ? `Analysis of the room: ${roomDescription}\n\n` : '') +
    `Generate a single photorealistic image of this room's ${FACE_LABELS[face]}, viewed straight-on ` +
    `and filling the entire frame, as if standing in the middle of the room facing it. ` +
    `Match the lighting, color palette, materials, architectural style and furnishings of the reference photos exactly ` +
    `so the new image blends seamlessly with them as one face of a cube-mapped room. ` +
    `Do not include any text, borders, people or watermarks.`;

  const attempt = async (m) => {
    const form = new FormData();
    form.append('model', m);
    form.append('prompt', prompt.slice(0, 30000));
    form.append('size', '1024x1024');
    form.append('quality', quality);
    form.append('input_fidelity', 'high');
    for (const ref of references) {
      form.append(
        'image[]',
        new Blob([Buffer.from(ref.base64, 'base64')], { type: ref.mimeType }),
        `${ref.face}.jpg`,
      );
    }
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`OpenAI image API error ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  };

  try {
    return await attempt(model);
  } catch (err) {
    const modelProblem =
      (err.status === 400 || err.status === 404) && /model/i.test(err.body ?? '');
    if (model !== FALLBACK_OPENAI_IMAGE_MODEL && modelProblem) {
      console.warn(`OpenAI model "${model}" unavailable, retrying with ${FALLBACK_OPENAI_IMAGE_MODEL}`);
      return attempt(FALLBACK_OPENAI_IMAGE_MODEL);
    }
    throw err;
  }
}
