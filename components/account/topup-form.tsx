'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, toCents, asCurrency, type Currency } from '@/lib/format';
import { cn } from '@/lib/cn';

type Res<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Preset top-ups (minor units) per currency. */
const PRESETS: Record<Currency, number[]> = { USD: [10000, 25000, 50000, 100000, 500000], CNY: [50000, 100000, 250000, 500000, 2500000] };

/** Top-ups always go to the wallet in the platform `currency` (request_topup locks it server-side). */
export function TopupForm({ disabled, currency: cur, bank, defaultReference, bankAction, cardAction }: {
  disabled: boolean; currency: string;
  bank: { accountName: string; bankDetails: string; virtualAccount: string; reference: string };
  defaultReference: string;
  bankAction: (i: { amountCents: number; reference: string }) => Promise<Res>;
  cardAction: (i: { amountCents: number }) => Promise<Res<{ checkoutUrl: string }>>;
}) {
  const currency = asCurrency(cur);
  const fmt = (n: number) => money(n, currency);
  const presets = PRESETS[currency];
  const [amount, setAmount] = useState(presets[2]);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState<'bank_transfer' | 'card'>('bank_transfer');
  const [reference, setReference] = useState(defaultReference);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const cents = custom ? toCents(custom) : amount;
  const valid = Number.isFinite(cents) && cents >= 100;

  const submit = () => start(async () => {
    setMsg(null);
    if (method === 'bank_transfer') {
      const r = await bankAction({ amountCents: cents, reference });
      if (!r.ok) { setMsg({ tone: 'bad', text: r.error }); return; }
      setConfirming(false);
      setMsg({ tone: 'ok', text: `Thanks — your ${fmt(cents)} top-up is pending until finance matches the transfer.` });
      router.refresh();
    } else {
      const r = await cardAction({ amountCents: cents });
      if (!r.ok) { setMsg({ tone: 'bad', text: r.error }); return; }
      setConfirming(false);
      if (r.data?.checkoutUrl) router.push(r.data.checkoutUrl);
    }
  });

  return (
    <fieldset disabled={disabled || pending} className="disabled:opacity-60">
      <legend className="label">Amount ({currency})</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset amounts">
        {presets.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={!custom && amount === p}
            onClick={() => { setAmount(p); setCustom(''); }}
            className={cn('px-4 py-2 rounded-full border text-sm font-semibold', !custom && amount === p ? 'bg-navy text-white border-navy' : 'bg-white border-line-2')}>
            {fmt(p).replace('.00', '')}
          </button>
        ))}
        <label className="sr-only" htmlFor="topup-custom">Custom amount</label>
        <input id="topup-custom" inputMode="decimal" className="input max-w-[140px] min-h-9" placeholder="Other" value={custom} onChange={(e) => setCustom(e.target.value)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-[10px] bg-surface p-1" role="tablist" aria-label="Payment method">
        {([['bank_transfer', 'Bank transfer'], ['card', 'Card']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} onClick={() => setMethod(k)}
            className={cn('py-2.5 rounded-[8px] text-sm font-semibold', method === k ? 'bg-white shadow-sm text-navy' : 'text-muted')}>{l}</button>
        ))}
      </div>

      {method === 'bank_transfer' ? (
        <div className="mt-4 rounded-[10px] bg-surface p-4">
          <dl className="text-sm divide-y divide-line">
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Account name</dt><dd className="font-semibold text-right">{bank.accountName}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Bank</dt><dd className="font-semibold text-right whitespace-pre-line">{bank.bankDetails}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Your virtual account</dt><dd className="mono font-semibold text-right">{bank.virtualAccount}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Payment reference</dt><dd className="mono font-semibold text-right">{bank.reference}</dd></div>
          </dl>
          <label htmlFor="topup-ref" className="label mt-3">Your transfer reference</label>
          <input id="topup-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </div>
      ) : (
        <p className="mt-4 rounded-[10px] bg-surface p-4 text-sm text-muted">You will be taken to our payment partner to pay by card. <strong>Test mode:</strong> no real charge is made; the top-up stays pending until the payment webhook confirms it.</p>
      )}

      <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div className="text-[15px]">You add <span className="mono text-lg font-bold">{valid ? fmt(cents) : '—'}</span></div>
        <button type="button" className="btn btn-primary" disabled={!valid || (method === 'bank_transfer' && reference.trim().length < 3)} onClick={() => setConfirming(true)}>
          {method === 'bank_transfer' ? 'I have sent the transfer' : 'Continue to card payment'}
        </button>
      </div>
      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={cn('mt-3 text-sm', msg.tone === 'bad' ? 'text-bad' : 'text-ok')}>{msg.text}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="topup-title">
          <div className="card w-full max-w-md p-6">
            <h2 id="topup-title" className="text-xl font-semibold">Confirm top-up</h2>
            <dl className="mt-4 space-y-2 text-[15px]">
              <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd className="mono font-semibold">{fmt(cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Method</dt><dd>{method === 'card' ? 'Card (test mode)' : 'Bank transfer'}</dd></div>
              {method === 'bank_transfer' && <div className="flex justify-between"><dt className="text-muted">Reference</dt><dd className="mono">{reference}</dd></div>}
            </dl>
            <p className="text-sm text-muted mt-3">Your balance is credited once the payment is confirmed.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? 'Submitting…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}
