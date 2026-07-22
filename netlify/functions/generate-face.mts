import type { Config } from '@netlify/functions';
import {
  FACE_KEYS,
  FACE_LABELS,
  DEFAULT_IMAGE_MODEL,
  createClient,
  generateFace,
  describeApiError,
} from '../../server/lib/gemini.mjs';
import { DEFAULT_OPENAI_IMAGE_MODEL, generateFaceOpenAI } from '../../server/lib/openai.mjs';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed.' });
  }

  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json(500, { success: false, error: 'GEMINI_API_KEY is not configured on the server.' });
  }
  const model = Netlify.env.get('GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { success: false, error: 'Expected multipart form data.' });
  }

  const files: Partial<Record<string, File>> = {};
  for (const key of FACE_KEYS) {
    const value = form.get(key);
    if (value instanceof File) {
      if (value.size > MAX_FILE_BYTES) {
        return json(400, { success: false, error: `The ${key} photo is over 20MB.` });
      }
      if (!/^image\/(jpeg|png|webp)$/.test(value.type)) {
        return json(400, { success: false, error: `The ${key} photo must be JPEG, PNG or WebP.` });
      }
      files[key] = value;
    }
  }

  const provided = FACE_KEYS.filter((k: string) => files[k]);
  const extraFiles = form.getAll('references').filter((v): v is File => v instanceof File).slice(0, FACE_KEYS.length);
  for (const file of extraFiles) {
    if (file.size > MAX_FILE_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return json(400, { success: false, error: 'Reference photos must be JPEG/PNG/WebP under 20MB.' });
    }
  }
  if (provided.length === 0 && extraFiles.length === 0) {
    return json(400, { success: false, error: 'Provide at least one reference photo.' });
  }

  const face = String(form.get('face') ?? '');
  if (!FACE_KEYS.includes(face) || provided.includes(face)) {
    return json(400, { success: false, error: 'Invalid face requested.' });
  }
  const roomDescription = String(form.get('roomDescription') ?? '').slice(0, 6000);

  try {
    const references = [
      ...(await Promise.all(
        provided.map(async (key: string) => {
          const file = files[key] as File;
          return {
            face: key,
            mimeType: file.type,
            base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
          };
        }),
      )),
      ...(await Promise.all(
        extraFiles.map(async (file, i) => ({
          face: `reference${i}`,
          mimeType: file.type,
          base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
        })),
      )),
    ];
    const referenceParts = references.flatMap((ref) => [
      {
        text: FACE_LABELS[ref.face as keyof typeof FACE_LABELS]
          ? `Reference photo — the ${FACE_LABELS[ref.face as keyof typeof FACE_LABELS]} of the room:`
          : `Additional reference photo of the same room (overview or close-up detail):`,
      },
      { inlineData: { mimeType: ref.mimeType, data: ref.base64 } },
    ]);

    let image: string | null = null;
    let provider = 'gemini';
    let geminiError: unknown = null;
    try {
      const ai = createClient(apiKey);
      image = await generateFace(ai, model, face, referenceParts, roomDescription);
    } catch (err) {
      geminiError = err;
    }

    // Gemini quota exhausted (or any other failure): fall back to OpenAI's
    // latest image model when a key is configured.
    const openaiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!image && openaiKey) {
      if (geminiError) {
        console.warn('Gemini generation failed, falling back to OpenAI:', geminiError);
      }
      image = await generateFaceOpenAI(
        openaiKey,
        Netlify.env.get('OPENAI_IMAGE_MODEL') || DEFAULT_OPENAI_IMAGE_MODEL,
        face,
        references,
        roomDescription,
        {
          quality: Netlify.env.get('OPENAI_IMAGE_QUALITY') || 'medium',
          // Long walls render in landscape; ceiling/floor stay square.
          size: face === 'top' || face === 'bottom' ? '1024x1024' : '1536x1024',
        },
      );
      provider = 'openai';
    } else if (!image && geminiError) {
      throw geminiError;
    }

    if (!image) {
      return json(502, { success: false, error: 'The image model did not return an image. Please try again.' });
    }
    return json(200, { success: true, face, image, provider });
  } catch (err) {
    console.error('generate-face error:', err);
    const { status, message } = describeApiError(err);
    return json(status, { success: false, error: message });
  }
};

export const config: Config = {
  path: '/api/generate-face',
};
