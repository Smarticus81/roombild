import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  FACE_KEYS,
  FACE_LABELS,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
  createClient,
  analyzeRoom,
  generateFace,
  describeApiError,
} from './lib/gemini.mjs';
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
  analyzeRoomOpenAI,
  generateFaceOpenAI,
} from './lib/openai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT) || 3000;
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
const API_KEY = process.env.GEMINI_API_KEY;
// Optional: when set, OpenAI's latest vision model handles the image-reasoning
// step (with Gemini as automatic fallback).
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'low';
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const ai = createClient(API_KEY);

const app = express();
app.disable('x-powered-by');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // matches the client-side 20MB cap
    files: FACE_KEYS.length,
    fields: 6,
  },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype));
  },
});

const toInlinePart = (file) => ({
  inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/**
 * Reasoning step. Accepts multipart form data with up to six photos in the
 * repeated `photos` field (order matters). Returns
 * `{ success, assignments, roomDescription, reasoning }`.
 */
app.post('/api/analyze', upload.array('photos', FACE_KEYS.length), async (req, res) => {
  try {
    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'Upload at least one room photo.' });
    }

    let analysis = null;
    let provider = 'gemini';
    if (OPENAI_API_KEY) {
      try {
        analysis = await analyzeRoomOpenAI(
          OPENAI_API_KEY,
          OPENAI_MODEL,
          files.map((f) => ({ mimeType: f.mimetype, base64: f.buffer.toString('base64') })),
          { effort: OPENAI_REASONING_EFFORT },
        );
        provider = 'openai';
      } catch (err) {
        console.error('OpenAI analysis failed, falling back to Gemini:', err);
      }
    }
    if (!analysis) {
      analysis = await analyzeRoom(ai, TEXT_MODEL, files.map(toInlinePart));
    }
    res.json({ success: true, provider, ...analysis });
  } catch (err) {
    console.error('analyze error:', err);
    const { status, message } = describeApiError(err);
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * Generation step — one face per request so hosted deployments stay within
 * serverless time limits. Accepts the known faces as fields named after
 * FACE_KEYS, plus `face` (the face to generate) and `roomDescription`.
 * Returns `{ success, face, image }`.
 */
app.post(
  '/api/generate-face',
  upload.fields(FACE_KEYS.map((name) => ({ name, maxCount: 1 }))),
  async (req, res) => {
    try {
      const files = req.files ?? {};
      const provided = FACE_KEYS.filter((k) => files[k]?.[0]);
      if (provided.length === 0) {
        return res.status(400).json({ success: false, error: 'Provide at least one reference photo.' });
      }

      const face = String(req.body?.face ?? '');
      if (!FACE_KEYS.includes(face) || provided.includes(face)) {
        return res.status(400).json({ success: false, error: 'Invalid face requested.' });
      }
      const roomDescription = String(req.body?.roomDescription ?? '').slice(0, 4000);

      const referenceParts = provided.flatMap((key) => [
        { text: `Reference photo — the ${FACE_LABELS[key]} of the room:` },
        toInlinePart(files[key][0]),
      ]);

      let image = null;
      let provider = 'gemini';
      let geminiError = null;
      try {
        image = await generateFace(ai, IMAGE_MODEL, face, referenceParts, roomDescription);
      } catch (err) {
        geminiError = err;
      }

      // Gemini quota exhausted (or any other failure): fall back to OpenAI's
      // latest image model when a key is configured.
      if (!image && OPENAI_API_KEY) {
        if (geminiError) {
          console.warn(`Gemini generation failed (${geminiError.status ?? 'no image'}), falling back to OpenAI`);
        }
        const references = provided.map((key) => ({
          face: key,
          mimeType: files[key][0].mimetype,
          base64: files[key][0].buffer.toString('base64'),
        }));
        image = await generateFaceOpenAI(
          OPENAI_API_KEY,
          OPENAI_IMAGE_MODEL,
          face,
          references,
          roomDescription,
          { quality: OPENAI_IMAGE_QUALITY },
        );
        provider = 'openai';
      } else if (!image && geminiError) {
        throw geminiError;
      }

      if (!image) {
        return res.status(502).json({
          success: false,
          error: 'The image model did not return an image. Please try again.',
        });
      }

      res.json({ success: true, face, image, provider });
    } catch (err) {
      console.error('generate-face error:', err);
      const { status, message } = describeApiError(err);
      res.status(status).json({ success: false, error: message });
    }
  },
);

// Multer errors (file too large, too many files) end up here.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: `Upload rejected: ${err.message}.` });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// In production the same server hosts the built frontend.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`SpaceBuilder 3D API listening on http://localhost:${PORT}`);
  if (fs.existsSync(DIST_DIR)) {
    console.log(`Serving production build from ${DIST_DIR}`);
  } else {
    console.log('No dist/ build found — run "npm run build" to serve the frontend from this server.');
  }
});
