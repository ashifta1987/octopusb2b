import { connection } from 'next/server';
import { can, getSession } from '@/lib/auth';
import { json, problem } from '@/lib/api/problem';
import { POSTMAN_EXAMPLES } from '@/lib/api/postman-http';
import { runPostmanSync, syncLogRow } from '@/lib/api/postman-sync';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Admin → Integrations → Postman (SPEC §15.2).
 *  GET  /api/postman/sync — last sync results from integration_logs (integration_code 'postman').
 *  POST /api/postman/sync — "Sync now": regenerates the collections server-side and pushes them to the Postman API
 *       (POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID, POSTMAN_COLLECTION_ID_PUBLIC, POSTMAN_COLLECTION_ID_SUPPLIER, POSTMAN_API_ID
 *       from the server env). Requires the integrations:edit permission. The result is logged to integration_logs.
 */
export const maxDuration = 60;

async function guard(action: 'view' | 'edit') {
  const s = await getSession();
  if (!s) return problem(401, 'UNAUTHORIZED', 'Sign in first.', { message: 'Sign in first.' });
  if (!can(s, 'integrations', action)) return problem(403, 'FORBIDDEN', `Needs integrations:${action}.`, { message: `You need the integrations:${action} permission.` });
  return null;
}

export async function GET() {
  await connection();
  const denied = await guard('view');
  if (denied) return denied;
  const { data, error } = await createAdminClient()
    .from('integration_logs')
    .select('id, direction, status, summary, created_at')
    .eq('integration_code', 'postman')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return problem(500, 'INTERNAL', error.message);
  const configured = !!(process.env.POSTMAN_API_KEY && process.env.POSTMAN_WORKSPACE_ID);
  return json({ data: { configured, last: data?.[0] ?? null, history: data ?? [] } });
}

export async function POST() {
  await connection();
  const denied = await guard('edit');
  if (denied) return denied;
  const { result } = await runPostmanSync({ env: process.env, examples: POSTMAN_EXAMPLES });
  const sb = createAdminClient();
  const row = syncLogRow(result, 'sync');
  await sb.from('integration_logs').insert(row);
  if (result.pushed) await sb.from('integrations').update({ last_tested_at: new Date().toISOString() }).eq('code', 'postman');
  // `message` (and `error` on failure) is what the Admin → Integrations card shows.
  const body = { message: row.summary, ...(result.pushed && !result.ok ? { error: row.summary } : {}), data: { ...result, summary: row.summary } };
  return json(body, { status: result.pushed && !result.ok ? 502 : 200 });
}
