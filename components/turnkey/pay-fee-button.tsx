'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { payTurnkeyFeeAction } from '@/app/account/turnkey/actions';

/**
 * Turnkey T3 — "Pay from wallet" for an approved fee (client project page). One idempotency key per page view: a double
 * click or a retried request is charged once. The page refreshes after a payment so the fee shows as paid.
 */
export function TkPayFeeButton({ code, documentId, amountCents, label, idempotencyKey }: {
  code: string; documentId: string; amountCents: number; label: string; idempotencyKey: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start(async () => {
      const r = await payTurnkeyFeeAction({ code, documentId, amountCents, idempotencyKey });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  };
  if (msg?.ok) return <p role="status" className="m-0 text-sm text-ok font-semibold" data-testid={`tk-pay-done-${documentId}`}>✓ {msg.text}</p>;
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-1">
      <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending} data-testid={`tk-pay-${documentId}`}>
        {pending ? 'Paying…' : `Pay ${label} from wallet`}
      </button>
      {msg && !msg.ok && <span role="alert" className="text-[13px] text-bad">{msg.text}</span>}
    </form>
  );
}
