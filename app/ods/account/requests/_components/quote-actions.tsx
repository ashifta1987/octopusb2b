'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Upload } from 'lucide-react';
import { Button, Checkbox, Field, Input, Modal, Money, Select, Textarea } from '@octopus/ui';
import { curLabel, units } from '../../orders/_lib/commerce-format';
import { KV } from '../../orders/_components/commerce-ui';

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** TODAY's request actions, passed in by the page (fixtures pass sample stubs). */
export type RequestActions = {
  /** app/account/rfqs/actions.ts approveQuote → approve_quote RPC (order + proforma + deposit escrow, unchanged) */
  approveQuote: (input: { quoteId: string }) => Promise<R<{ order_id: string; order_code: string; pi_number: string }>>;
  /** app/account/rfqs/actions.ts rejectQuote → reject_quote RPC (quote status only) */
  rejectQuote: (input: { quoteId: string; reason?: string }) => Promise<R<{ quote_id: string }>>;
  /** app/account/sourcing/actions.ts postMessage → post_request_message RPC */
  postMessage: (input: { kind: 'rfq' | 'service'; id: string; body: string; ref: string }) => Promise<R>;
  /** app/account/sourcing/actions.ts uploadFile → request_visible + storage + add_request_file */
  uploadFile: (fd: FormData) => Promise<R>;
  /** app/account/sourcing/actions.ts markQuotesViewed → mark_quotes_viewed RPC */
  markQuotesViewed: (rfqId: string) => Promise<void>;
};

/**
 * "Accept quote" — today's accept flow: a confirm dialog with the total, the deposit % and the balance (the same
 * figures today's ApproveQuoteButton shows), Terms consent, then approveQuote creates the order and the proforma.
 * It does NOT add to the cart (today's flow creates the proforma; the T5 cart may add a Buy-now path later).
 */
