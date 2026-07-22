import type { Config } from '@netlify/functions';
import {
  FACE_KEYS,
  DEFAULT_TEXT_MODEL,
  createClient,
  analyzeRoom,
  describeApiError,
} from '../../server/lib/gemini.mjs';
import { DEFAULT_OPENAI_MODEL, analyzeRoomOpenAI } from '../../server/lib/openai.mjs';

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
  const model = Netlify.env.get('GEMINI_TEXT_MODEL') || DEFAULT_TEXT_MODEL;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { success: false, error: 'Expected multipart form data.' });
  }

  const photos = form.getAll('photos').filter((v): v is File => v instanceof File).slice(0, FACE_KEYS.length);
  if (photos.length === 0) {
    return json(400, { success: false, error: 'Upload at least one room photo.' });
  }
  for (const photo of photos) {
    if (photo.size > MAX_FILE_BYTES) {
      return json(400, { success: false, error: 'One of the photos is over 20MB.' });
    }
    if (!/^image\/(jpeg|png|webp)$/.test(photo.type)) {
      return json(400, { success: false, error: 'Photos must be JPEG, PNG or WebP.' });
    }
  }

  try {
    const rawPhotos = await Promise.all(
      photos.map(async (photo) => ({
        mimeType: photo.type,
        base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
      })),
    );

    // OpenAI's latest vision model handles image reasoning when a key is
    // configured; Gemini remains the automatic fallback.
    const openaiKey = Netlify.env.get('OPENAI_API_KEY');
    let analysis: Awaited<ReturnType<typeof analyzeRoom>> | null = null;
    let provider = 'gemini';
    if (openaiKey) {
      try {
        analysis = await analyzeRoomOpenAI(
          openaiKey,
          Netlify.env.get('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
          rawPhotos,
          { effort: Netlify.env.get('OPENAI_REASONING_EFFORT') || 'low' },
        );
        provider = 'openai';
      } catch (err) {
        console.error('OpenAI analysis failed, falling back to Gemini:', err);
      }
    }
    if (!analysis) {
      const ai = createClient(apiKey);
      const photoParts = rawPhotos.map((p) => ({
        inlineData: { mimeType: p.mimeType, data: p.base64 },
      }));
      analysis = await analyzeRoom(ai, model, photoParts);
    }
    return json(200, { success: true, provider, ...analysis });
  } catch (err) {
    console.error('analyze error:', err);
    const { status, message } = describeApiError(err);
    return json(status, { success: false, error: message });
  }
};

export const config: Config = {
  path: '/api/analyze',
};
