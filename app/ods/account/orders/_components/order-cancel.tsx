'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Modal, Textarea } from '@octopus/ui';

/** "Cancel order" (only until the deposit is paid — today's CANCELLABLE) → TODAY's cancelOrder action (transition_order). */
export function CancelOrderButton({ orderId, orderRef, cancelOrder }: { orderId: string; orderRef: string; cancelOrder: (id: string, reason?: string) => Promise<{ ok: true; data?: undefined } | { ok: false; error: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="cancel-order">
        Cancel order
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        destructive
        title={`Cancel ${orderRef}?`}
        description="You can cancel until the deposit is paid. The proforma invoice is voided. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={pending}
              loadingText="Cancelling…"
              onClick={() =>
                start(async () => {
                  const r = await cancelOrder(orderId, reason);
                  if (!r.ok) {
                    setErr(r.error);
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Cancel order
            </Button>
          </>
        }
      >
        <Field label="Reason" optional>
          {(c) => <Textarea {...c} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {err ? (
          <p className="m-0 mt-2 text-ods-small text-ods-danger" role="alert">
            {err}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
