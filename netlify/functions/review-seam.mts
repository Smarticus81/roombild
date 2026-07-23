import type { Config } from '@netlify/functions';
import {
  DEFAULT_TEXT_MODEL,
  createClient,
  reviewSeam,
  describeApiError,
} from '../../server/lib/gemini.mjs';
import { DEFAULT_OPENAI_MODEL, reviewSeamOpenAI } from '../../server/lib/openai.mjs';

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

  try {
    const image = {
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    };

    let verdict: { seamless?: boolean; problems?: string } | null = null;
    let provider = 'gemini';
    const openaiKey = Netlify.env.get('OPENAI_API_KEY');
    if (openaiKey) {
      try {
        verdict = await reviewSeamOpenAI(openaiKey, Netlify.env.get('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL, image, {
          effort: Netlify.env.get('OPENAI_REASONING_EFFORT') || 'low',
        });
        provider = 'openai';
      } catch (err) {
        console.error('OpenAI seam review failed, falling back to Gemini:', err);
      }
    }
    if (!verdict) {
      const ai = createClient(apiKey);
      verdict = await reviewSeam(ai, Netlify.env.get('GEMINI_TEXT_MODEL') || DEFAULT_TEXT_MODEL, {
        inlineData: { mimeType: image.mimeType, data: image.base64 },
      });
    }
    return json(200, {
      success: true,
      provider,
      seamless: Boolean(verdict.seamless),
      problems: String(verdict.problems ?? ''),
    });
  } catch (err) {
    console.error('review-seam error:', err);
    const { status, message } = describeApiError(err);
    return json(status, { success: false, error: message });
  }
};

export const config: Config = {
  path: '/api/review-seam',
};
