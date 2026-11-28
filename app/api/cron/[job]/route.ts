import { getCarrier } from '@/lib/adapters';
import { checkCron } from '@/lib/api/cron';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';
import { runHsClassification } from '@/lib/hs/server';
import { pollCarrierTracking } from '@/lib/carriers/poll';
import { connectorSyncNow } from '@/lib/connectors/runtime-server';
import { ECB_SOURCE, fetchEcbDay, ratesPerUsd } from '@/lib/fx/ecb';

/**
 * GET /api/cron/{job} — scheduled jobs (SPEC §10.3), protected by CRON_SECRET.
 * The SQL jobs are ALSO scheduled in pg_cron (migration 20261101000051) at their real cadence; this route is the
 * Vercel Cron fallback / manual trigger.
 */
type Sb = ReturnType<typeof createAdminClient>;

const SQL_JOBS: Record<string, string> = {
  'expire-quotes': 'job_expire_quotes',
  'ads-reset': 'job_reset_ad_budgets',
  'claim-windows': 'job_close_claim_windows',
  'terms-publish': 'job_publish_scheduled_terms',
  certificates: 'job_certificate_expiry',
  cleanup: 'job_cleanup',
  'payment-reconciliation': 'run_payment_reconciliation',
  'credit-overdue': 'run_credit_and_saas_overdue_check',
  'dropship-weekly-statements': 'run_weekly_dropship_statements',
};

/** Shipments in transit with no carrier event for 12 h → ask the carrier adapter again (sandbox: no-op). */
async function trackingPoll(sb: Sb) {
  const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data, error } = await sb
    .from('shipments')
    .select('id, code, carrier_code, tracking_no, last_event_at')
    .in('status', ['picked_up', 'in_transit', 'out_for_delivery'])
    .not('tracking_no', 'is', null)
    .or(`last_event_at.is.null,last_event_at.lt.${cutoff}`)
    .limit(100);
  if (error) throw new Error(error.message);
  let polled = 0;
  const failed: string[] = [];
  for (const s of data ?? []) {
    try {
      const carrier = getCarrier(s.carrier_code);
      // The adapter has no pull API yet: re-subscribe so the carrier re-sends events to our webhook.
      // In sandbox mode this is a no-op; live polling lands with the YunExpress credentials (open decision #8).
      await carrier.subscribeTracking(s.tracking_no!);
      polled++;
    } catch (e) {
      failed.push(`${s.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await sb.from('integration_logs').insert({
    integration_code: 'yunexpress',
    direction: 'out',
    status: failed.length ? 207 : 200,
    summary: `tracking-poll: ${polled} stale shipment(s) re-subscribed${failed.length ? `, ${failed.length} failed` : ''}`,
  });
  return { stale: data?.length ?? 0, polled, failed };
}

export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const denied = checkCron(req);
  if (denied) return denied;
  const { job } = await params;
  const sb = createAdminClient();
  const started = Date.now();
  try {
    if (job === 'tracking-poll') return json({ ok: true, job, result: await trackingPoll(sb), duration_ms: Date.now() - started });
    // C0: Warehouse OS live labels on the way → ask the carrier for new events (pg_cron job_carrier_tracking_poll calls this every 30 min)
    if (job === 'carrier-tracking-poll') return json({ ok: true, job, result: await pollCarrierTracking(), duration_ms: Date.now() - started });
    // HS headings for products still queued (imports over the per-run AI cap, or interrupted background runs)
    // CONN S1: connector webhooks inbox, store tasks (tracking / cancellation answers) and the hourly order catch-up (pg_cron job_connector_sync every 5 min, only when there is work)
    if (job === 'connector-sync') return json({ ok: true, job, result: await connectorSyncNow(), duration_ms: Date.now() - started });
    // CONN S6: daily ECB reference rates → dropship_fx_rates (pg_cron job_fx_ecb, weekdays 15:30 UTC)
    if (job === 'fx-ecb') {
      const day = await fetchEcbDay();
      const rates = ratesPerUsd(day);
      if (!rates) throw new Error('The ECB feed has no USD rate today.');
      const { data, error } = await sb.rpc('c6_fx_record', { p_rates: rates, p_source: ECB_SOURCE, p_date: day.date });
      if (error) throw new Error(error.message);
      return json({ ok: true, job, result: data, ecb_date: day.date, duration_ms: Date.now() - started });
    }
    // CONN S6: the auto-sync engine also runs from pg_cron directly (c6_engine_run); this is the manual trigger
    if (job === 'dropship-sync') {
      const { data, error } = await sb.rpc('c6_engine_run');
      if (error) throw new Error(error.message);
      return json({ ok: true, job, result: data, duration_ms: Date.now() - started });
    }
    if (job === 'hs-classify') return json({ ok: true, job, result: await runHsClassification(), duration_ms: Date.now() - started });
    const fn = SQL_JOBS[job];
    if (!fn) return problem(404, 'NOT_FOUND', `Unknown job "${job}". Jobs: ${[...Object.keys(SQL_JOBS), 'tracking-poll', 'carrier-tracking-poll', 'hs-classify', 'connector-sync', 'fx-ecb', 'dropship-sync', 'outbox'].join(', ')}`);
    const { data, error } = await sb.rpc(fn);
    if (error) throw new Error(error.message);
    return json({ ok: true, job, result: data ?? null, duration_ms: Date.now() - started });
  } catch (e) {
    console.error(`[cron/${job}]`, e);
    return problem(500, 'JOB_FAILED', e instanceof Error ? e.message : String(e));
  }
}

export const POST = GET;
