'use client';
import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { money, CURRENCIES, type Currency } from '@/lib/format';
import { previewImpact, requestSwitch } from '@/app/admin/currency/actions';
import { goStepUp, StepUpLink } from '@/components/admin/client';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

/** datetime-local input (browser time) + hidden ISO field so the server gets an unambiguous instant. */
export function LocalDateTimeInput({ id, name, isoName, required, disabled }: { id: string; name: string; isoName: string; required?: boolean; disabled?: boolean }) {
  const [v, setV] = useState('');
  let iso = '';
  if (v) { const d = new Date(v); if (!Number.isNaN(d.getTime())) iso = d.toISOString(); }
  return (
    <>
      <input id={id} name={name} type="datetime-local" className="input" value={v} onChange={(e) => setV(e.target.value)} required={required} disabled={disabled} />
      <input type="hidden" name={isoName} value={iso} />
    </>
  );
}

type Impact = {
  from?: string; to?: string;
  open_quotes?: Record<string, number> | null;
  open_pis?: Record<string, number> | null;
  wallets?: Record<string, { wallets: number; total_minor: number }> | null;
  active_ad_budgets?: Record<string, { campaigns: number; daily_budget_minor: number }> | null;
  services_without_price?: string[] | null;
  payment_adapter_supports?: boolean;
};

/** Admin › Currency switch wizard (SPEC §15.1): target, rate, wallet option, effective time, impact preview, submit. */
export function CurrencySwitchWizard({ current, rate, serviceNames, pending }: {
  current: Currency; rate: number; serviceNames: Record<string, string>; pending: boolean;
}) {
  const others = CURRENCIES.filter((c) => c !== current);
  const [to, setTo] = useState<Currency>(others[0] ?? 'CNY');
  const [timing, setTiming] = useState<'now' | 'scheduled'>('now');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactFor, setImpactFor] = useState<Currency | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [state, formAction, submitting] = useActionState(async (_p: R | null, fd: FormData) => {
    const r = await requestSwitch(_p, fd);
    goStepUp(r);   // SPEC §17.3 step-up → /staff/verify and back
    return r;
  }, null);

  const preview = () => {
    setErr(null);
    start(async () => {
      const r = await previewImpact(to);
      if (r.ok) { setImpact(r.impact as Impact); setImpactFor(to); } else { setImpact(null); setErr(r.error); }
    });
  };
  const fresh = impact && impactFor === to;
  const blocked = !!fresh && impact.payment_adapter_supports === false;
  const canSubmit = !!fresh && !blocked && !pending && !submitting;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!canSubmit) { e.preventDefault(); return; }
        if (!window.confirm(`Request a platform currency switch ${current} → ${to}? A Finance user (not you) must approve it before it applies.`)) e.preventDefault();
      }}
      className="px-6 pb-6 grid gap-5"
    >
      <ol className="grid gap-5">
        <li className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sw-to">1 · Target currency</label>
            <select id="sw-to" name="to" className="input" value={to} onChange={(e) => setTo(e.target.value as Currency)}>
              {others.map((c) => <option key={c} value={c}>{c === 'CNY' ? 'CNY — Chinese yuan (CN¥)' : 'USD — US dollar (US$)'}</option>)}
            </select>
            <p className="text-xs text-muted mt-1">Currently active: <b>{current}</b></p>
          </div>
          <div>
            <label className="label" htmlFor="sw-rate">2 · Switch rate (CNY per 1 USD)</label>
            <input id="sw-rate" name="rate" className="input mono" inputMode="decimal" defaultValue={String(rate)} required pattern="[0-9]+([.,][0-9]{1,6})?" />
            <p className="text-xs text-muted mt-1">Becomes the approved billing rate when the switch applies. e.g. US$ 190.00 → {money(Math.round(19000 * rate), 'CNY')}</p>
          </div>
        </li>

        <li>
          <fieldset>
            <legend className="label">3 · Customer wallets</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex gap-3 rounded-[10px] border border-line p-4 has-[:checked]:border-coral-text has-[:checked]:bg-tint">
                <input type="radio" name="wallet_option" value="keep" defaultChecked className="mt-1" />
                <span><b>Keep balances</b><span className="block text-sm text-muted">Existing {current} balances stay spendable as they are. New charges use the {to} wallet; customers top up in {to}. Nothing is converted.</span></span>
              </label>
              <label className="flex gap-3 rounded-[10px] border border-line p-4 has-[:checked]:border-coral-text has-[:checked]:bg-tint">
                <input type="radio" name="wallet_option" value="convert" className="mt-1" />
                <span><b>Convert balances</b><span className="block text-sm text-muted">Every positive {current} balance is moved to the {to} wallet at the switch rate through a conversion journal (fx_conversion), shown on each customer’s ledger.</span></span>
              </label>
            </div>
          </fieldset>
        </li>

        <li className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="label">4 · Effective time</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="timing" value="now" checked={timing === 'now'} onChange={() => setTiming('now')} /> As soon as Finance approves</label>
              <label className="flex items-center gap-2"><input type="radio" name="timing" value="scheduled" checked={timing === 'scheduled'} onChange={() => setTiming('scheduled')} /> At a scheduled time</label>
            </div>
            {timing === 'scheduled' && (
              <div className="mt-3">
                <label className="label" htmlFor="sw-at">Effective at (your local time)</label>
                <LocalDateTimeInput id="sw-at" name="effective_at" isoName="effective_at_iso" required />
                <p className="text-xs text-muted mt-1">A job applies approved switches every 5 minutes.</p>
              </div>
            )}
          </fieldset>
          <div>
            <label className="label" htmlFor="sw-note">Note (optional)</label>
            <textarea id="sw-note" name="note" className="input min-h-20 py-2" maxLength={500} placeholder="Reason for the switch" />
          </div>
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="button" className="btn btn-ghost" onClick={preview} disabled={loading}>{loading ? 'Loading…' : '5 · Preview impact'}</button>
        {err && <span role="alert" className="text-sm text-bad">{err}</span>}
        {!fresh && !err && <span className="text-sm text-muted">Preview the impact before you submit.</span>}
      </div>

      {fresh && <ImpactView impact={impact} to={to} serviceNames={serviceNames} />}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>{submitting ? 'Submitting…' : 'Submit for Finance approval'}</button>
        {pending && <span className="text-sm text-warn">A switch is already pending or scheduled — approve or cancel it first.</span>}
        {blocked && <span role="alert" className="text-sm text-bad">Blocked: the payment adapter does not support {to}.</span>}
        {state && (state.ok
          ? <span role="status" className="text-sm text-ok font-semibold">✓ {state.message}</span>
          : state.error === 'STEP_UP_REQUIRED'
            ? <span role="alert" className="inline-flex items-center gap-2 text-sm text-bad">Please re-enter your 2FA code. <StepUpLink redirect={state.redirect} /></span>
            : <span role="alert" className="text-sm text-bad">{state.error}</span>)}
      </div>
    </form>
  );
}

