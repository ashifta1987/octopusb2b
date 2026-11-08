'use client';
import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmCharge } from '@/components/client';
import { money, COUNTRY_NAMES } from '@/lib/format';
import { joinSchema } from './schema';
import { priceAt, SAVED_KEY, type PoolTier } from './shared';
import { joinPool } from '@/app/(store)/pool/actions';

export type AddressOpt = { id: string; label: string | null; line1: string; city: string | null; country: string };
export type JoinPoolProps = {
  pool: { id: string; code: string; currency: string; min_pledge: number; filled_qty: number; target_qty: number; deposit_pct: number; tiers: PoolTier[]; unit: string; unitOne: string };
  addresses: AddressOpt[]; walletEnabled: boolean; walletBalance: number; walletCredit?: number; termsId: string | null; company: string;
};

const fmt = (n: number) => n.toLocaleString('en-US');

/* localStorage "Save, decide later" — read through an external store so SSR and hydration agree. */
function subscribeStorage(cb: () => void) { window.addEventListener('storage', cb); window.addEventListener('octopus-pools-saved', cb); return () => { window.removeEventListener('storage', cb); window.removeEventListener('octopus-pools-saved', cb); }; }
const readSaved = () => { try { return window.localStorage.getItem(SAVED_KEY) ?? ''; } catch { return ''; } };
export function savedPools(raw: string): Record<string, { qty: number; savedAt: string }> { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
export function writeSaved(code: string, entry: { qty: number; savedAt: string } | null) {
  const all = savedPools(readSaved());
  if (entry) all[code] = entry; else delete all[code];
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(all)); } catch { /* storage disabled */ }
  window.dispatchEvent(new Event('octopus-pools-saved'));
}

