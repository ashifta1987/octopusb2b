import 'server-only';
import examples from '@/postman/examples.json';
import type { Examples } from './postman';

/** Saved example responses generated from seed data (postman/examples.json). */
export const POSTMAN_EXAMPLES = examples as unknown as Examples;

/** Public base URL of this deployment's API (`…/api/v1`). */
export function apiBase(req: Request) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return `${site}/api/v1`;
}

export function jsonDownload(body: unknown, filename: string) {
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
