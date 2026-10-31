import { connection } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/** GET /api/health — uptime check (SPEC §11.5): DB ping. 200 when healthy, 503 otherwise. */
export async function GET() {
  await connection(); // always run at request time
  const started = Date.now();
  let db: 'ok' | 'error' = 'ok';
  let detail: string | undefined;
  try {
    const { error } = await createAdminClient().from('site_settings').select('key', { head: true, count: 'exact' }).limit(1);
    if (error) throw new Error(error.message);
  } catch (e) {
    db = 'error';
    detail = e instanceof Error ? e.message : String(e);
  }
  const ok = db === 'ok';
  return new Response(JSON.stringify({ status: ok ? 'ok' : 'degraded', db, latency_ms: Date.now() - started, ...(detail ? { detail } : {}), time: new Date().toISOString() }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