export function AddressFields({ prefix, values, onChange, errors }: {
  prefix: string; values: Record<string, string>; onChange: (k: string, v: string) => void; errors?: string | null;
}) {
  const f = (k: string, label: string, auto: string, req = true) => (
    <div className={k === 'line1' ? 'col-span-2' : ''}>
      <label htmlFor={`${prefix}-${k}`} className="label">{label}{req && <span aria-hidden className="text-bad"> *</span>}</label>
      <input id={`${prefix}-${k}`} className="input" autoComplete={auto} required={req} value={values[k] ?? ''} onChange={(e) => onChange(k, e.target.value)} />
    </div>
  );
  return (
    <fieldset className="grid grid-cols-2 gap-3 rounded-[10px] border border-line p-3 mt-2">
      <legend className="text-[12px] font-semibold px-1">New shipping address</legend>
      {f('label', 'Company / label', 'organization', false)}
      {f('postal_code', 'Postcode', 'postal-code', false)}
      {f('line1', 'Street address', 'address-line1')}
      {f('city', 'City', 'address-level2')}
      <div>
        <label htmlFor={`${prefix}-country`} className="label">Country<span aria-hidden className="text-bad"> *</span></label>
        <select id={`${prefix}-country`} className="input" autoComplete="country" value={values.country ?? ''} onChange={(e) => onChange('country', e.target.value)} required>
          <option value="">Choose…</option>
          {Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      {errors && <p className="col-span-2 text-[12px] text-bad" role="alert">{errors}</p>}
    </fieldset>
  );
}

/** Pool.png "Join this pool" form — zod-validated, live deposit maths in the pool currency, ConfirmCharge for wallet deposits. */
export function JoinPoolForm({ pool, addresses, walletEnabled, walletBalance, walletCredit = 0, termsId, company }: JoinPoolProps) {
  const router = useRouter();
  const savedRaw = useSyncExternalStore(subscribeStorage, readSaved, () => '');
  const saved = savedPools(savedRaw)[pool.code];
  const defaultQty = Math.max(pool.min_pledge, Math.min(Math.max(pool.target_qty - pool.filled_qty, pool.min_pledge), pool.min_pledge * 5));
  const [qtyInput, setQty] = useState<string | null>(null);
  const qtyStr = qtyInput ?? String(saved?.qty ?? defaultQty);
  const [addressId, setAddressId] = useState<string>(addresses.find(() => true)?.id ?? 'new');
  const [na, setNa] = useState<Record<string, string>>({ country: '' });
  const [paySource, setPay] = useState<'wallet' | 'card'>(walletEnabled ? 'wallet' : 'card');
  const [terms, setTerms] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const qty = Math.max(0, Math.floor(Number(qtyStr) || 0));
  const m = useMemo(() => {
    const now = priceAt(pool.tiers, pool.filled_qty + qty) ?? 0;
    const part = now * qty;
    const deposit = Math.round((part * pool.deposit_pct) / 100);
    const final = priceAt(pool.tiers, Math.max(pool.target_qty, pool.filled_qty + qty)) ?? now;
    const base = pool.tiers[0]?.unit_price_minor ?? final;
    const balance = Math.max(0, final * qty - deposit);
    const saving = Math.max(0, (base - final) * qty);
    return { now, part, deposit, final, base, balance, saving, savingPct: base > 0 ? Math.round(((base - final) / base) * 100) : 0 };
  }, [pool, qty]);

  const values: Record<string, unknown> = {
    poolId: pool.id, qty: qtyStr as unknown as number, addressId: addressId === 'none' ? '' : addressId,
    newAddress: addressId === 'new' ? { label: na.label, line1: na.line1 ?? '', city: na.city ?? '', postal_code: na.postal_code, country: na.country ?? '' } : undefined,
    paySource, terms, termsId,
  };
  const parsed = joinSchema(pool.min_pledge).safeParse(values);
  const issues = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
  const insufficient = paySource === 'wallet' && walletBalance + walletCredit < m.deposit;

  const submit = async () => {
    if (!parsed.success) return { ok: false, error: 'Check the form' };
    const r = await joinPool({ ...parsed.data, code: pool.code });
    if (!r.ok) {
      if (r.login) { window.location.assign(r.login); return { ok: true }; }
      setErr(r.error);
      return { ok: false, error: r.error };
    }
    writeSaved(pool.code, null);
    setDone(r.message ?? 'Joined');
    router.refresh();
    return { ok: true };
  };

  const err1 = (k: string) => (showErrors && issues[k] ? <p className="text-[12px] text-bad mt-1" role="alert">{issues[k]}</p> : null);
  const row = (l: React.ReactNode, v: React.ReactNode, cls = '') => <div className={`flex justify-between gap-3 ${cls}`}><dt className="text-black">{l}</dt><dd className="mono font-semibold">{v}</dd></div>;

  if (done) return <div role="status" className="rounded-[10px] border border-ok/40 bg-ok-bg text-ok px-4 py-3 text-sm font-semibold">✓ {done}</div>;

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()} aria-label={`Join pool ${pool.code}`}>
      <div>
        <label htmlFor="pledge-qty" className="label">Your pledge ({pool.unit})</label>
        <div className="flex rounded-[8px] border border-line-strong overflow-hidden focus-within:ring-2 focus-within:ring-coral-text">
          <span className="px-3 flex items-center bg-pearl border-r border-line-strong mono text-[13px] text-muted" aria-hidden>{pool.unit}</span>
          <input id="pledge-qty" inputMode="numeric" className="flex-1 min-w-0 px-3 py-2.5 mono text-[15px] outline-none" value={qtyStr}
            aria-invalid={showErrors && !!issues.qty} aria-describedby="pledge-hint" onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} />
        </div>
        <div id="pledge-hint" className="flex justify-between text-[12px] text-muted mt-1"><span>Min {fmt(pool.min_pledge)} {pool.unit}</span><span>You pay for what you pledge</span></div>
        {err1('qty')}
      </div>

      <div>
        <label htmlFor="ship-to" className="label">Ship to</label>
        <select id="ship-to" className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
          {addresses.map((a) => <option key={a.id} value={a.id}>{[a.label ?? company, a.line1, a.city, a.country].filter(Boolean).join(' · ')}</option>)}
          <option value="new">+ Add a new address</option>
          <option value="none">Decide later (before the balance is due)</option>
        </select>
        {addressId === 'new' && <AddressFields prefix="join" values={na} onChange={(k, v) => setNa((s) => ({ ...s, [k]: v }))} errors={showErrors ? issues.newAddress : null} />}
      </div>

      <dl className="space-y-1.5 text-[14px] border-t border-line pt-3">
        {row(<>Your part at pool price <span className="text-muted text-[12px]">({money(m.now, pool.currency)}/{pool.unitOne})</span></>, money(m.part, pool.currency))}
        {row(`${pool.deposit_pct}% deposit now (held in escrow)`, money(m.deposit, pool.currency))}
        {row('Balance when pool fills (est.)', money(m.balance, pool.currency))}
        {m.saving > 0 && row(`If pool fills (−${m.savingPct}%)`, <span className="text-ok">saves {money(m.saving, pool.currency)}</span>)}
      </dl>

      <fieldset>
        <legend className="label">Pay deposit from</legend>
        <div className="space-y-2">
          <label className={`flex items-center gap-3 rounded-[10px] border-2 px-4 py-3 cursor-pointer ${paySource === 'wallet' ? 'border-coral-text bg-tint/40' : 'border-line'} ${!walletEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input type="radio" name="pay" value="wallet" checked={paySource === 'wallet'} disabled={!walletEnabled} onChange={() => setPay('wallet')} className="accent-coral" />
            <span><span className="font-semibold">Wallet</span> · balance <span className="mono">{money(walletBalance, pool.currency)}</span>{walletCredit > 0 && <> · credit <span className="mono">{money(walletCredit, pool.currency)}</span></>}{!walletEnabled && ' (wallet switched off)'}</span>
          </label>
          <label className={`flex items-center gap-3 rounded-[10px] border-2 px-4 py-3 cursor-pointer ${paySource === 'card' ? 'border-coral-text bg-tint/40' : 'border-line'}`}>
            <input type="radio" name="pay" value="card" checked={paySource === 'card'} onChange={() => setPay('card')} className="accent-coral" />
            <span className="font-semibold">Bank transfer</span>
          </label>
        </div>
        {paySource === 'wallet' && insufficient && <p className="text-[12px] text-bad mt-1.5">{walletCredit > 0 ? 'Your wallet balance plus credit limit is below the deposit.' : 'Your wallet balance is below the deposit.'} <Link href="/account/wallet" className="underline">Top up</Link> or pay by bank transfer.</p>}
        {paySource === 'card' && <p className="text-[12px] text-muted mt-1.5">Your pledge is reserved now; Octopus confirms the deposit when your payment arrives. Unpaid pledges lapse when the pool fills.</p>}
      </fieldset>

      <div>
        <label className="flex items-start gap-2.5 text-[13px] cursor-pointer">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 w-4 h-4 accent-coral" aria-invalid={showErrors && !!issues.terms} />
          <span>I agree to the <Link href="/pools/terms" target="_blank" className="text-coral-text font-semibold underline">Group Buy Terms</Link>. If the pool fills, my pledge becomes a firm order.</span>
        </label>
        {err1('terms')}
      </div>

      {err && <p className="text-sm text-bad" role="alert">{err}</p>}

      {!parsed.success ? (
        <button type="button" className="btn btn-primary w-full min-h-12" onClick={() => setShowErrors(true)}>Join pool · pay {money(m.deposit, pool.currency)} deposit</button>
      ) : paySource === 'wallet' ? (
        <ConfirmCharge label={`Join pool · pay ${money(m.deposit, pool.currency)} deposit`} title={`Join ${pool.code} — deposit from your wallet`} priceCents={m.deposit}
          balanceCents={walletBalance} creditCents={walletCredit} walletEnabled currency={pool.currency} buttonClass="btn btn-primary w-full min-h-12" onConfirm={submit} />
      ) : (
        <>
          <button type="button" className="btn btn-primary w-full min-h-12" onClick={() => { setErr(null); setCardOpen(true); }}>Join pool · reserve {money(m.deposit, pool.currency)} deposit</button>
          {cardOpen && (
            <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="card-title">
              <div className="card w-full max-w-md p-6">
                <h2 id="card-title" className="text-xl font-semibold">Reserve your pledge in {pool.code}</h2>
                <dl className="mt-4 space-y-2 text-[15px]">
                  {row('Pledge', `${fmt(qty)} ${pool.unit}`)}
                  {row('Deposit to pay by bank transfer', money(m.deposit, pool.currency))}
                </dl>
                <p className="text-sm text-muted mt-3">Nothing is taken from your wallet. Pay the deposit using the details in your account; your pledge counts as paid once Octopus confirms it.</p>
                {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setCardOpen(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => { const r = await submit(); if (r.ok) setCardOpen(false); })}>{pending ? 'Processing…' : 'Confirm pledge'}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <button type="button" className="btn btn-ghost w-full" onClick={() => { writeSaved(pool.code, { qty, savedAt: new Date().toISOString() }); }}>
        {saved && saved.qty === qty ? '✓ Saved on this device' : 'Save, decide later'}
      </button>
    </form>
  );
}
