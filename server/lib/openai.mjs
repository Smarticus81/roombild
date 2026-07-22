import { FACE_KEYS, FACE_LABELS, ANALYZE_PROMPT, buildFacePrompt, buildPanoPrompt } from './gemini.mjs';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
const FALLBACK_OPENAI_IMAGE_MODEL = 'gpt-image-1.5';

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          photoIndex: { type: 'integer' },
          role: { type: 'string', enum: ['wall', 'overview', 'closeup', 'unknown'] },
          face: { type: 'string', enum: [...FACE_KEYS, 'none'] },
        },
        required: ['photoIndex', 'role', 'face'],
      },
    },
    dimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'number' },
        depth: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['width', 'depth', 'height'],
    },
    roomDescription: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['photos', 'dimensions', 'roomDescription', 'reasoning'],
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

async function imagesEditRequest(apiKey, model, prompt, photos, { quality, size }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt.slice(0, 30000));
  form.append('size', size);
  form.append('quality', quality);
  form.append('input_fidelity', 'high');
  for (const [i, photo] of photos.entries()) {
    form.append(
      'image[]',
      new Blob([Buffer.from(photo.base64, 'base64')], { type: photo.mimeType }),
      `photo${i}.jpg`,
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
}

const isModelProblem = (err) =>
  (err?.status === 400 || err?.status === 404) && /model/i.test(err?.body ?? '');
const isSizeProblem = (err) => err?.status === 400 && /size/i.test(err?.body ?? '');

/**
 * Single seamless 360° equirectangular panorama via OpenAI's Images Edits
 * API. Tries a 2:1 equirect size first, dropping to 1536x1024 if the model
 * rejects it, and downgrades the model once if the configured one is
 * unavailable. Returns a data URL or null.
 */
export async function generatePanoramaOpenAI(apiKey, model, photos, roomDescription = '', { quality = 'medium', size = '2048x1024' } = {}) {
  const prompt = buildPanoPrompt(roomDescription);
  const attempt = async (m, s) => {
    try {
      return await imagesEditRequest(apiKey, m, prompt, photos, { quality, size: s });
    } catch (err) {
      if (isSizeProblem(err) && s !== '1536x1024') {
        console.warn(`OpenAI rejected size ${s}, retrying at 1536x1024`);
        return imagesEditRequest(apiKey, m, prompt, photos, { quality, size: '1536x1024' });
      }
      throw err;
    }
  };
  try {
    return await attempt(model, size);
  } catch (err) {
    if (model !== FALLBACK_OPENAI_IMAGE_MODEL && isModelProblem(err)) {
      console.warn(`OpenAI model "${model}" unavailable, retrying with ${FALLBACK_OPENAI_IMAGE_MODEL}`);
      return attempt(FALLBACK_OPENAI_IMAGE_MODEL, size);
    }
    throw err;
  }
}

/**
 * Face generation via OpenAI's Images Edits API — used as fallback when
 * Gemini's image quota is exhausted. `references` is an ordered list of
 * { face, mimeType, base64 } for the already-known faces. Returns a data URL,
 * or null if the model produced nothing. If the configured model is not
 * available on this account, retries once with the older gpt-image-1.
 */
export async function generateFaceOpenAI(apiKey, model, face, references, roomDescription = '', { quality = 'medium', size = '1024x1024' } = {}) {
  const labels = references.map((r) => FACE_LABELS[r.face] ?? 'additional reference view');
  const prompt =
    `The attached reference photos show the same real room, in this order: ${labels.join(', ')}. ` +
    buildFacePrompt(face, roomDescription);

  const attempt = async (m) => {
    const form = new FormData();
    form.append('model', m);
    form.append('prompt', prompt.slice(0, 30000));
    form.append('size', size);
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
