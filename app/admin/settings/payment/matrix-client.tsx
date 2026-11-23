'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  PAYMENT_PROVIDER_ENV_VARS,
  type PaymentOptionMatrixRow,
  type PaymentProviderName,
  type PaymentProviderSettingRow,
} from '@/lib/payments';
import {
  saveUpcomingLegalEntityAction,
  updatePaymentOptionSettingAction,
  updatePaymentProviderSettingAction,
} from './actions';

type LegalEntityRow = {
  id: string;
  code: string;
  legal_name: string;
  registration_no: string | null;
  tax_id: string | null;
  address: string | null;
  registered_in: string | null;
  default_currency: string;
  active_from: string;
  is_default: boolean;
  status: string;
};

const SERVICE_LABELS: Record<string, string> = {
  sourcing: 'Product sourcing (SRC)',
  brand: 'Make My Brand (MMB)',
  pools: 'Group-buy / MOQ pools (POOL)',
  turnkey: 'Turnkey project Setup (TK)',
  warehouse: '3PL warehousing (3PL)',
  dropship: 'Dropshipping (DS)',
  advertising: 'Advertising',
  saas: 'SaaS subscriptions',
};

const OPTION_LABELS: Record<string, string> = {
  pay_now: '1. Pay now',
  payment_protection: '2. Payment protection',
  pay_later: '3. Pay later',
};

