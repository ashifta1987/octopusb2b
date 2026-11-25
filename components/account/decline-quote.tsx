'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Result = { ok: true; data?: { quote_id: string } } | { ok: false; error: string };

/** Batch 3 (F-11): "Decline quote" with a confirmation dialog and an optional reason. Quote status only. */
export function DeclineQuoteButton({
  quoteId, quoteCode, action,
}: {
  quoteId: string; quoteCode: string;
  action: (input: { quoteId: string; reason?: string }) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const titleId = `dq-${quoteId}`;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" data-testid={`decline-quote-${quoteCode}`}
        onClick={() => { setErr(null); setReason(''); setOpen(true); }}>Decline quote</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="card w-full max-w-md p-6 text-left">
            <h2 id={titleId} className="text-xl font-semibold">Decline quote {quoteCode}?</h2>
            <p className="text-sm text-muted mt-1">The quote is closed and no order is created. Your other quotes stay open, and our sourcing team can send a new quote.</p>
            <label htmlFor={`${titleId}-reason`} className="label mt-4">Reason (optional)</label>
            <textarea id={`${titleId}-reason`} className="input min-h-[84px]" maxLength={500} value={reason}
              onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price too high, lead time too long" />
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Keep quote</button>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
                const r = await action({ quoteId, reason: reason.trim() || undefined });
                if (!r.ok) { setErr(r.error); return; }
                setOpen(false);
                router.refresh();
              })}>{pending ? 'Declining…' : 'Decline quote'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
