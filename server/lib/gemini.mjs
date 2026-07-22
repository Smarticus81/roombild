import { GoogleGenAI } from '@google/genai';

export const FACE_KEYS = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export const FACE_LABELS = {
  front: 'front wall',
  back: 'back wall',
  left: 'left wall',
  right: 'right wall',
  top: 'ceiling',
  bottom: 'floor',
};

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_TEXT_MODEL = 'gemini-flash-latest';

export function createClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/** Shared instructions for the photo-analysis (image reasoning) step. */
export const ANALYZE_PROMPT =
  `You are a spatial-reasoning assistant reconstructing a real room as a cube map for a 3D walkthrough. ` +
  `The cube has six faces: front, back, left and right walls, top (ceiling) and bottom (floor). ` +
  `Study the numbered photos above — they were all taken inside the same room.\n\n` +
  `1. For each photo, decide which single cube face it best represents (the surface that dominates the frame). ` +
  `Use "unknown" if a photo is not a usable straight-on view of one surface. ` +
  `Assign each face to at most one photo — pick the best candidate if several qualify. ` +
  `Pay attention to shared furniture, windows, doors and lighting to work out how the views relate spatially.\n` +
  `2. Write "roomDescription": a dense, concrete description of the room to brief an image generator — ` +
  `architectural style, wall/floor/ceiling colors and materials, lighting direction and warmth, furniture and where it sits relative to the assigned walls, ` +
  `and what should logically appear on each MISSING face so the reconstructed room stays consistent (e.g. the source of visible light, continuation of flooring).\n` +
  `3. Write "reasoning": 2-4 friendly sentences for the end user summarizing what you recognized and how you decided the layout.`;

/**
 * Reasoning step: looks at the uploaded photos, decides which cube face each
 * one shows, and produces a rich room description to steer image generation.
 * `photoParts` is an ordered list of inlineData parts (photo 0, photo 1, ...).
 * Returns { assignments: [{ photoIndex, face }], roomDescription, reasoning }.
 */
export async function analyzeRoom(ai, model, photoParts) {
  const numbered = photoParts.flatMap((part, i) => [{ text: `Photo ${i}:` }, part]);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [...numbered, { text: ANALYZE_PROMPT }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          assignments: {
            type: 'array',
            items: {
              type: 'object',
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
      },
    },
  });

  const text = response.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in prose or fences — salvage the outermost object.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('The analysis model returned an unreadable response.');
  }
}

/**
 * Generates one missing face of the room as a data URL, or null if the model
 * returned no image. `referenceParts` are the labeled inlineData photo parts
 * (originals plus any faces generated earlier, for coherence).
 */
export async function generateFace(ai, model, face, referenceParts, roomDescription = '') {
  const prompt =
    `These reference photos all show the same real room, viewed straight-on at different surfaces. ` +
    (roomDescription ? `Analysis of the room: ${roomDescription}\n\n` : '') +
    `Generate a single photorealistic image of this room's ${FACE_LABELS[face]}, viewed straight-on ` +
    `and filling the entire frame, as if standing in the middle of the room facing it. ` +
    `Match the lighting, color palette, materials, architectural style and furnishings of the reference photos exactly ` +
    `so the new image blends seamlessly with them as one face of a cube-mapped room. ` +
    `Do not include any text, borders, people or watermarks. Output only the image.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [...referenceParts, { text: prompt }] }],
  });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

/** Translate a Gemini API failure into a user-facing status + message. */
export function describeApiError(err) {
  const status = err?.status;
  if (status === 429) {
    return {
      status: 429,
      message:
        'The Gemini API key has no remaining quota for this model. ' +
        'Image generation requires a Google AI project with billing enabled — ' +
        'check your plan at https://aistudio.google.com.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      message: 'The Gemini API key was rejected. Check GEMINI_API_KEY on the server.',
    };
  }
  return {
    status: 502,
    message: 'The AI model did not return a usable result. Please try again.',
  };
}
