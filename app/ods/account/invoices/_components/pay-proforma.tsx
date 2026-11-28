'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign } from 'lucide-react';
import { Button, Modal } from '@octopus/ui';

export type PayProformaAction = (prev: { ok: boolean; message: string } | null, fd: FormData) => Promise<{ ok: boolean; message: string }>;

/**
 * "Pay from wallet" for a service proforma — TODAY's payProformaFromWallet (app/account/invoices/actions.ts →
 * pay_service_proforma RPC) with the same form fields: document_id, amount_cents (today's getAmountsDue docDue) and the
 * per-page-view idempotency key, so a double click is charged once. A confirm dialog replaces window.confirm.
 */
export function PayProformaButton({ documentId, number, amountCents, amountText, idempotencyKey, payProforma }: { documentId: string; number: string; amountCents: number; amountText: string; idempotencyKey: string; payProforma: PayProformaAction }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) {
    return (
      <span role="status" className="text-ods-small font-semibold text-ods-success">
        {result.message}
      </span>
    );
  }
  return (
    <>
      <Button size="sm" iconStart={DollarSign} onClick={() => (setResult(null), setOpen(true))} data-testid={`pay-proforma-${number}`}>
        Pay {amountText}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Pay ${number} from your wallet?`}
        description={`${amountText} is taken from your wallet. When the proforma is fully paid we issue your tax invoice.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              loading={pending}
              loadingText="Paying…"
              onClick={() =>
                start(async () => {
                  const fd = new FormData();
                  fd.set('document_id', documentId);
                  fd.set('amount_cents', String(amountCents));
                  fd.set('idempotency_key', idempotencyKey);
                  const r = await payProforma(null, fd);
                  setResult(r);
                  if (r.ok) {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
              data-testid="confirm-pay-proforma"
            >
              Pay {amountText}
            </Button>
          </>
        }
      >
        {result && !result.ok ? (
          <p className="m-0 text-ods-small text-ods-danger" role="alert">
            {result.message}
          </p>
        ) : (
          <p className="m-0 text-ods-small text-ods-slate">Wallet top-ups by bank transfer are credited after finance confirms them.</p>
        )}
      </Modal>
    </>
  );
}
