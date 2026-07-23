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
  `You are a spatial-reasoning assistant reconstructing a real room as a proportioned rectangular box ` +
  `(a cube map with distinct wall lengths) for a 3D walkthrough. The six faces are: front, back, left and right walls, ` +
  `top (ceiling) and bottom (floor). Study the numbered photos above — all taken inside the same room.\n\n` +
  `1. "photos": classify every photo's role:\n` +
  `   - "wall": a straight-on view DOMINATED by exactly one surface, usable as the full texture for that face. Set "face" to that face.\n` +
  `   - "overview": a wide, corner, or down-the-length view showing MULTIPLE surfaces (great for understanding the layout, unusable as a single face). Set "face" to "none".\n` +
  `   - "closeup": a narrow detail crop of part of a surface (furniture, a corner, appliances). Set "face" to "none".\n` +
  `   - "unknown": unusable. Set "face" to "none".\n` +
  `   Be strict: when in doubt between "wall" and "overview"/"closeup", do NOT choose "wall". ` +
  `Never assign two photos to the same face. Only a straight-DOWN floor-dominated shot may be "bottom"; only a straight-UP ceiling-dominated shot may be "top". ` +
  `Photos not assigned to a face are still used as reference imagery for generation, so nothing is wasted.\n` +
  `2. "dimensions": the room's relative proportions, each a number from 1 to 3 — "width" (length of the front/back walls), ` +
  `"depth" (length of the left/right walls), "height". Example: a long narrow studio seen down its length might be width 1, depth 2.5, height 1.2. ` +
  `Use overview photos and shared landmarks to judge this.\n` +
  `3. "roomDescription": a dense, concrete brief for an image generator covering ALL SIX faces of the box: ` +
  `architectural style, wall/floor/ceiling colors and materials, lighting direction and warmth, which walls are long vs short, ` +
  `and for each face exactly what belongs on it (furniture, doors, windows, art). State each object's single true location ONCE ` +
  `so it is never duplicated onto other faces. Note what should logically appear on faces no photo shows (light sources, continuation of flooring).\n` +
  `4. "reasoning": 2-4 friendly sentences for the end user summarizing what you recognized and how you decided the layout.`;

/** Response schema shared by both analysis providers (Gemini + OpenAI). */
export const ANALYSIS_SCHEMA_PROPERTIES = {
  photos: {
    type: 'array',
    items: {
      type: 'object',
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
    properties: {
      width: { type: 'number' },
      depth: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['width', 'depth', 'height'],
  },
  roomDescription: { type: 'string' },
  reasoning: { type: 'string' },
};

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
        properties: ANALYSIS_SCHEMA_PROPERTIES,
        required: ['photos', 'dimensions', 'roomDescription', 'reasoning'],
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
export function buildFacePrompt(face, roomDescription = '') {
  return (
    `These reference photos all show the same real room (some straight-on wall views, some overviews or close-up details). ` +
    (roomDescription ? `Analysis of the room: ${roomDescription}\n\n` : '') +
    `The room is a rectangular box. Generate a single photorealistic image of ONLY this room's ${FACE_LABELS[face]}, ` +
    `viewed straight-on and filling the entire frame, as if standing in the middle of the room facing it. ` +
    `Match the lighting, color palette, materials, architectural style and furnishings of the reference photos exactly ` +
    `so the new image blends seamlessly with the other faces. ` +
    `IMPORTANT: include only what belongs on the ${FACE_LABELS[face]} according to the analysis — ` +
    `do NOT duplicate furniture or objects that belong on other surfaces onto this one. ` +
    `Do not include any text, borders, people or watermarks. Output only the image.`
  );
}

/** Prompt for the single seamless 360° equirectangular room panorama. */
export function buildPanoPrompt(roomDescription = '') {
  return (
    `Using the attached reference photos of a real room, generate ONE seamless 360-degree equirectangular panorama ` +
    `of that exact room, as seen from eye level at the very center of the room. ` +
    (roomDescription ? `Analysis of the room: ${roomDescription}\n\n` : '') +
    `Requirements: full 360° horizontal wrap — the left and right edges of the image must line up perfectly when wrapped around a sphere; ` +
    `the ceiling stretches across the top of the image and the floor across the bottom; ` +
    `reproduce the room's ACTUAL layout, furniture, materials, colors and lighting exactly as shown in the reference photos; ` +
    `every piece of furniture and every feature appears exactly once, in its true position; ` +
    `walls flow continuously into each other with correct perspective. ` +
    `Photorealistic. No text, borders, people or watermarks.`
  );
}

/**
 * Generates the full 360° panorama as a data URL via Gemini, or null if the
 * model returned no image.
 */
export async function generatePanorama(ai, model, referenceParts, roomDescription = '') {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [...referenceParts, { text: buildPanoPrompt(roomDescription) }] }],
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

/**
 * Prompt for judging the wrap seam. The client rotates the panorama so the
 * wrap junction runs down the exact vertical center of the image.
 */
export const SEAM_REVIEW_PROMPT =
  `This image is a 360° equirectangular room panorama that has been rotated so that its WRAP JUNCTION ` +
  `(where the panorama's right edge meets its left edge) runs down the exact vertical CENTER of the image. ` +
  `Judge whether the room reads as one continuous space across that center line: ` +
  `walls must continue at consistent height and color, floor and baseboard lines must align, ` +
  `furniture must not be cut off or abruptly change, lighting and perspective must flow naturally. ` +
  `Minor texture noise is acceptable. Mismatched walls, misaligned floor lines, duplicated or truncated ` +
  `furniture, or an obvious vertical "cut" are failures. ` +
  `Respond with "seamless" (boolean) and "problems" (short concrete description of what breaks at the center line, or empty string if seamless).`;

export const SEAM_SCHEMA_PROPERTIES = {
  seamless: { type: 'boolean' },
  problems: { type: 'string' },
};

/** Prompt for repairing a discontinuous wrap seam (image is center-rolled). */
export function buildSeamFixPrompt(problems = '', roomDescription = '') {
  return (
    `This is a 360° equirectangular panorama of a room, rotated so that its wrap junction runs down the exact vertical center of the image. ` +
    `The center line currently has a visible discontinuity. ` +
    (problems ? `Observed problems: ${problems}\n\n` : '') +
    (roomDescription ? `The room, for context: ${roomDescription}\n\n` : '') +
    `Repair ONLY the area around the vertical center so the room reads as one continuous space: ` +
    `align wall planes, colors and heights, make floor and baseboard lines meet exactly, complete any furniture that is cut off ` +
    `(or remove the partial duplicate), and blend lighting smoothly. ` +
    `Keep everything near the left and right edges of the image UNCHANGED, keep the same image dimensions, ` +
    `and remember the outer left and right edges must still wrap seamlessly with each other. ` +
    `Photorealistic. No text, borders, people or watermarks.`
  );
}

/** Gemini seam review — returns { seamless, problems }. */
export async function reviewSeam(ai, model, imagePart) {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [imagePart, { text: SEAM_REVIEW_PROMPT }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: SEAM_SCHEMA_PROPERTIES,
        required: ['seamless', 'problems'],
      },
    },
  });
  const text = response.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('The review model returned an unreadable response.');
  }
}

/** Gemini seam repair — returns a data URL or null. */
export async function fixSeam(ai, model, imagePart, problems = '', roomDescription = '') {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [imagePart, { text: buildSeamFixPrompt(problems, roomDescription) }] }],
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

export async function generateFace(ai, model, face, referenceParts, roomDescription = '') {
  const prompt = buildFacePrompt(face, roomDescription);

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
