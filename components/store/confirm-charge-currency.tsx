'use client';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';

/**
 * ConfirmCharge with an explicit currency (SPEC §8.2 + §15.1): shows the charge and the wallet balance
 * of the SAME currency before any deduction. Mirrors components/client.tsx ConfirmCharge, which is USD-only;
 * store + account screens use this variant until the shared component gets a `currency` prop.
 */
export function ConfirmChargeCurrency({
  label, title, priceCents, balanceCents, currency, walletEnabled, onConfirm, className, buttonClass = 'btn btn-primary', walletLabel = 'Wallet balance',
}: {
  label: string; title: string; priceCents: number; balanceCents: number | null; currency: string; walletEnabled: boolean;
  onConfirm: () => Promise<{ ok: boolean; error?: string } | void>; className?: string; buttonClass?: string; walletLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const insufficient = walletEnabled && balanceCents != null && balanceCents < priceCents;
  const fmt = (n: number | null) => money(n, currency);
  return (
    <>
      <button type="button" className={cn(buttonClass, className)} onClick={() => { setErr(null); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ccc-title">
          <div className="card w-full max-w-md p-6">
            <h2 id="ccc-title" className="text-xl font-semibold">{title}</h2>
            <dl className="mt-4 space-y-2 text-[15px]">
              <div className="flex justify-between"><dt className="text-muted">Charge</dt><dd className="mono font-semibold">{fmt(priceCents)}</dd></div>
              {walletEnabled ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted">{walletLabel} ({currency})</dt><dd className="mono">{fmt(balanceCents)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Balance after</dt><dd className={cn('mono font-semibold', insufficient && 'text-bad')}>{fmt((balanceCents ?? 0) - priceCents)}</dd></div>
                </>
              ) : (
                <p className="text-sm text-muted">The wallet is switched off — this charge will be added to your next invoice / card payment.</p>
              )}
            </dl>
            {insufficient && <p className="mt-3 text-sm text-bad">Insufficient {currency} wallet balance. <a href="/account/wallet" className="underline">Top up your wallet</a>.</p>}
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={pending || insufficient} onClick={() => start(async () => {
                const r = await onConfirm();
                if (r && !r.ok) setErr(r.error ?? 'Failed'); else setOpen(false);
              })}>{pending ? 'Processing…' : priceCents > 0 ? `Confirm ${fmt(priceCents)}` : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