function CountList({ m, unit }: { m: Record<string, number> | null | undefined; unit: string }) {
  const entries = Object.entries(m ?? {});
  if (!entries.length) return <span className="text-muted">None</span>;
  return <>{entries.map(([c, n]) => <div key={c}><span className="mono font-semibold">{n}</span> {unit} in <b>{c}</b></div>)}</>;
}

export function ImpactView({ impact, to, serviceNames }: { impact: Impact; to: string; serviceNames: Record<string, string> }) {
  const wallets = Object.entries(impact.wallets ?? {});
  const ads = Object.entries(impact.active_ad_budgets ?? {});
  const missing = impact.services_without_price ?? [];
  const supports = impact.payment_adapter_supports !== false;
  return (
    <section aria-label="Impact preview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-[10px] border border-line p-4 text-sm">
        <h3 className="font-semibold mb-1">Open quotes</h3>
        <CountList m={impact.open_quotes} unit="quotes" />
        <p className="text-xs text-muted mt-2">They keep their locked currency and rate.</p>
      </div>
      <div className="rounded-[10px] border border-line p-4 text-sm">
        <h3 className="font-semibold mb-1">Open proforma invoices</h3>
        <CountList m={impact.open_pis} unit="PIs / orders awaiting payment" />
        <p className="text-xs text-muted mt-2">They are still paid in their own currency.</p>
      </div>
      <div className="rounded-[10px] border border-line p-4 text-sm">
        <h3 className="font-semibold mb-1">Wallet balances</h3>
        {wallets.length ? wallets.map(([c, w]) => (
          <div key={c}><span className="mono font-semibold">{money(w.total_minor, c)}</span> in {w.wallets} non-zero {c} wallets</div>
        )) : <span className="text-muted">No wallets</span>}
      </div>
      <div className="rounded-[10px] border border-line p-4 text-sm">
        <h3 className="font-semibold mb-1">Active ad budgets</h3>
        {ads.length ? ads.map(([c, a]) => (
          <div key={c}>{a.campaigns} campaigns · <span className="mono font-semibold">{money(a.daily_budget_minor, c)}</span>/day</div>
        )) : <span className="text-muted">No active campaigns</span>}
        <p className="text-xs text-muted mt-2">Campaigns keep their locked currency.</p>
      </div>
      <div className="rounded-[10px] border border-line p-4 text-sm">
        <h3 className="font-semibold mb-1">Services without a {to} price</h3>
        {missing.length ? (
          <>
            <ul className="list-disc pl-5">{missing.map((c) => <li key={c}>{serviceNames[c] ?? c} <span className="mono text-xs text-muted">{c}</span></li>)}</ul>
            <p className="text-xs text-muted mt-2">These will be converted from USD and marked “converted”. <Link href="/admin/services" className="text-coral-text font-semibold">Set {to} prices</Link></p>
          </>
        ) : <span className="text-ok font-semibold">✓ All active services have a {to} price</span>}
      </div>
      <div className={`rounded-[10px] border p-4 text-sm ${supports ? 'border-line' : 'border-bad bg-bad-bg'}`}>
        <h3 className="font-semibold mb-1">Payment adapter</h3>
        {supports
          ? <span className="text-ok font-semibold">✓ Supports {to}</span>
          : <span className="text-bad font-semibold">✗ Does not support {to} — switch blocked. <Link href="/admin/integrations" className="underline">Integrations</Link></span>}
      </div>
    </section>
  );
}
