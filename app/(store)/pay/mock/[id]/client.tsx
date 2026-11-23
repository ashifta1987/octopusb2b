'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmMockPaymentAction } from './actions';

export function MockCheckoutClient({
  checkoutId,
  totalFormatted,
  paymentOptionLabel,
  methodKind,
  initialStatus,
  returnUrl,
}: {
  checkoutId: string;
  totalFormatted: string;
  paymentOptionLabel: string;
  methodKind: string;
  initialStatus: string;
  returnUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneStatus, setDoneStatus] = useState<string>(initialStatus);

  function handleAction(outcome: 'succeeded' | 'cancelled') {
    setError(null);
    const fd = new FormData();
    fd.set('checkout_id', checkoutId);
    fd.set('outcome', outcome);
    startTransition(async () => {
      const res = await confirmMockPaymentAction(fd);
      if (!res.ok) {
        setError(res.error ?? 'Payment failed');
        return;
      }
      setDoneStatus(res.status ?? 'paid');
      router.push(res.returnUrl ?? returnUrl);
      router.refresh();
    });
  }

  if (doneStatus === 'paid') {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950" data-testid="mock-checkout-paid">
        <p className="font-semibold">Webhook confirmed — payment complete</p>
        <p className="mt-1 text-xs text-emerald-800">
          Signed webhook event verified and settled in the double-entry ledger.
        </p>
        <a
          href={returnUrl}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white"
        >
          Return to Octopus B2B
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="mock-checkout-controls">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-4 text-xs text-muted">
        <p className="font-medium text-ink">Staging Sandbox Simulation ({methodKind.replace('_', ' ')})</p>
        <p className="mt-1">
          Clicking <strong>Authorize {totalFormatted}</strong> dispatches an HMAC-SHA256 signed webhook event to{' '}
          <code>/api/webhooks/payments/mock</code>. The order or invoice is marked paid <em>only</em> from the verified
          webhook, never from the browser redirect.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleAction('succeeded')}
          data-testid="mock-pay-confirm-btn"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50"
        >
          {pending ? 'Sending signed webhook…' : `Authorize ${totalFormatted} (${paymentOptionLabel})`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleAction('cancelled')}
          data-testid="mock-pay-cancel-btn"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
