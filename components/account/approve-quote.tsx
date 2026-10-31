'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usd } from '@/lib/format';
import { cn } from '@/lib/cn';

type Result = { ok: true; data?: { order_id: string; order_code: string; pi_number: string } } | { ok: false; error: string };

/** Approve-quote confirm dialog: shows total, deposit %, Terms link; redirects to the new order on success. */
export function ApproveQuoteButton({
  quoteId, quoteCode, totalCents, depositPct, termsVersion, action, label = 'Accept', className = 'btn btn-primary btn-sm',
}: {
  quoteId: string; quoteCode: string; totalCents: number; depositPct: number; termsVersion?: string | null;
  action: (input: { quoteId: string }) => Promise<Result>; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const deposit = Math.round((totalCents * depositPct) / 100);
  const titleId = `aq-${quoteId}`;
  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(null); setAgree(false); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="card w-full max-w-md p-6 text-left">
            <h2 id={titleId} className="text-xl font-semibold">Approve quote {quoteCode}?</h2>
            <p className="text-sm text-muted mt-1">We will issue a proforma invoice. The order is binding once Octopus B2B confirms it in writing after your deposit.</p>
            <dl className="mt-4 space-y-2 text-[15px]">
              <div className="flex justify-between"><dt className="text-muted">Order total</dt><dd className="mono font-semibold">{usd(totalCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Deposit due ({depositPct}%)</dt><dd className="mono font-semibold">{usd(deposit)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Balance before despatch</dt><dd className="mono">{usd(totalCents - deposit)}</dd></div>
            </dl>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 w-4 h-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                I accept the <a href="/legal/terms" target="_blank" rel="noopener" className="text-blue underline">Terms &amp; Conditions</a>
                {termsVersion ? ` (${termsVersion})` : ''}. Other quotes for this RFQ will be closed.
              </span>
            </label>
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className={cn('btn btn-primary')} disabled={pending || !agree} onClick={() => start(async () => {
                const r = await action({ quoteId });
                if (!r.ok) { setErr(r.error); return; }
                setOpen(false);
                if (r.data?.order_id) router.push(`/account/orders/${r.data.order_id}?created=1`);
                else router.refresh();
              })}>{pending ? 'Approving…' : 'Approve & create proforma'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
