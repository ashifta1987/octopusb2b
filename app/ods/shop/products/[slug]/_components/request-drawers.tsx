'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import { ArrowUpRight, Send } from 'lucide-react';
import { Button, Checkbox, Drawer, Field, Icon, Input, NamedTabLink, Select, Textarea } from '@octopus/ui';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import type { SubmitRfqFn, SubmitSampleFn } from '../../_lib/types';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
export const CUSTOMISATION_CHOICES = ['Logo print', 'Custom colour', 'Branded colour box'];

type Err = { msg: string; field?: string } | null;

function CountrySelect({ name, defaultValue }: { name: string; defaultValue: string | null }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ''} placeholder="Choose a country">
      {COUNTRY_OPTIONS.map(([c, label]) => (
        <option key={c} value={c}>
          {label}
        </option>
      ))}
    </Select>
  );
}

function Done({ title, body, code, testId }: { title: string; body: string; code: string | null; testId: string }) {
  return (
    <div role="status" className="flex flex-col gap-3" data-testid={testId}>
      <h3 className="m-0 text-ods-h2 text-ods-navy">{title}</h3>
      <p className="m-0 text-ods-body text-ods-text">{body}</p>
      {code ? (
        <NamedTabLink tab="account" href={`/account/sourcing/${encodeURIComponent(code)}`} className="inline-flex min-h-ods-control items-center gap-1 font-semibold text-ods-blue underline underline-offset-4">
          Open {code} in My account <Icon icon={ArrowUpRight} size="sm" />
        </NamedTabLink>
      ) : null}
    </div>
  );
}

/**
 * "Request quote" (Part 5.4 item 9): creates an RFQ directly with today's submitShopRfq (RPC shop_submit_rfq: MOQ,
 * ship-to and the sourcing fee are enforced in the database). Quantity and customisation come from the page.
 * Files: added on the request page in My account (link after sending).
 */
export function RfqDrawer({ open, onClose, productId, title, quantity, moq, unitPlural, defaultCountry, customisation, submit }: {
  open: boolean; onClose: () => void; productId: string; title: string; quantity: number; moq: number; unitPlural: string;
  defaultCountry: string | null; customisation: string[]; submit?: SubmitRfqFn;
}) {
  const [err, setErr] = useState<Err>(null);
  const [done, setDone] = useState<{ code: string } | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const formId = 'rfq-form';
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!submit) return;
    const fd = new FormData(e.currentTarget);
    const qty = Number(String(fd.get('quantity') ?? '').replace(/,/g, ''));
    if (!Number.isInteger(qty) || qty < moq) {
      setErr({ msg: `Quantity is below the minimum order. Enter at least ${moq.toLocaleString('en-US')}.`, field: 'quantity' });
      return;
    }
    start(async () => {
      setErr(null);
      const r = await submit({
        productId, quantity: qty, targetPrice: String(fd.get('target') ?? ''), country: String(fd.get('country') ?? ''), city: String(fd.get('city') ?? ''),
        customisation: fd.getAll('custom').map(String), notes: String(fd.get('notes') ?? ''), idem: key.current,
      });
      if (!r.ok) {
        setErr({ msg: r.error, field: r.field });
        return;
      }
      key.current = newKey();
      setDone({ code: r.code });
    });
  };
  const close = () => {
    onClose();
    if (done) setDone(null);
  };
  const fieldErr = (f: string) => (err?.field === f ? err.msg : undefined);
  return (
    <Drawer
      open={open}
      onClose={close}
      title="Request a quote"
      description={title}
      data-testid="rfq-drawer"
      footer={
        done ? (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        ) : (
          <Button type="submit" form={formId} iconStart={Send} loading={pending} loadingText="Sending…" disabled={!submit} disabledReason={submit ? undefined : 'Sending isn’t available here.'} data-testid="rfq-submit">
            Send request
          </Button>
        )
      }
    >
      {done ? (
        <Done title={`Request ${done.code} sent`} body="We confirm the details and send quotes from verified suppliers. Add files or follow it in My account." code={done.code} testId="rfq-done" />
      ) : (
        <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label={`Quantity (${unitPlural})`} required hint={`Minimum order ${moq.toLocaleString('en-US')}`} error={fieldErr('quantity')}>
            <Input name="quantity" inputMode="numeric" defaultValue={String(quantity)} />
          </Field>
          <Field label="Ship to" required error={fieldErr('country')}>
            <CountrySelect name="country" defaultValue={defaultCountry} />
          </Field>
          <Field label="City or port" optional>
            <Input name="city" maxLength={80} />
          </Field>
          <Field label="Target price per unit (US$)" optional hint="For example 1.70" error={fieldErr('targetPrice')}>
            <Input name="target" inputMode="decimal" />
          </Field>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-ods-label font-semibold text-ods-text">Customisation</legend>
            {CUSTOMISATION_CHOICES.map((c) => (
              <Checkbox key={c} name="custom" value={c} label={c} defaultChecked={customisation.includes(c)} />
            ))}
          </fieldset>
          <Field label="Notes for our sourcing team" optional>
            <Textarea name="notes" maxLength={2000} rows={3} />
          </Field>
          {err && !err.field ? (
            <p role="alert" className="m-0 text-ods-small font-medium text-ods-danger" data-testid="rfq-error">
              {err.msg}
            </p>
          ) : null}
        </form>
      )}
    </Drawer>
  );
}

