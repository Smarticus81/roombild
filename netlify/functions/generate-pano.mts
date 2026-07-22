import type { Config } from '@netlify/functions';
import {
  FACE_KEYS,
  DEFAULT_IMAGE_MODEL,
  createClient,
  generatePanorama,
  describeApiError,
} from '../../server/lib/gemini.mjs';
import { DEFAULT_OPENAI_IMAGE_MODEL, generatePanoramaOpenAI } from '../../server/lib/openai.mjs';

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { success: false, error: 'Expected multipart form data.' });
  }

  const photos = form.getAll('photos').filter((v): v is File => v instanceof File).slice(0, FACE_KEYS.length * 2);
  if (photos.length === 0) {
    return json(400, { success: false, error: 'Upload at least one room photo.' });
  }
  for (const photo of photos) {
    if (photo.size > MAX_FILE_BYTES || !/^image\/(jpeg|png|webp)$/.test(photo.type)) {
      return json(400, { success: false, error: 'Photos must be JPEG/PNG/WebP under 20MB.' });
    }
  }
  const roomDescription = String(form.get('roomDescription') ?? '').slice(0, 6000);

  try {
    const rawPhotos = await Promise.all(
      photos.map(async (photo) => ({
        mimeType: photo.type,
        base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
      })),
    );

    let image: string | null = null;
    let provider = 'gemini';
    let geminiError: unknown = null;
    try {
      const ai = createClient(apiKey);
      const referenceParts = rawPhotos.flatMap((p, i) => [
        { text: `Reference photo ${i} of the room:` },
        { inlineData: { mimeType: p.mimeType, data: p.base64 } },
      ]);
      image = await generatePanorama(
        ai,
        Netlify.env.get('GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL,
        referenceParts,
        roomDescription,
      );
    } catch (err) {
      geminiError = err;
    }

    const openaiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!image && openaiKey) {
      if (geminiError) {
        console.warn('Gemini panorama failed, falling back to OpenAI:', geminiError);
      }
      image = await generatePanoramaOpenAI(
        openaiKey,
        Netlify.env.get('OPENAI_IMAGE_MODEL') || DEFAULT_OPENAI_IMAGE_MODEL,
        rawPhotos,
        roomDescription,
        { quality: Netlify.env.get('OPENAI_IMAGE_QUALITY') || 'low' },
      );
      provider = 'openai';
    } else if (!image && geminiError) {
      throw geminiError;
    }

    if (!image) {
      return json(502, { success: false, error: 'The image model did not return a panorama. Please try again.' });
    }
    return json(200, { success: true, image, provider });
  } catch (err) {
    console.error('generate-pano error:', err);
    const { status, message } = describeApiError(err);
    return json(status, { success: false, error: message });
  }
};

export const config: Config = {
  path: '/api/generate-pano',
};
