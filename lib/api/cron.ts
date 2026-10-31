import 'server-only';
import crypto from 'node:crypto';
import { problem } from './problem';

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Returns a problem Response when not authorized. */
export function checkCron(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return problem(503, 'NOT_CONFIGURED', 'CRON_SECRET is not set.');
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return problem(401, 'UNAUTHORIZED', 'Invalid cron secret.');
  return null;
}
