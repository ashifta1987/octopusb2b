'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmChargeCurrency } from '@/components/store/confirm-charge-currency';

type Res = { ok: true } | { ok: false; error: string };

/** Pays from the wallet in the ORDER's currency (record_payment debits wallet(order.currency)); `balanceCents` = that wallet. */
export function PayWalletButton({ orderId, amountCents, balanceCents, creditCents = 0, currency, purpose, action }: {
  orderId: string; amountCents: number; balanceCents: number; creditCents?: number; currency: string; purpose: 'deposit' | 'balance'; action: (id: string) => Promise<Res>;
}) {
  const router = useRouter();
  return (
    <ConfirmChargeCurrency
      label={`Pay ${purpose} from ${currency} wallet`}
      title={`Pay the ${purpose} from your ${currency} wallet`}
      priceCents={amountCents}
      balanceCents={balanceCents}
      creditCents={creditCents}
      currency={currency}
      walletEnabled
      onConfirm={async () => {
        const r = await action(orderId);
        if (r.ok) router.refresh();
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }}
    />
  );
}

export function CancelOrderButton({ orderId, orderCode, action }: { orderId: string; orderCode: string; action: (id: string, reason?: string) => Promise<Res> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => { setErr(null); setOpen(true); }}>Cancel order</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
          <div className="card w-full max-w-md p-6">
            <h2 id="cancel-title" className="text-xl font-semibold">Cancel {orderCode}?</h2>
            <p className="text-sm text-muted mt-1">You can cancel until the deposit is paid. The proforma invoice will be voided. This cannot be undone.</p>
            <label htmlFor="cancel-reason" className="label mt-4">Reason (optional)</label>
            <textarea id="cancel-reason" className="input py-2 min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Keep order</button>
              <button type="button" className="btn btn-danger" disabled={pending} onClick={() => start(async () => {
                const r = await action(orderId, reason);
                if (!r.ok) { setErr(r.error); return; }
                setOpen(false); router.refresh();
              })}>{pending ? 'Cancelling…' : 'Cancel order'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
