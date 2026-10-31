import { getPayment } from '@/lib/adapters';
import { isUuid } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/webhooks/payment — payment partner webhook (SPEC §7, P5).
 * The adapter verifies the signature (PAYMENT_WEBHOOK_SECRET / WEBHOOK_SIGNING_SECRET).
 * `topup.succeeded` → finds the pending wallet_topups row by reference (or id) and calls confirm_topup, which posts the
 * ledger credit. Idempotent by provider event id (journal idempotency key `topup-evt:<id>`; credited top-ups no-op).
 * Order payments (`payment.succeeded`) are matched by Finance in the back office for now (logged, acknowledged).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sb = createAdminClient();
  let events;
  try {
    events = await getPayment().parseWebhook(raw, req.headers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('integration_logs').insert({ integration_code: 'payment', direction: 'in', status: msg === 'BAD_SIGNATURE' ? 401 : 400, summary: `webhook rejected: ${msg}`.slice(0, 500) });
    return msg === 'BAD_SIGNATURE' ? problem(401, 'BAD_SIGNATURE', 'Invalid or expired signature.') : problem(400, 'INVALID_PAYLOAD', 'Could not parse webhook.');
  }

  const results: { event: string; outcome: string }[] = [];
  for (const ev of events) {
    if (!ev.providerEventId) {
      results.push({ event: '(missing id)', outcome: 'ignored' });
      continue;
    }
    if (ev.kind !== 'topup.succeeded') {
      results.push({ event: ev.providerEventId, outcome: `ignored:${ev.kind}` });
      continue;
    }
    const { data: seen } = await sb.from('journals').select('id').eq('idempotency_key', `topup-evt:${ev.providerEventId}`).maybeSingle();
    if (seen) {
      results.push({ event: ev.providerEventId, outcome: 'duplicate' });
      continue;
    }
    let q = sb.from('wallet_topups').select('id, amount_cents, status').order('created_at', { ascending: false }).limit(1);
    q = ev.reference && isUuid(ev.reference) ? q.eq('id', ev.reference) : q.eq('reference', ev.reference ?? '').in('status', ['pending', 'initiated']);
    const { data: topup } = await q.maybeSingle();
    if (!topup) {
      results.push({ event: ev.providerEventId, outcome: 'unmatched' });
      continue;
    }
    if (topup.status === 'credited') {
      results.push({ event: ev.providerEventId, outcome: 'already_credited' });
      continue;
    }
    if (ev.amountCents && Number(ev.amountCents) !== Number(topup.amount_cents)) {
      results.push({ event: ev.providerEventId, outcome: 'amount_mismatch' });
      continue;
    }
    const { error } = await sb.rpc('confirm_topup', { p_topup: topup.id, p_provider_event: ev.providerEventId });
    if (error) {
      console.error('[webhooks/payment]', error.message);
      await sb.from('integration_logs').insert({ integration_code: 'payment', direction: 'in', status: 500, summary: `confirm_topup failed: ${error.message}`.slice(0, 500) });
      return problem(500, 'CONFIRM_FAILED', 'Could not confirm top-up; please retry.');
    }
    results.push({ event: ev.providerEventId, outcome: 'credited' });
  }
  await sb.from('integration_logs').insert({
    integration_code: 'payment',
    direction: 'in',
    status: 200,
    summary: results.map((r) => `${r.event}:${r.outcome}`).join(', ').slice(0, 500) || 'no events',
  });
  return json({ ok: true, results });
}
