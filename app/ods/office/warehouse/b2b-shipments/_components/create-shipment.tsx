'use client';
// ODS T9
/**
 * ODS T9 · Create shipment (record page at today's ?order= URL; a long form, so a page, not a drawer — Part 7.6).
 * Same steps and same calls as today's ShipmentCreator: parcel details → `priceTrial` (YunExpress price trial) → pick a
 * service → confirm → `createShipment` (label + waybill, order marked shipped). Both are today's server actions, unchanged.
 * Like today, only pieces and weight are sent; box size, declared value, customs description, HS code and VAT/EORI are
 * reference fields for the label paperwork (today's form does not send them either).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Modal, NumberInput, Panel, RadioCards } from '@octopus/ui';
import { money } from '@/lib/format';
import { RATE_CURRENCY, billedTo, validateParcel } from '../_lib/shipping-core';
import { InlineNotice } from '../../../_components/sales-bits';

type Rate = { carrier: string; service: string; priceCents: number; days: string };
type Res<T> = { ok: boolean; error?: string; data?: T };

export type CreateShipmentProps = {
  orderId: string;
  orderCode: string;
  from: { label: string; place: string; country: string };
  to: { label: string; place: string; country: string };
  incoterm: string | null;
  defaultDesc: string;
  defaultHs: string;
  declaredCents: number;
  declaredCurrency: string;
  canEdit: boolean;
  priceTrial: (i: { toCountry: string; fromCountry: string; weightKg: number; parcels: number }) => Promise<Res<Rate[]>>;
  createShipment: (orderId: string, i: { service: string; rateCents: number; weightKg: number; parcels: number }) => Promise<Res<{ trackingNo: string; labelUrl: string }>>;
  backHref: string;
  sample?: boolean;
};

export function CreateShipment(p: CreateShipmentProps) {
  const router = useRouter();
  const [pieces, setPieces] = useState('1');
  const [weight, setWeight] = useState('5');
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [pick, setPick] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<{ trackingNo: string; labelUrl: string } | null>(null);
  const [pending, start] = useTransition();
  const rate = rates?.find((r) => r.service === pick) ?? null;
  const w = Number(weight) || 0;
  const n = Math.max(0, Math.round(Number(pieces) || 0));

  const trial = () => {
    const v = validateParcel(w, n);
    if (v) { setErr(v); return; }
    start(async () => {
      setErr(null); setRates(null); setPick(undefined);
      const r = await p.priceTrial({ toCountry: p.to.country, fromCountry: p.from.country, weightKg: w, parcels: n });
      if (!r.ok) setErr(r.error ?? 'Price trial failed');
      else { setRates(r.data ?? []); setPick(r.data?.[0]?.service); }
    });
  };
  const create = () => {
    if (!rate) return;
    start(async () => {
      setErr(null);
      const r = await p.createShipment(p.orderId, { service: rate.service, rateCents: rate.priceCents, weightKg: w, parcels: n });
      setConfirm(false);
      if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
      setDone(r.data ?? null);
      if (!p.sample) router.refresh();
    });
  };

  return (
    <div className="grid min-w-0 items-start gap-3 ods-desktop:grid-cols-[minmax(0,1fr)_20rem]" data-testid="b2b-create">
      <div className="grid min-w-0 gap-3">
        <Panel title="1 · Route" headingLevel={2}>
          <div className="grid items-center gap-3 ods-tablet:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-ods-control bg-ods-canvas p-3">
              <div className="text-ods-small text-ods-slate">Ship from · supplier</div>
              <div className="font-semibold">{p.from.label}</div>
              <div className="text-ods-small text-ods-slate">{p.from.place}</div>
            </div>
            <span aria-hidden className="text-center text-ods-slate">→</span>
            <div className="rounded-ods-control bg-ods-canvas p-3">
              <div className="text-ods-small text-ods-slate">Ship to · buyer</div>
              <div className="font-semibold">{p.to.label}</div>
              <div className="text-ods-small text-ods-slate">{p.to.place} · Incoterm {p.incoterm ?? '—'}</div>
            </div>
          </div>
        </Panel>
        {!p.canEdit ? (
          <InlineNotice tone="info" role="status" testId="b2b-view-only"><b>View only.</b> You can view shipping but not create shipments.</InlineNotice>
        ) : done ? (
          <Panel title="Shipment created" headingLevel={2} data-testid="b2b-created">
            <div className="grid gap-3">
              <p className="m-0">Waybill <span className="font-mono font-semibold">{done.trackingNo}</span> · order marked shipped.</p>
              <div className="flex flex-wrap gap-2">
                <Button href={done.labelUrl} target="_blank">Print label (10 × 15 cm)</Button>
                <Button variant="secondary" href={p.backHref}>Back to queue</Button>
              </div>
            </div>
          </Panel>
        ) : (
          <>
            <Panel title="2 · Parcel and customs" headingLevel={2}>
              <div className="grid gap-3">
                <div className="grid gap-3 ods-tablet:grid-cols-4">
                  <Field label="Pieces" required><NumberInput min={1} step={1} decimals={0} value={pieces} onValueChange={(raw) => setPieces(raw)} /></Field>
                  <Field label="Total weight (kg)" required><NumberInput min={0.1} step={0.1} decimals={1} value={weight} onValueChange={(raw) => setWeight(raw)} /></Field>
                  <Field label="Box size (cm)" optional><Input placeholder="40 × 30 × 30" /></Field>
                  <Field label={`Declared value (${p.declaredCurrency})`}><Input defaultValue={(p.declaredCents / 100).toFixed(2)} /></Field>
                </div>
                <div className="grid gap-3 ods-tablet:grid-cols-4">
                  <Field label="Customs description (English)" className="ods-tablet:col-span-2"><Input defaultValue={p.defaultDesc} /></Field>
                  <Field label="HS code"><Input defaultValue={p.defaultHs} /></Field>
                  <Field label="Buyer VAT / EORI" optional><Input /></Field>
                </div>
                <div><Button variant="secondary" loading={pending && !rates} disabled={!(w > 0)} onClick={trial} data-testid="b2b-get-rates">Get YunExpress rates</Button></div>
              </div>
            </Panel>
            <Panel title="3 · Choose a YunExpress service" headingLevel={2} actions={<span className="text-ods-small text-ods-slate">Price trial · {p.from.country} → {p.to.country}</span>}>
              <div className="grid gap-3">
                {!rates ? <p className="m-0 text-ods-small text-ods-slate">Enter the parcel details and get rates.</p>
                  : !rates.length ? <p className="m-0 text-ods-small text-ods-slate">No rate set</p>
                    : (
                      <RadioCards legend="Service" legendHidden columns={1} value={pick} onValueChange={setPick} data-testid="b2b-rates"
                        options={rates.map((r) => ({ value: r.service, label: `${r.carrier} · ${r.service}`, description: `${r.days} days`, price: money(r.priceCents, RATE_CURRENCY) }))} />
                    )}
                {err ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ods-line pt-3">
                  <span className="text-ods-small text-ods-slate">Shipping cost is billed to: <b className="text-ods-navy">{billedTo(p.incoterm)}</b></span>
                  <Button disabled={!rate} loading={pending && !!rates} onClick={() => setConfirm(true)} data-testid="b2b-create-shipment">Create shipment and print label</Button>
                </div>
              </div>
            </Panel>
          </>
        )}
      </div>
      <Panel title="Who sees what" headingLevel={2}>
        <p className="m-0 text-ods-small text-ods-slate">The buyer sees the waybill number and tracking only, with the carrier label set in Admin. The supplier’s address stays hidden.</p>
        <p className="m-0 mt-2 text-ods-small text-ods-slate">The supplier gets the label to print and stick on the parcels.</p>
      </Panel>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Create the shipment for ${p.orderCode}?`}
        description={rate ? `YunExpress “${rate.service}” at ${money(rate.priceCents, RATE_CURRENCY)}. The order will be marked shipped.` : undefined}
        confirmLabel="Create shipment"
        loading={pending}
        onConfirm={create}
      />
    </div>
  );
}
