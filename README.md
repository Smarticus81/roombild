# SpaceBuilder 3D (roombild)

Upload photos of your room's walls, floor and ceiling; Gemini generates any faces
you didn't photograph; then explore the room as an immersive 3D cube-map walkthrough.

## Stack

- **Frontend:** React 19 + TypeScript + Vite 7 + Tailwind CSS 4 + three.js (@react-three/fiber, drei)
- **Backend:** Node/Express — `server/index.mjs` exposes `POST /api/generate-missing`
  (Gemini image model) and serves the built frontend in production.

## Setup

```sh
cp .env.example .env   # then paste your Gemini API key into .env
npm install
```

### Optional: OpenAI for image reasoning

Set `OPENAI_API_KEY` to run the photo-analysis (image reasoning) step on
OpenAI's latest vision model (`gpt-5.1` by default, override with
`OPENAI_MODEL`; `OPENAI_REASONING_EFFORT` defaults to `low` to stay within
serverless time limits). If the OpenAI call fails or no key is set, the app
automatically falls back to Gemini. The `/api/analyze` response includes a
`provider` field ("openai" or "gemini") so you can confirm which model ran.

> **Important:** the image model (`gemini-2.5-flash-image`) is **not available on the
> Gemini free tier** — the key must belong to a Google AI project with billing enabled,
> or every generation request returns a quota error. Manage keys at
> https://aistudio.google.com/apikey.

## Development

```sh
npm run dev
```

Runs the API on :3000 and Vite (with `/api` proxy) on :5173.

## Production

```sh
npm run build   # typecheck + bundle to dist/
npm start       # one server on :3000 — serves dist/ and the API
```

Deploy anywhere that runs Node (Railway, Render, Fly.io, a VPS…). Set
`GEMINI_API_KEY` (required) and optionally `PORT` / `GEMINI_IMAGE_MODEL` as
environment variables. The `.env` file is for local use only — never commit it.

### Netlify

The app is deployed at **https://roombild.netlify.app**. On Netlify the API runs
as serverless functions (`netlify/functions/*.mts`) instead of the Express server;
`netlify.toml` configures the build. Set `GEMINI_API_KEY` in the site's
environment variables (Project configuration → Environment variables) and
redeploy for changes to take effect. Note: Netlify synchronous functions have a
~10–26s execution limit — generating many faces at once from slow models may
time out; the Express deployment has no such limit.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/generate-missing` | POST | Multipart form: face photos in fields `front`, `back`, `left`, `right`, `top`, `bottom` (any subset, ≤20 MB each, JPEG/PNG/WebP) plus a `missing` field (comma-separated face names). Returns `{ success, generated: { face: dataUrl }, failed: [] }`. |
