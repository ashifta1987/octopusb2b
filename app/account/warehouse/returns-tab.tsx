'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { StatusBadge } from '@/components/ui';
import { usd } from '@/lib/format';
import { fmtWh } from '@/lib/warehouse-inbound';
import {
  CONDITION_LABEL, DECISIONS, DECISION_HINT, DECISION_LABEL, RETURN_STATUS_CLIENT, decisionOutcome, sendBackText, type Decision, type ReturnRow,
} from '@/lib/warehouse-w5';
import { decideReturnAction } from './w5-actions';

/** Warehouse OS · W5 portal Returns tab (board 21): return list with photos and condition, and a decision for each: restock, discard or send back. */
type Msg = { ok: boolean; text: string } | null;
const TONE = { info: 'blue', warn: 'amber', ok: 'green', bad: 'red', neutral: 'gray' } as const;
const EMPTY_SHIP = { name: '', phone: '', line1: '', line2: '', city: '', region: '', postcode: '', country: '' };

function DecideForm({ r }: { r: ReturnRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [dec, setDec] = useState<Decision | ''>(r.decision ?? '');
  const prev = r.send_back_to;
  const [ship, setShip] = useState(prev ? {
    name: prev.ship_name ?? '', phone: prev.ship_phone ?? '', line1: prev.ship_address?.line1 ?? '', line2: prev.ship_address?.line2 ?? '',
    city: prev.ship_address?.city ?? '', region: prev.ship_address?.region ?? '', postcode: prev.ship_address?.postcode ?? '', country: prev.ship_country ?? '',
  } : EMPTY_SHIP);
  const noGood = r.good_units === 0;
  const why = !dec ? 'Choose what we do with the units'
    : dec === 'restock' && noGood ? 'No unit passed inspection; choose discard or send back'
      : dec === 'send_back' && (!ship.name.trim() || !ship.line1.trim() || !ship.city.trim() || !/^[A-Za-z]{2}$/.test(ship.country.trim()))
        ? 'Enter the name, street address, city and two-letter country code' : null;
  const id = (k: string) => `rt-${r.code}-${k}`;
  const field = (k: keyof typeof EMPTY_SHIP, label: string, extra: Record<string, unknown> = {}, cls = '') => (
    <div className={cls}>
      <label htmlFor={id(k)} className="label">{label}</label>
      <input id={id(k)} className="input" value={ship[k]} onChange={(e) => setShip({ ...ship, [k]: e.target.value })} autoComplete="off" {...extra} />
    </div>
  );
  return (
    <form className="mt-3 flex flex-col gap-3 border-t border-line pt-3" data-testid={`wh-return-decide-${r.code}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (why || !dec) return;
        start(async () => {
          const res = await decideReturnAction({ returnId: r.id, decision: dec, ship: dec === 'send_back' ? ship : null });
          setMsg({ ok: res.ok, text: res.ok ? res.message ?? 'Saved.' : res.error ?? 'Something went wrong.' });
          if (res.ok) router.refresh();
        });
      }}>
      <fieldset className="border-0 p-0 m-0">
        <legend className="label">{r.decision ? 'Your decision (you can change it until we carry it out)' : 'What should we do with these units?'}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DECISIONS.map((d) => (
            <label key={d} className={`flex gap-2 items-start rounded-[10px] border p-3 cursor-pointer ${dec === d ? 'border-ink' : 'border-line'}`}>
              <input type="radio" name={id('decision')} value={d} checked={dec === d} onChange={() => setDec(d)} className="mt-1" />
              <span><span className="font-semibold block">{DECISION_LABEL[d]}</span><span className="text-[12.5px] text-black/70">{DECISION_HINT[d]}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {dec === 'send_back' && (
        <fieldset className="border-0 p-0 m-0">
          <legend className="label">Send the units to</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {field('name', 'Name *', { maxLength: 120 })}
            {field('phone', 'Phone', { maxLength: 40, inputMode: 'tel' })}
            {field('country', 'Country code *', { maxLength: 2, placeholder: 'US' })}
            {field('postcode', 'Postcode', { maxLength: 12 })}
            {field('line1', 'Address *', { maxLength: 200 }, 'sm:col-span-2')}
            {field('line2', 'Address line 2', { maxLength: 200 }, 'sm:col-span-2')}
            {field('city', 'City *', { maxLength: 100 })}
            {field('region', 'State / region', { maxLength: 100 })}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || Boolean(why)} aria-describedby={why ? id('why') : undefined} data-testid={`wh-return-submit-${r.code}`}>
          {r.decision ? 'Change decision' : 'Send decision'}<span className="sr-only"> for {r.code}</span>
        </button>
        {why && <span id={id('why')} className="text-[13px] text-black/70">{why}</span>}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid={`wh-return-msg-${r.code}`} className={`m-0 text-[14px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </form>
  );
}

function ReturnCard({ r }: { r: ReturnRow }) {
  const [label, tone] = RETURN_STATUS_CLIENT[r.status] ?? [r.status, 'neutral'];
  return (
    <li className="rounded-[10px] border border-line p-4 flex flex-col gap-2" data-testid={`wh-return-${r.code}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono font-semibold">{r.code}</span>
        <span data-testid={`wh-return-status-${r.code}`}><StatusBadge status={r.status} label={label} tone={TONE[tone]} /></span>
        <span className="ml-auto text-[13px] text-black/70">Received {fmtWh(r.created_at)}{r.warehouse ? ` · ${r.warehouse}` : ''}</span>
      </div>
      <div className="text-[13.5px] text-black/80">
        {r.order_code ? <>From order <Link href={`/account/warehouse?tab=orders&order=${r.order_code}`} className="font-mono underline">{r.order_code}</Link>{r.order_ref ? ` (your ${r.order_ref})` : ''}</> : 'Not linked to an order'}
        {r.carrier_ref ? ` · Return parcel ${r.carrier_ref}` : ''}{r.reason ? ` · Reason: ${r.reason}` : ''}
      </div>
      <ul className="m-0 pl-5 text-[13.5px]" aria-label={`Units in ${r.code}`}>
        {r.lines.map((l) => (
          <li key={l.id}><span className="font-mono">{l.sku}</span> · {l.name} × {l.qty} — <strong>{CONDITION_LABEL[l.condition] ?? l.condition}</strong></li>
        ))}
      </ul>
      {r.condition_note && <p className="m-0 text-[13.5px]"><span className="text-black/70">Inspection notes:</span> {r.condition_note}</p>}
      {r.photos.length > 0 && (
        <ul className="m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label={`Inspection photos of ${r.code}`}>
          {r.photos.map((p, i) => (
            <li key={p.path} className="rounded-[8px] border border-line overflow-hidden">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Inspection photo ${i + 1} of ${r.code}`} className="w-full h-[120px] object-cover block" />
                </a>
              ) : <div className="h-[120px] flex items-center justify-center text-[12.5px] text-black/70">Photo unavailable</div>}
            </li>
          ))}
        </ul>
      )}
      {r.charge_cents != null && r.charge_per_item_cents != null && (
        <p className="m-0 text-[13px] text-black/75" data-testid={`wh-return-charge-${r.code}`}>Returns handling: {r.charge_units} × {usd(r.charge_per_item_cents)} = {usd(r.charge_cents)} (on your monthly invoice)</p>
      )}
      {r.status === 'received' && <p className="m-0 text-[13.5px] text-black/75">We are inspecting this return. You can decide once the photos and condition are here.</p>}
      {r.status === 'inspected' && r.decide_by && (
        <p className={`m-0 text-[13.5px] ${r.overdue ? 'text-bad font-semibold' : ''}`}>
          Please decide by {fmtWh(r.decide_by)} China time. Without a decision we restock the good units and dispose of damaged ones.
        </p>
      )}
      {r.decision && (
        <p className="m-0 text-[14px]" data-testid={`wh-return-outcome-${r.code}`}>
          <strong>{DECISION_LABEL[r.decision]}</strong>{r.decision_source === 'default' ? ' (applied after the decision date)' : ''} · {decisionOutcome(r)}
        </p>
      )}
      {r.decision === 'send_back' && r.send_back_to && <p className="m-0 text-[13.5px] text-black/75">To {sendBackText(r)}</p>}
      {r.outbound_order && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/account/warehouse?tab=orders&order=${r.outbound_order.code}`} className="btn btn-ghost btn-sm">Order {r.outbound_order.code}</Link>
          {r.outbound_order.tracking_token && <Link href={`/t/${r.outbound_order.tracking_token}`} target="_blank" className="btn btn-ghost btn-sm">Tracking<span className="sr-only"> for {r.outbound_order.code}</span></Link>}
        </div>
      )}
      {(r.status === 'inspected' || r.status === 'decided') && <DecideForm r={r} />}
      <div><Link href={`/account/warehouse?tab=support&ref=${r.code}`} className="text-[13.5px] underline">Ask about {r.code}</Link></div>
    </li>
  );
}

export function ReturnsTab({ returns }: { returns: ReturnRow[] }) {
  const waiting = returns.filter((r) => r.status === 'inspected').length;
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-returns-tab">
      <section className="card p-5" aria-labelledby="wh-returns-h">
        <h2 id="wh-returns-h" className="text-[18px] font-semibold m-0">Returns</h2>
        <p className="mt-1 mb-0 text-[13.5px] text-black/75">
          Parcels your customers send back to our warehouse. We inspect and photograph every return; then you choose: restock, discard or send back.
          {waiting > 0 ? ` ${waiting} return${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} for your decision.` : ''}
        </p>
        {returns.length === 0 ? <p className="mt-3 mb-0 text-[14px] text-black/75">No returns yet.</p> : (
          <ul className="mt-3 mb-0 p-0 list-none flex flex-col gap-3">{returns.map((r) => <ReturnCard key={r.id} r={r} />)}</ul>
        )}
      </section>
    </div>
  );
}