export function PaymentMatrixAndProvidersClient({
  matrix,
  providers,
  entities,
  canEdit,
  isAdmin,
}: {
  matrix: PaymentOptionMatrixRow[];
  providers: PaymentProviderSettingRow[];
  entities: LegalEntityRow[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAnySurcharge = providers.some((p) => p.fee_mode === 'surcharge');

  function handleSaveOption(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await updatePaymentOptionSettingAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not update payment option.');
        return;
      }
      setMessage('Payment option matrix updated and logged to audit log.');
      router.refresh();
    });
  }

  function handleSaveProvider(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await updatePaymentProviderSettingAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not update provider.');
        return;
      }
      setMessage('Provider routing updated.');
      router.refresh();
    });
  }

  function handleSaveEntity(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await saveUpcomingLegalEntityAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not save legal entity.');
        return;
      }
      setMessage('Legal entity saved (active default remains Shenzhen Octopus Trading Co., Ltd.).');
      router.refresh();
    });
  }

  const services = ['sourcing', 'brand', 'pools', 'turnkey', 'warehouse', 'dropship', 'advertising', 'saas'];

  return (
    <div className="space-y-8 mt-6" data-testid="payment-settings-matrix-container">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950" data-testid="payment-settings-saved">
          {message}
        </div>
      )}

      {/* 1. Service × Payment Option Matrix */}
      <section className="card p-6 space-y-4" data-testid="service-payment-option-matrix">
        <div>
          <h2 className="text-lg font-semibold text-ink">Service × Payment Option Matrix (8 Services × 3 Options)</h2>
          <p className="text-xs text-muted mt-1">
            Switch any of the 3 payment options on or off per service, set minimum/maximum order amounts, choose the
            Payment protection release rule, and configure when Pay-later issues the <span className="font-mono">OCT-</span>{' '}
            tax invoice. Every change is recorded in the audit log.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-muted uppercase tracking-wider text-[11px]">
                <th className="py-2.5 pr-3">Service</th>
                <th className="py-2.5 pr-3">Option</th>
                <th className="py-2.5 pr-3">Enabled</th>
                <th className="py-2.5 pr-3">Min (US$ cents)</th>
                <th className="py-2.5 pr-3">Max (US$ cents)</th>
                <th className="py-2.5 pr-3">Protection release / Pay-later trigger</th>
                <th className="py-2.5 text-right">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {services.flatMap((svc) =>
                (['pay_now', 'payment_protection', 'pay_later'] as const).map((opt) => {
                  const row = matrix.find((m) => m.service === svc && m.option === opt);
                  if (!row) return null;
                  const formId = `matrix-${svc}-${opt}`;
                  return (
                    <tr key={`${svc}-${opt}`} data-testid={`matrix-row-${svc}-${opt}`}>
                      <td className="py-2.5 pr-3 font-medium text-ink">{SERVICE_LABELS[svc] ?? svc}</td>
                      <td className="py-2.5 pr-3 font-semibold text-ink">{OPTION_LABELS[opt]}</td>
                      <td className="py-2.5 pr-3">
                        <input
                          form={formId}
                          type="checkbox"
                          name="enabled"
                          defaultChecked={row.enabled}
                          disabled={!canEdit || pending}
                          data-testid={`matrix-toggle-${svc}-${opt}`}
                          className="h-4 w-4 rounded border-line"
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          form={formId}
                          type="number"
                          name="min_amount_cents"
                          defaultValue={row.min_amount_cents}
                          disabled={!canEdit || pending}
                          className="w-24 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          form={formId}
                          type="number"
                          name="max_amount_cents"
                          defaultValue={row.max_amount_cents ?? ''}
                          placeholder="Unlimited"
                          disabled={!canEdit || pending}
                          className="w-24 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        {opt === 'payment_protection' ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              form={formId}
                              name="release_rule"
                              defaultValue={row.release_rule ?? 'milestones'}
                              disabled={!canEdit || pending}
                              className="rounded border border-line bg-canvas px-2 py-1 text-xs"
                            >
                              <option value="milestones">30% prod / 70% QC+shipped</option>
                              <option value="delivery_plus_days">Tracking delivered + N days</option>
                              <option value="pool_close">MOQ pool closes</option>
                              <option value="service_month_end">End of service month</option>
                              <option value="customer_confirmation">Customer confirmation</option>
                            </select>
                            <input
                              form={formId}
                              type="number"
                              name="auto_release_days"
                              defaultValue={row.auto_release_days ?? 7}
                              disabled={!canEdit || pending}
                              title="Auto-release dispute window (days)"
                              className="w-14 rounded border border-line bg-canvas px-1.5 py-1 font-mono text-xs"
                            />
                            <span className="text-muted">d</span>
                          </div>
                        ) : opt === 'pay_later' ? (
                          <select
                            form={formId}
                            name="pay_later_invoice_trigger"
                            defaultValue={row.pay_later_invoice_trigger ?? 'shipment'}
                            disabled={!canEdit || pending}
                            className="rounded border border-line bg-canvas px-2 py-1 text-xs"
                          >
                            <option value="shipment">Invoice at shipment (reserve on order)</option>
                            <option value="order_confirmation">Invoice at order confirmation</option>
                            <option value="period_end">Invoice at end of period (3PL / Ads)</option>
                            <option value="cycle_start">Invoice at start of billing cycle (SaaS)</option>
                          </select>
                        ) : (
                          <span className="text-muted">Immediate settlement</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <form id={formId} action={handleSaveOption}>
                          <input type="hidden" name="service" value={svc} />
                          <input type="hidden" name="option" value={opt} />
                          <button
                            type="submit"
                            disabled={!canEdit || pending}
                            data-testid={`matrix-save-${svc}-${opt}`}
                            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-40"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Online Payment Providers (Stripe, Airwallex, Mock) & Fee Mode */}
      <section className="card p-6 space-y-4" data-testid="payment-providers-section">
        <div>
          <h2 className="text-lg font-semibold text-ink">Online Payment Providers (Stripe, Airwallex &amp; Staging Mock)</h2>
          <p className="text-xs text-muted mt-1">
            Choose which provider handles which payment method. Each provider can be switched on or off independently —
            if one is switched off, checkout automatically routes to the next active provider.
          </p>
        </div>

        {/* Exact compliance warning required by Prompt 2 Answer 5 */}
        <div
          className={`rounded-xl border p-3.5 text-xs ${
            hasAnySurcharge
              ? 'border-amber-400 bg-amber-50 text-amber-950'
              : 'border-line bg-surface text-muted'
          }`}
          data-testid="surcharge-compliance-warning"
        >
          <strong className="text-ink">Aggregator fee mode warning:</strong>{' '}
          Card surcharges are restricted in some countries and by card network rules. Check with the provider before switching on.
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {providers.map((p) => {
            const envInfo = PAYMENT_PROVIDER_ENV_VARS[p.provider as PaymentProviderName];
            return (
              <form
                key={p.provider}
                action={handleSaveProvider}
                data-testid={`provider-card-${p.provider}`}
                className="rounded-xl border border-line bg-canvas p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <input type="hidden" name="provider" value={p.provider} />
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-ink">{p.display_name}</div>
                      <div className="font-mono text-[11px] text-muted">{p.provider}</div>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={p.enabled}
                        disabled={!canEdit || pending}
                        data-testid={`provider-enabled-${p.provider}`}
                      />
                      Active
                    </label>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="block text-muted mb-0.5">Handled methods (comma-separated)</label>
                      <input
                        type="text"
                        name="methods"
                        defaultValue={p.methods.join(', ')}
                        disabled={!canEdit || pending}
                        className="w-full rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-muted mb-0.5">Priority</label>
                        <input
                          type="number"
                          name="priority"
                          defaultValue={p.priority}
                          disabled={!canEdit || pending}
                          className="w-full rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-muted mb-0.5">Fee handling</label>
                        <select
                          name="fee_mode"
                          defaultValue={p.fee_mode}
                          disabled={!canEdit || pending}
                          data-testid={`provider-fee-mode-${p.provider}`}
                          className="w-full rounded border border-line bg-surface px-2 py-1.5 text-xs"
                        >
                          <option value="absorb">Absorb fee (default)</option>
                          <option value="surcharge">Pass surcharge to customer</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-muted mb-0.5">Linked legal entity</label>
                      <select
                        name="legal_entity_id"
                        defaultValue={p.legal_entity_id}
                        disabled={!canEdit || pending}
                        className="w-full rounded border border-line bg-surface px-2 py-1.5 text-xs"
                      >
                        {entities.map((ent) => (
                          <option key={ent.id} value={ent.id}>
                            {ent.legal_name} ({ent.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-lg bg-surface p-2.5 text-[11px]">
                      <div className="font-semibold text-ink">Webhook endpoint</div>
                      <div className="font-mono text-muted break-all">/api/webhooks/payments/{p.provider}</div>
                      <div className="font-semibold text-ink mt-1.5">Required env var names</div>
                      <ul className="font-mono text-muted list-disc list-inside">
                        {envInfo?.envVars.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canEdit || pending}
                  data-testid={`provider-save-${p.provider}`}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-canvas hover:opacity-95 disabled:opacity-40"
                >
                  Save {p.display_name}
                </button>
              </form>
            );
          })}
        </div>
      </section>

      {/* 3. Multi-Company Legal Entities */}
      <section className="card p-6 space-y-4" data-testid="legal-entities-section">
        <div>
          <h2 className="text-lg font-semibold text-ink">Legal Entities &amp; Per-Company Document Series</h2>
          <p className="text-xs text-muted mt-1">
            Every invoice, credit note, proforma, bank account, and payment links to its issuing legal entity. Each
            entity has its own gap-free <span className="font-mono">OCT-</span>, <span className="font-mono">CN-</span>,
            and <span className="font-mono">PF-</span> counter series. Old documents keep their original entity forever.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {entities.map((ent) => (
            <div
              key={ent.id}
              data-testid={`legal-entity-${ent.code}`}
              className={`rounded-xl border p-4 text-xs ${
                ent.is_default ? 'border-emerald-400 bg-emerald-50/40' : 'border-line bg-canvas'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-ink">{ent.code}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    ent.is_default
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {ent.is_default ? 'Current Default Issuing Entity' : ent.status}
                </span>
              </div>
              <div className="mt-1.5 text-sm font-semibold text-ink">{ent.legal_name}</div>
              <div className="mt-1 text-muted space-y-0.5">
                {ent.registered_in && <div>Jurisdiction: {ent.registered_in}</div>}
                {ent.registration_no && <div>Registration No: {ent.registration_no}</div>}
                {ent.tax_id && <div>Tax ID: {ent.tax_id}</div>}
                {ent.address && <div>Address: {ent.address}</div>}
                <div>Default currency: {ent.default_currency}</div>
              </div>
            </div>
          ))}
        </div>

        {isAdmin && (
          <form action={handleSaveEntity} className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <div className="text-xs font-semibold text-ink">
              Prepare upcoming Hong Kong company (does NOT switch current default entity)
            </div>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Entity code</label>
                <input
                  type="text"
                  name="code"
                  defaultValue="HK-OCTOPUS"
                  className="w-full rounded border border-line bg-canvas px-2.5 py-1.5 font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-muted mb-1">Legal company name</label>
                <input
                  type="text"
                  name="legal_name"
                  placeholder="Octopus B2B (Hong Kong) Limited"
                  className="w-full rounded border border-line bg-canvas px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Jurisdiction</label>
                <input
                  type="text"
                  name="registered_in"
                  defaultValue="Hong Kong"
                  className="w-full rounded border border-line bg-canvas px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Registration No (BR / CR)</label>
                <input
                  type="text"
                  name="registration_no"
                  placeholder="Optional until incorporation"
                  className="w-full rounded border border-line bg-canvas px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Registered address</label>
                <input
                  type="text"
                  name="address"
                  placeholder="Hong Kong registered office"
                  className="w-full rounded border border-line bg-canvas px-2.5 py-1.5"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={pending}
              data-testid="save-hk-entity-btn"
              className="inline-flex min-h-10 items-center rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-canvas"
            >
              Save upcoming entity (keep Shenzhen Octopus Trading Co., Ltd. as default)
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
