import { json, problem } from '@/lib/api/problem';
import { getPaymentProviderAdapter, type PaymentProviderName } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/server';
import { sha256, traceLog } from '@/lib/trace';

export async function handleProviderWebhook(req: Request, provider: PaymentProviderName) {
  const raw = await req.text();
  const sb = createAdminClient();
  const t0 = Date.now();
  const endpoint = `POST /api/webhooks/payments/${provider}`;
  const adapter = getPaymentProviderAdapter(provider);

  let verified;
  try {
    verified = await adapter.verifyWebhook(raw, req.headers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    traceLog('warn', 'payment_provider_webhook_rejected', { provider, reason: msg });
    await sb.from('integration_logs').insert({
      integration_code: 'payment',
      direction: 'in',
      status: 401,
      summary: `${provider} webhook signature rejected: ${msg}`.slice(0, 500),
      endpoint,
      request_sha: sha256(raw),
      duration_ms: Date.now() - t0,
    });
    return problem(401, 'WEBHOOK_SIGNATURE_INVALID', msg);
  }

  if (verified.eventType !== 'payment.succeeded') {
    return json({ ok: true, provider, event_id: verified.eventId, outcome: `ignored:${verified.eventType}` });
  }

  const { data, error } = await sb.rpc('confirm_aggregator_webhook', {
    p_provider: provider,
    p_event_id: verified.eventId,
    p_event_type: verified.eventType,
    p_checkout_id: verified.checkoutId,
    p_amount_cents: verified.amountCents,
    p_currency: verified.currency,
    p_provider_payment_id: verified.providerPaymentId,
    p_provider_customer_id: verified.providerCustomerId ?? null,
    p_provider_payment_method_id: verified.providerPaymentMethodId ?? null,
    p_payload: verified.rawPayload,
  });

  if (error) {
    const code = /WEBHOOK_AMOUNT_MISMATCH|WEBHOOK_CURRENCY_MISMATCH|CHECKOUT_NOT_FOUND/.test(error.message) ? 400 : 500;
    await sb.from('integration_logs').insert({
      integration_code: 'payment',
      direction: 'in',
      status: code,
      summary: `${provider} confirm_aggregator_webhook error: ${error.message}`.slice(0, 500),
      endpoint,
      request_sha: sha256(raw),
      duration_ms: Date.now() - t0,
    });
    return problem(code, 'WEBHOOK_SETTLEMENT_REJECTED', error.message);
  }

  const out = { ok: true, provider, event_id: verified.eventId, result: data };
  await sb.from('integration_logs').insert({
    integration_code: 'payment',
    direction: 'in',
    status: 200,
    summary: `${provider} webhook confirmed · ${verified.eventId} · checkout ${verified.checkoutId}`.slice(0, 500),
    endpoint,
    request_sha: sha256(raw),
    response_sha: sha256(JSON.stringify(out)),
    duration_ms: Date.now() - t0,
  });
  return json(out);
}
