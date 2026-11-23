'use server';

import { revalidatePath } from 'next/cache';
import { mockProviderAdapter, signMockWebhookPayload } from '@/lib/payments';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export async function confirmMockPaymentAction(formData: FormData) {
  if (process.env.APP_ENVIRONMENT !== 'staging') {
    return { ok: false, error: 'Mock provider is available on staging only.' };
  }

  const checkoutId = String(formData.get('checkout_id') ?? '').trim();
  const outcome = String(formData.get('outcome') ?? 'succeeded').trim();
  if (!checkoutId) {
    return { ok: false, error: 'Missing checkout ID.' };
  }

  const sessionSb = await createClient();
  const { data: chk, error: chkErr } = await sessionSb
    .from('payment_checkouts')
    .select(
      'id, org_id, service, payment_option, target_type, target_id, base_amount_cents, surcharge_cents, total_amount_cents, currency, provider, method_kind, save_payment_method, status',
    )
    .eq('id', checkoutId)
    .maybeSingle();

  if (chkErr || !chk) {
    return { ok: false, error: chkErr?.message ?? 'Checkout session not found.' };
  }

  if (outcome === 'cancelled') {
    const adminSb = createAdminClient();
    await adminSb
      .from('payment_checkouts')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', chk.id)
      .eq('status', 'pending');
    revalidatePath(`/pay/mock/${chk.id}`);
    return { ok: true, status: 'cancelled', returnUrl: getTargetReturnUrl(chk.target_type, chk.target_id) };
  }

  // Build and HMAC-sign a mock webhook payload, then verify it through mockProviderAdapter.verifyWebhook()
  // and settle via confirm_aggregator_webhook — identical to a real POST /api/webhooks/payments/mock delivery.
  const payload = {
    event_id: `evt_mock_${chk.id.replace(/-/g, '')}`,
    event_type: 'payment.succeeded',
    checkout_id: chk.id,
    amount_cents: Number(chk.total_amount_cents),
    currency: chk.currency,
    provider_payment_id: `mock_pay_${chk.id.replace(/-/g, '').slice(0, 16)}`,
    provider_customer_id: chk.save_payment_method ? `cus_mock_${chk.org_id.replace(/-/g, '').slice(0, 12)}` : null,
    provider_payment_method_id: chk.save_payment_method ? `pm_mock_${chk.method_kind}_4242` : null,
  };
  const rawBody = JSON.stringify(payload);
  const signature = signMockWebhookPayload(rawBody);
  const headers = new Headers({ 'x-mock-signature': signature });

  const verified = await mockProviderAdapter.verifyWebhook(rawBody, headers);
  const adminSb = createAdminClient();
  const { error } = await adminSb.rpc('confirm_aggregator_webhook', {
    p_provider: 'mock',
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
    return { ok: false, error: error.message };
  }

  revalidatePath(`/pay/mock/${chk.id}`);
  revalidatePath('/account/orders');
  revalidatePath('/account/invoices');
  revalidatePath('/account/wallet');
  revalidatePath('/account');

  return {
    ok: true,
    status: 'paid',
    returnUrl: getTargetReturnUrl(chk.target_type, chk.target_id),
  };
}

function getTargetReturnUrl(targetType: string, targetId: string): string {
  switch (targetType) {
    case 'order':
    case 'dropship_order':
      return `/account/orders/${targetId}`;
    case 'proforma':
      return '/account/invoices';
    case 'wallet_topup':
      return '/account/wallet';
    case 'saas_subscription':
      return '/account/services';
    default:
      return '/account';
  }
}
