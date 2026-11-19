'use client';
import { useActionState } from 'react';
import { payProformaFromWallet, type PayResult } from '@/app/account/invoices/actions';

/** "Pay from wallet" for a service proforma. One idempotency key per render: double clicks are charged once. */
export function PayProformaButton({ documentId, amountCents, label, idempotencyKey }: { documentId: string; amountCents: number; label: string; idempotencyKey: string }) {
  const [state, action, pending] = useActionState<PayResult | null, FormData>(payProformaFromWallet, null);
  if (state?.ok) return <span role="status" className="text-sm text-ok font-semibold">✓ {state.message}</span>;
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1" onSubmit={(e) => { if (!window.confirm(`Pay ${label} from your wallet?`)) e.preventDefault(); }}>
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="amount_cents" value={amountCents} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid={`pay-${documentId}`}>{pending ? 'Paying…' : `Pay ${label} from wallet`}</button>
      {state && !state.ok && <span role="alert" className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}
