'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Send } from 'lucide-react';
import { Button, Checkbox, Drawer, Field, Icon, Input, NamedTabLink, Segmented, Select, Textarea } from '@octopus/ui';
import type { ApplyInput } from '@/app/(store)/3pl/apply/actions';
import { WAREHOUSE_VIEWS, WH_BANDS, WH_CHANNELS, WH_ROUTES, warehouseHref, type QuoteDefaults, type WarehouseView } from '../_lib/warehouse-logic';

export function WarehouseViewSwitch({ view }: { view: WarehouseView }) {
  const router = useRouter();
  return (
    <Segmented
      label="Warehouse services"
      value={view}
      options={WAREHOUSE_VIEWS.map((w) => ({ value: w.value, label: w.label, testId: `warehouse-view-${w.value}` }))}
      onChange={(v) => router.push(warehouseHref({ view: v as WarehouseView }), { scroll: false })}
    />
  );
}

export type WarehouseSubmit = (input: ApplyInput) => Promise<{ ok: boolean; code?: string; sds?: boolean; error?: string }>;

/**
 * Get a quote (Part 5.7): TODAY's 3PL quote form (the /3pl/apply application → submitApplicationAction →
 * wh_submit_application, then wh_link_my_application for a signed-in company) in a Drawer, prefilled with the company
 * and contact from the session and the chosen service. Opened by ?quote=<service>; closing removes it (Back works).
 */
export function WarehouseQuoteDrawer({
  view,
  quote,
  serviceTitle,
  defaults,
  warehouses,
  submit,
}: {
  view: WarehouseView;
  quote: string | null;
  serviceTitle: string | null;
  defaults: QuoteDefaults;
  warehouses: { code: string; name: string; city: string }[];
  submit: WarehouseSubmit;
}) {
  const router = useRouter();
  const formId = useId();
  const [f, setF] = useState({ ...defaults, sells: '', ordersBand: '', stockRoute: '', preferredWarehouse: warehouses[0]?.code ?? '' });
  const [channels, setChannels] = useState<string[]>([]);
  const [bat, setBat] = useState(false);
  const [liq, setLiq] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; sds: boolean } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const missing = [
    !f.company.trim() && 'company',
    !f.contactName.trim() && 'your name',
    !emailOk && 'a valid work email',
    !f.sells.trim() && 'what you sell',
    !f.ordersBand && 'orders a month',
    !f.stockRoute && 'how stock reaches us',
  ].filter(Boolean) as string[];
  const close = () => router.push(warehouseHref({ view }), { scroll: false });
  const dirty = !done && (Boolean(f.sells || f.ordersBand || f.stockRoute) || channels.length > 0);

  const send = () => {
    if (missing.length) return;
    setErr(null);
    start(async () => {
      const r = await submit({ ...f, channels, hasBatteries: bat, hasLiquids: liq, website: '' });
      if (!r.ok || !r.code) {
        setErr(r.error ?? 'We couldn’t send the request. Please try again.');
        return;
      }
      setDone({ code: r.code, sds: Boolean(r.sds) });
    });
  };

  return (
    <Drawer
      open={Boolean(quote)}
      onClose={close}
      title={serviceTitle ? `Get a quote: ${serviceTitle}` : 'Get a quote'}
      dirty={dirty}
      onSave={done ? undefined : send}
      data-testid="warehouse-quote"
      footer={
        done ? (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        ) : (
          <div className="flex flex-col gap-1">
            <Button type="submit" form={formId} variant="primary" iconStart={Send} loading={pending} loadingText="Sending…" disabled={missing.length > 0} disabledReason={missing.length ? `Still needed: ${missing.join(', ')}.` : undefined}>
              Send quote request
            </Button>
          </div>
        )
      }
    >
      {done ? (
        <div role="status" className="flex flex-col gap-3" data-testid="warehouse-quote-done">
          <p className="m-0 flex items-center gap-2 text-ods-h2 text-ods-navy">
            <Icon icon={Check} size="sm" className="text-ods-success" />
            Request sent
          </p>
          <p className="m-0 text-ods-body">
            Your reference is <strong>{done.code}</strong>. We reply within one working day.
          </p>
          {done.sds ? <p className="m-0 text-ods-body">Because you ship batteries or liquids, please have the safety data sheet (SDS) for each product ready.</p> : null}
          <NamedTabLink href="/account/warehouse" tab="account" className="text-ods-body font-semibold text-ods-navy underline">
            Warehouse in My account
          </NamedTabLink>
        </div>
      ) : (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="m-0 text-ods-body text-ods-slate">We filled in your company details. Tell us what you sell and we send rates for your volumes.</p>
          <Field label="Company" required>
            <Input value={f.company} onChange={set('company')} autoComplete="organization" />
          </Field>
          <Field label="Your name" required>
            <Input value={f.contactName} onChange={set('contactName')} autoComplete="name" />
          </Field>
          <Field label="Work email" required error={f.email && !emailOk ? 'Enter a valid email address, for example name@company.com.' : null}>
            <Input type="email" value={f.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field label="Phone" optional>
            <Input value={f.phone} onChange={set('phone')} autoComplete="tel" />
          </Field>
          <Field label="What you sell" required>
            <Textarea value={f.sells} onChange={set('sells')} rows={3} maxLength={1000} />
          </Field>
          <Field label="Orders a month" required>
            <Select value={f.ordersBand} onChange={set('ordersBand')} placeholder="Choose">
              {WH_BANDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How stock reaches us" required>
            <Select value={f.stockRoute} onChange={set('stockRoute')} placeholder="Choose">
              {WH_ROUTES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {warehouses.length > 1 ? (
            <Field label="Preferred warehouse" optional>
              <Select value={f.preferredWarehouse} onChange={set('preferredWarehouse')}>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.name} · {w.city}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Sales channels</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WH_CHANNELS.map((c) => (
                <Checkbox key={c} label={c} checked={channels.includes(c)} onCheckedChange={(on) => setChannels(on ? [...channels, c] : channels.filter((x) => x !== c))} />
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Special goods</legend>
            <Checkbox label="Some products have batteries" checked={bat} onCheckedChange={setBat} />
            <Checkbox label="Some products are liquids" checked={liq} onCheckedChange={setLiq} />
          </fieldset>
          {err ? (
            <p role="alert" className="m-0 rounded-ods-control border border-ods-danger bg-ods-danger-tint px-4 py-3 text-ods-body text-ods-danger">
              {err}
            </p>
          ) : null}
        </form>
      )}
    </Drawer>
  );
}
