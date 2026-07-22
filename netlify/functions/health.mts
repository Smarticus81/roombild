import type { Config } from '@netlify/functions';

export default async () => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const config: Config = {
  path: '/api/health',
};
