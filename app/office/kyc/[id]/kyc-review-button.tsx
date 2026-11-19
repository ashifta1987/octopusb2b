'use client';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { ActionResult } from '@/components/backoffice/action-form';

type Input = { customerMessage: string; internalNote: string };

/**
 * KYC decision dialog with two fields (migration 195):
 *  - "Message to customer" → kyc_submissions.customer_message (visible to the customer; required when rejecting)
 *  - "Internal note"       → kyc_submissions.internal_note (staff only)
 */
export function KycReviewButton({
  action, label, title, messageRequired = false, messagePlaceholder, className = 'btn btn-ghost btn-sm', confirmLabel = 'Confirm', danger,
}: {
  action: (input: Input) => Promise<ActionResult>; label: React.ReactNode; title: string; messageRequired?: boolean;
  messagePlaceholder?: string; className?: string; confirmLabel?: string; danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customerMessage, setCustomerMessage] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = `kr${useId().replace(/:/g, '')}`;
  const missing = messageRequired && !customerMessage.trim();
  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(null); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
          <div className="card w-full max-w-md p-6">
            <h2 id={`${id}-t`} className="text-xl font-semibold">{title}</h2>
            <label htmlFor={`${id}-m`} className="label mt-4">Message to customer{messageRequired ? ' *' : ' (optional)'}</label>
            <textarea id={`${id}-m`} className="input min-h-24 py-2" value={customerMessage} placeholder={messagePlaceholder}
              onChange={(e) => setCustomerMessage(e.target.value)} aria-describedby={`${id}-mh`} />
            <p id={`${id}-mh`} className="mt-1 text-xs text-muted">The customer sees this on their verification page.</p>
            <label htmlFor={`${id}-n`} className="label mt-4">Internal note (optional)</label>
            <textarea id={`${id}-n`} className="input min-h-20 py-2" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} aria-describedby={`${id}-nh`} />
            <p id={`${id}-nh`} className="mt-1 text-xs text-muted">Staff only. Never shown to the customer.</p>
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className={cn('btn', danger ? 'btn-danger' : 'btn-primary')} disabled={pending || missing}
                onClick={() => {
                  if (missing) { setErr('Write a message to the customer.'); return; }
                  start(async () => {
                    const r = await action({ customerMessage: customerMessage.trim(), internalNote: internalNote.trim() });
                    if (r && !r.ok) { setErr(r.error ?? 'Failed'); return; }
                    setOpen(false); setCustomerMessage(''); setInternalNote(''); router.refresh();
                  });
                }}>{pending ? 'Working…' : confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
