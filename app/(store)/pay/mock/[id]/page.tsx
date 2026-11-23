import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { MockCheckoutClient } from './client';

async function MockCheckoutContent({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.APP_ENVIRONMENT !== 'staging') {
    notFound();
  }
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/pay/mock/${id}`)}`);
  }

  const sb = await createClient();
  const { data: chk } = await sb
    .from('payment_checkouts')
    .select(
      'id, org_id, legal_entity_id, service, payment_option, target_type, target_id, base_amount_cents, surcharge_cents, total_amount_cents, currency, provider, method_kind, save_payment_method, status, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (!chk) notFound();

  const { data: entity } = await sb
    .from('legal_entities')
    .select('legal_name, registered_in')
    .eq('id', chk.legal_entity_id)
    .maybeSingle();

  const cur = (chk.currency?.trim() || 'USD') as 'USD' | 'CNY';
  const optionLabel =
    chk.payment_option === 'payment_protection'
      ? 'Payment protection (held until milestone)'
      : 'Pay now';

  const returnUrl =
    chk.target_type === 'order' || chk.target_type === 'dropship_order'
      ? `/account/orders/${chk.target_id}`
      : chk.target_type === 'proforma'
        ? '/account/invoices'
        : chk.target_type === 'saas_subscription'
          ? '/account/services'
          : '/account';

  return (
    <div className="mx-auto max-w-xl px-4 py-10" data-testid="mock-checkout-page">
      <div className="rounded-2xl border border-line bg-canvas p-6 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-4">
          <div>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-900">
              Staging Mock Aggregator
            </span>
            <h1 className="mt-1 font-serif text-xl text-ink">Octopus B2B Secure Checkout</h1>
            <p className="text-xs text-muted">
              Merchant of record: {entity?.legal_name ?? 'Shenzhen Octopus Trading Co., Ltd.'}
            </p>
          </div>
          <div className="text-right font-mono text-xs text-muted">
            Session <div className="text-ink">{chk.id.slice(0, 8)}</div>
          </div>
        </div>

        <dl className="my-5 space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Service</dt>
            <dd className="font-medium capitalize text-ink">{chk.service}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Payment option</dt>
            <dd className="font-medium text-ink" data-testid="mock-checkout-option">
              {optionLabel}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Amount</dt>
            <dd className="font-mono text-ink">{money(Number(chk.base_amount_cents), cur)}</dd>
          </div>
          {Number(chk.surcharge_cents) > 0 && (
            <div className="flex justify-between" data-testid="mock-checkout-surcharge">
              <dt className="text-muted">Card / aggregator surcharge</dt>
              <dd className="font-mono text-ink">{money(Number(chk.surcharge_cents), cur)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2.5 text-base font-semibold">
            <dt className="text-ink">Total to authorize</dt>
            <dd className="font-mono text-ink" data-testid="mock-checkout-total">
              {money(Number(chk.total_amount_cents), cur)}
            </dd>
          </div>
        </dl>

        <MockCheckoutClient
          checkoutId={chk.id}
          totalFormatted={money(Number(chk.total_amount_cents), cur)}
          paymentOptionLabel={optionLabel}
          methodKind={chk.method_kind}
          initialStatus={chk.status}
          returnUrl={returnUrl}
        />
      </div>
    </div>
  );
}

export default function MockCheckoutPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" />}>
      <MockCheckoutContent {...props} />
    </Suspense>
  );
}
