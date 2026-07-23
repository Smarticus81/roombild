import type { Config } from '@netlify/functions';
import {
  DEFAULT_IMAGE_MODEL,
  createClient,
  fixSeam,
  describeApiError,
} from '../../server/lib/gemini.mjs';
import { DEFAULT_OPENAI_IMAGE_MODEL, fixSeamOpenAI } from '../../server/lib/openai.mjs';

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
  const file = form.get('image');
  if (!(file instanceof File) || file.size > MAX_FILE_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return json(400, { success: false, error: 'Provide the rolled panorama as "image" (JPEG/PNG/WebP under 20MB).' });
  }
  const problems = String(form.get('problems') ?? '').slice(0, 2000);
  const roomDescription = String(form.get('roomDescription') ?? '').slice(0, 6000);

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

    let image: string | null = null;
    let provider = 'gemini';
    let geminiError: unknown = null;
    try {
      const ai = createClient(apiKey);
      image = await fixSeam(
        ai,
        Netlify.env.get('GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL,
        { inlineData: { mimeType: file.type, data: base64 } },
        problems,
        roomDescription,
      );
    } catch (err) {
      geminiError = err;
    }

    const openaiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!image && openaiKey) {
      if (geminiError) {
        console.warn('Gemini seam fix failed, falling back to OpenAI:', geminiError);
      }
      image = await fixSeamOpenAI(
        openaiKey,
        Netlify.env.get('OPENAI_IMAGE_MODEL') || DEFAULT_OPENAI_IMAGE_MODEL,
        { mimeType: file.type, base64 },
        problems,
        roomDescription,
        { quality: Netlify.env.get('OPENAI_IMAGE_QUALITY') || 'low' },
      );
      provider = 'openai';
    } else if (!image && geminiError) {
      throw geminiError;
    }

    if (!image) {
      return json(502, { success: false, error: 'The image model did not return a repaired panorama.' });
    }
    return json(200, { success: true, image, provider });
  } catch (err) {
    console.error('fix-seam error:', err);
    const { status, message } = describeApiError(err);
    return json(status, { success: false, error: message });
  }
};

export const config: Config = {
  path: '/api/fix-seam',
};