export function AcceptQuoteButton({ quote, depositPct, termsVersion, approveQuote, label = 'Accept quote' }: { quote: { id: string; code: string; option: string; totalCents: number; depositCents: number; currency: string }; depositPct: number; termsVersion: string | null; approveQuote: RequestActions['approveQuote']; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = curLabel(quote.currency);
  return (
    <>
      <Button iconStart={Check} onClick={() => (setErr(null), setAgree(false), setOpen(true))} data-testid={`accept-quote-${quote.code}`}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Accept ${quote.option} (${quote.code})?`}
        description="We issue a proforma invoice. The order is binding once Octopus B2B confirms it in writing after your deposit."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              loading={pending}
              loadingText="Accepting…"
              disabled={!agree}
              disabledReason={!agree ? 'Accept the Terms first' : undefined}
              onClick={() =>
                start(async () => {
                  const r = await approveQuote({ quoteId: quote.id });
                  if (!r.ok) {
                    setErr(r.error);
                    return;
                  }
                  setOpen(false);
                  if (r.data?.order_code) router.push(`/account/orders/${encodeURIComponent(r.data.order_code)}?created=1`);
                  else router.refresh();
                })
              }
              data-testid="confirm-accept-quote"
            >
              Accept and create proforma
            </Button>
          </>
        }
      >
        <dl className="m-0 text-ods-body">
          <KV k="Order total">
            <Money amount={units(quote.totalCents)} currency={cur} />
          </KV>
          <KV k={`Deposit due (${depositPct}%)`}>
            <Money amount={units(quote.depositCents)} currency={cur} />
          </KV>
          <KV k="Balance before shipping" strong>
            <Money amount={units(quote.totalCents - quote.depositCents)} currency={cur} />
          </KV>
        </dl>
        <div className="mt-4">
          <Checkbox
            checked={agree}
            onCheckedChange={setAgree}
            label={
              <>
                I accept the{' '}
                <a href="/legal/terms" target="_blank" className="font-semibold text-ods-blue underline">
                  Terms and conditions
                </a>
                {termsVersion ? ` (${termsVersion})` : ''}. Other quotes for this request will be closed.
              </>
            }
          />
        </div>
        {err ? (
          <p className="m-0 mt-3 text-ods-small text-ods-danger" role="alert">
            {err}
          </p>
        ) : null}
      </Modal>
    </>
  );
}

/** "Decline" — today's rejectQuote (quote status only, nothing is charged), optional reason. */
export function DeclineQuoteButton({ quote, rejectQuote }: { quote: { id: string; code: string; option: string }; rejectQuote: RequestActions['rejectQuote'] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" iconStart={X} onClick={() => (setErr(null), setReason(''), setOpen(true))} data-testid={`decline-quote-${quote.code}`}>
        Decline
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Decline ${quote.option} (${quote.code})?`}
        description="The quote is closed and no order is created. Your other quotes stay open."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep quote
            </Button>
            <Button
              loading={pending}
              loadingText="Declining…"
              onClick={() =>
                start(async () => {
                  const r = await rejectQuote({ quoteId: quote.id, reason: reason.trim() || undefined });
                  if (!r.ok) {
                    setErr(r.error);
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Decline quote
            </Button>
          </>
        }
      >
        <Field label="Reason" optional hint="For example: price too high, lead time too long.">
          {(c) => <Textarea {...c} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
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

/** Ask the sourcing team (today's postMessage). */
export function RequestMessageForm({ kind, id, refCode, postMessage, disabledReason }: { kind: 'rfq' | 'service'; id: string; refCode: string; postMessage: RequestActions['postMessage']; disabledReason?: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      id="ask"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await postMessage({ kind, id, body, ref: refCode });
          if (!r.ok) {
            setErr(r.error);
            return;
          }
          setBody('');
          router.refresh();
        });
      }}
    >
      <Field label="Ask the sourcing team" error={err ?? undefined}>
        {(c) => <Textarea {...c} rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="message-input" />}
      </Field>
      <div>
        <Button type="submit" loading={pending} loadingText="Sending…" disabled={!body.trim() || !!disabledReason} disabledReason={disabledReason ?? (!body.trim() ? 'Write a message first' : undefined)}>
          Send
        </Button>
      </div>
    </form>
  );
}

/** Attach a photo, spec or invoice (today's uploadFile: private storage, RLS-checked). */
export function RequestFileUpload({ kind, id, refCode, uploadFile, disabledReason }: { kind: 'rfq' | 'service'; id: string; refCode: string; uploadFile: RequestActions['uploadFile']; disabledReason?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={ref}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setErr(null);
        start(async () => {
          const r = await uploadFile(fd);
          if (!r.ok) {
            setErr(r.error);
            return;
          }
          ref.current?.reset();
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="ref" value={refCode} />
      <Field label="File" className="min-w-0 flex-1">
        {(c) => <Input {...c} type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.docx,.txt" />}
      </Field>
      <Field label="Type">
        {(c) => (
          <Select {...c} name="file_kind" defaultValue="photo">
            <option value="photo">Photo</option>
            <option value="spec">Spec or drawing</option>
            <option value="invoice">Invoice</option>
            <option value="other">Other</option>
          </Select>
        )}
      </Field>
      <Button type="submit" variant="secondary" iconStart={Upload} loading={pending} loadingText="Uploading…" disabled={!!disabledReason} disabledReason={disabledReason}>
        Upload
      </Button>
      {err ? (
        <p className="m-0 basis-full text-ods-small text-ods-danger" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}

/** Opening a request marks its new quotes as viewed (today's markQuotesViewed; clears the "new quotes" badge). */
export function MarkQuotesViewed({ rfqId, markQuotesViewed }: { rfqId: string; markQuotesViewed: RequestActions['markQuotesViewed'] }) {
  useEffect(() => {
    void markQuotesViewed(rfqId);
  }, [rfqId, markQuotesViewed]);
  return null;
}

