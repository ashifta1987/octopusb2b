'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmCharge } from '@/components/client';
import { money } from '@/lib/format';
import { startSchema } from './schema';
import { priceAt, type PoolTier } from './shared';
import { AddressFields, type AddressOpt } from './join-form';
import { startPool } from '@/app/(store)/pool/actions';

const fmt = (n: number) => n.toLocaleString('en-US');

export type StartPoolProps = {
  product: { id: string; title: string; unit: string; unitOne: string; moq: number; tiers: PoolTier[]; currency: string };
  rules: { minDays: number; maxDays: number; defaultDays: number; depositPct: number; minPledge: number; maxBuyers: number };
  addresses: AddressOpt[]; walletEnabled: boolean; walletBalance: number; walletCredit?: number; company: string;
};

/** Start a pool (SPEC §18): target (≥ MOQ, quick picks for the next tiers), deadline, minimum pledge, and the starter's own pledge. */
export function StartPoolForm({ product: pr, rules, addresses, walletEnabled, walletBalance, walletCredit = 0, company }: StartPoolProps) {
  const router = useRouter();
  const picks = [...new Set([pr.moq, ...pr.tiers.map((t) => t.min_qty).filter((q) => q >= pr.moq)])].sort((a, b) => a - b).slice(0, 4);
  const [target, setTarget] = useState(String(picks[1] ?? pr.moq));
  const [days, setDays] = useState(String(rules.defaultDays));
  const [minPledge, setMinPledge] = useState(String(Math.min(rules.minPledge, pr.moq)));
  const [qty, setQty] = useState(String(Math.max(Math.min(rules.minPledge, pr.moq), Math.round(pr.moq / 5))));
  const [addressId, setAddressId] = useState<string>(addresses[0]?.id ?? 'new');
  const [na, setNa] = useState<Record<string, string>>({ country: '' });
  const [paySource, setPay] = useState<'wallet' | 'card'>(walletEnabled ? 'wallet' : 'card');
  const [terms, setTerms] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const values = {
    productId: pr.id, targetQty: target, days, minPledge, qty, addressId: addressId === 'none' ? '' : addressId,
    newAddress: addressId === 'new' ? { label: na.label, line1: na.line1 ?? '', city: na.city ?? '', postal_code: na.postal_code, country: na.country ?? '' } : undefined,
    paySource, terms,
  };
  const parsed = startSchema({ moq: pr.moq, minDays: rules.minDays, maxDays: rules.maxDays }).safeParse(values);
  const issues = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
  const e1 = (k: string) => (showErrors && issues[k] ? <p className="text-[12px] text-bad mt-1" role="alert">{issues[k]}</p> : null);

  const q = Math.max(0, Number(qty) || 0), t = Math.max(0, Number(target) || 0);
  const m = useMemo(() => {
    const now = priceAt(pr.tiers, q) ?? 0;
    const deposit = Math.round((now * q * rules.depositPct) / 100);
    const final = priceAt(pr.tiers, Math.max(t, q)) ?? now;
    const base = pr.tiers[0]?.unit_price_minor ?? final;
    return { now, deposit, final, base, savingPct: base > 0 ? Math.round(((base - final) / base) * 100) : 0 };
  }, [pr.tiers, q, t, rules.depositPct]);

  const submit = async () => {
    if (!parsed.success) return { ok: false, error: 'Check the form' };
    const r = await startPool(parsed.data);
    if (!r.ok) {
      if (r.login) { window.location.assign(r.login); return { ok: true }; }
      setErr(r.error); return { ok: false, error: r.error };
    }
    router.push(`/pool/${r.data?.code ?? ''}`);
    return { ok: true };
  };
  const num = (id: string, label: string, val: string, set: (v: string) => void, hint?: React.ReactNode) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} inputMode="numeric" className="input mono" value={val} onChange={(e) => set(e.target.value.replace(/[^\d]/g, ''))} aria-invalid={showErrors && !!issues[id]} />
      {hint && <div className="text-[12px] text-muted mt-1">{hint}</div>}
    </div>
  );

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => e.preventDefault()} aria-label="Start a pool">
      <section className="card p-6 space-y-4" aria-labelledby="s1">
        <h2 id="s1" className="text-[18px] font-bold">1 · Pool size and deadline</h2>
        <div>
          {num('targetQty', `Target quantity (${pr.unit})`, target, setTarget, <>At least the MOQ ({fmt(pr.moq)} {pr.unit}). Raise it to unlock a lower tier for everyone.</>)}
          <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Quick picks">
            {picks.map((p) => {
              const price = priceAt(pr.tiers, p);
              return (
                <button key={p} type="button" onClick={() => setTarget(String(p))} aria-pressed={Number(target) === p}
                  className={`px-3 py-1.5 rounded-full border text-[13px] ${Number(target) === p ? 'bg-ink text-white border-ink' : 'bg-white border-line-strong'}`}>
                  {fmt(p)} {pr.unit}{price != null && <span className="opacity-80"> · {money(price, pr.currency)}/{pr.unitOne}</span>}
                </button>
              );
            })}
          </div>
          {e1('targetQty')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="days" className="label">Deadline (days)</label>
            <input id="days" type="number" min={rules.minDays} max={rules.maxDays} className="input mono" value={days} onChange={(e) => setDays(e.target.value)} />
            <div className="text-[12px] text-muted mt-1">{rules.minDays}–{rules.maxDays} days from opening · default {rules.defaultDays}</div>
            {e1('days')}
          </div>
          <div>
            {num('minPledge', `Minimum pledge per buyer (${pr.unit})`, minPledge, setMinPledge, `Default ${fmt(rules.minPledge)}. Up to ${rules.maxBuyers} buyers per pool.`)}
            {e1('minPledge')}
          </div>
        </div>
      </section>

      <section className="card p-6 space-y-4" aria-labelledby="s2">
        <h2 id="s2" className="text-[18px] font-bold">2 · Your own pledge</h2>
        <div>{num('qty', `Your pledge (${pr.unit})`, qty, setQty, 'You pay for what you pledge.')}{e1('qty')}</div>
        <div>
          <label htmlFor="start-ship" className="label">Ship to</label>
          <select id="start-ship" className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{[a.label ?? company, a.line1, a.city, a.country].filter(Boolean).join(' · ')}</option>)}
            <option value="new">+ Add a new address</option>
            <option value="none">Decide later (before the balance is due)</option>
          </select>
          {addressId === 'new' && <AddressFields prefix="start" values={na} onChange={(k, v) => setNa((s) => ({ ...s, [k]: v }))} errors={showErrors ? issues.newAddress : null} />}
        </div>
        <dl className="space-y-1.5 text-[14px] border-t border-line pt-3">
          <div className="flex justify-between"><dt>Price at your pledge alone</dt><dd className="mono font-semibold">{money(m.now, pr.currency)} / {pr.unitOne}</dd></div>
          <div className="flex justify-between"><dt>{rules.depositPct}% deposit now (held in escrow)</dt><dd className="mono font-semibold">{money(m.deposit, pr.currency)}</dd></div>
          <div className="flex justify-between"><dt>Price if the pool fills</dt><dd className="mono font-semibold">{money(m.final, pr.currency)} / {pr.unitOne}{m.savingPct > 0 && <span className="text-ok"> (−{m.savingPct}%)</span>}</dd></div>
        </dl>
        <fieldset>
          <legend className="label">Pay deposit from</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex items-center gap-3 rounded-[10px] border-2 px-4 py-3 ${paySource === 'wallet' ? 'border-coral-text bg-tint/40' : 'border-line'} ${!walletEnabled ? 'opacity-50' : 'cursor-pointer'}`}>
              <input type="radio" name="spay" checked={paySource === 'wallet'} disabled={!walletEnabled} onChange={() => setPay('wallet')} className="accent-coral" />
              <span><b>Wallet</b> · <span className="mono">{money(walletBalance, pr.currency)}</span>{walletCredit > 0 && <> · credit <span className="mono">{money(walletCredit, pr.currency)}</span></>}</span>
            </label>
            <label className={`flex items-center gap-3 rounded-[10px] border-2 px-4 py-3 cursor-pointer ${paySource === 'card' ? 'border-coral-text bg-tint/40' : 'border-line'}`}>
              <input type="radio" name="spay" checked={paySource === 'card'} onChange={() => setPay('card')} className="accent-coral" />
              <b>Bank transfer</b>
            </label>
          </div>
          {paySource === 'wallet' && walletBalance + walletCredit < m.deposit && <p className="text-[12px] text-bad mt-1.5">Wallet balance is below the deposit. <Link href="/account/wallet" className="underline">Top up</Link> or pay by bank transfer.</p>}
        </fieldset>
        <div>
          <label className="flex items-start gap-2.5 text-[13px] cursor-pointer">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 w-4 h-4 accent-coral" />
            <span>I agree to the <Link href="/pools/terms" target="_blank" className="text-coral-text font-semibold underline">Group Buy Terms</Link>. If the pool fills, my pledge becomes a firm order.</span>
          </label>
          {e1('terms')}
        </div>
        {err && <p className="text-sm text-bad" role="alert">{err}</p>}
        {!parsed.success ? (
          <button type="button" className="btn btn-primary w-full" onClick={() => setShowErrors(true)}>Open pool · pay {money(m.deposit, pr.currency)} deposit</button>
        ) : paySource === 'wallet' ? (
          <ConfirmCharge label={`Open pool · pay ${money(m.deposit, pr.currency)} deposit`} title="Open the pool — deposit from your wallet" priceCents={m.deposit}
            balanceCents={walletBalance} creditCents={walletCredit} walletEnabled currency={pr.currency} buttonClass="btn btn-primary w-full" onConfirm={submit} />
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={() => {
            if (!window.confirm(`Open the pool and reserve your ${fmt(q)} ${pr.unit} pledge? Pay the ${money(m.deposit, pr.currency)} deposit by bank transfer; your pledge counts once Octopus confirms it.`)) return;
            setErr(null); start(async () => { await submit(); });
          }}>{pending ? 'Opening…' : `Open pool · reserve ${money(m.deposit, pr.currency)} deposit`}</button>
        )}
      </section>
    </form>
  );
}
