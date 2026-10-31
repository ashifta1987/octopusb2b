import { checkCron } from '@/lib/api/cron';
import { processOutbox } from '@/lib/api/outbox';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/cron/outbox — outbox worker (Vercel Cron, `Authorization: Bearer ${CRON_SECRET}`).
 * vercel.json runs it once a day because the Hobby plan only allows daily crons. On Pro change the schedule to
 * every 10 minutes ("*\/10 * * * *"), or call this URL from an external scheduler / Supabase pg_cron + pg_net.
 * Processes up to 4 batches of 50 per invocation.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = checkCron(req);
  if (denied) return denied;
  const sb = createAdminClient();
  const totals = { claimed: 0, done: 0, retried: 0, dead: 0, errors: [] as string[] };
  const started = Date.now();
  try {
    for (let i = 0; i < 4 && Date.now() - started < 40_000; i++) {
      const s = await processOutbox(sb, 50);
      if (s.paused) return json({ ok: true, paused: true, reason: 'maintenance_mode', duration_ms: Date.now() - started });
      totals.claimed += s.claimed;
      totals.done += s.done;
      totals.retried += s.retried;
      totals.dead += s.dead;
      totals.errors.push(...s.errors);
      if (s.claimed < 50) break;
    }
  } catch (e) {
    console.error('[cron/outbox]', e);
    return problem(500, 'OUTBOX_FAILED', e instanceof Error ? e.message : String(e));
  }
  return json({ ok: true, ...totals, errors: totals.errors.slice(0, 20), duration_ms: Date.now() - started });
}

export const POST = GET;