/** "Order a sample" → today's submitSample (request_service 'sample', code SRV-<n>, the sample fee from settings). */
export function SampleDrawer({ open, onClose, productId, title, defaultCountry, feeText, submit }: {
  open: boolean; onClose: () => void; productId: string; title: string; defaultCountry: string | null; feeText: string; submit?: SubmitSampleFn;
}) {
  const [err, setErr] = useState<Err>(null);
  const [done, setDone] = useState<{ code: string | null } | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const formId = 'sample-form';
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!submit) return;
    const fd = new FormData(e.currentTarget);
    start(async () => {
      setErr(null);
      const r = await submit({
        productId, productTitle: title, quantity: Number(fd.get('quantity')), country: String(fd.get('country') ?? ''), city: String(fd.get('city') ?? ''),
        notes: String(fd.get('notes') ?? ''), idem: key.current,
      });
      if (!r.ok) {
        setErr({ msg: r.error, field: r.field });
        return;
      }
      key.current = newKey();
      setDone({ code: r.code });
    });
  };
  const close = () => {
    onClose();
    if (done) setDone(null);
  };
  const fieldErr = (f: string) => (err?.field === f ? err.msg : undefined);
  return (
    <Drawer
      open={open}
      onClose={close}
      title="Order a sample"
      description={`${title} · Sample fee: ${feeText}`}
      data-testid="sample-drawer"
      footer={
        done ? (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        ) : (
          <Button type="submit" form={formId} loading={pending} loadingText="Sending…" disabled={!submit} disabledReason={submit ? undefined : 'Sending isn’t available here.'} data-testid="sample-submit">
            Order a sample
          </Button>
        )
      }
    >
      {done ? (
        <Done title={`Sample request ${done.code ?? ''} sent`.trim()} body="We confirm the sample price and shipping, then ship it to you." code={done.code} testId="sample-done" />
      ) : (
        <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Number of samples" required hint="1 to 5" error={fieldErr('quantity')}>
            <Input name="quantity" type="number" min={1} max={5} defaultValue="1" inputMode="numeric" />
          </Field>
          <Field label="Ship to" required error={fieldErr('country')}>
            <CountrySelect name="country" defaultValue={defaultCountry} />
          </Field>
          <Field label="City" optional>
            <Input name="city" maxLength={80} />
          </Field>
          <Field label="Notes (colour, size, anything to check)" optional>
            <Textarea name="notes" maxLength={2000} rows={2} />
          </Field>
          {err && !err.field ? (
            <p role="alert" className="m-0 text-ods-small font-medium text-ods-danger">
              {err.msg}
            </p>
          ) : null}
        </form>
      )}
    </Drawer>
  );
}
