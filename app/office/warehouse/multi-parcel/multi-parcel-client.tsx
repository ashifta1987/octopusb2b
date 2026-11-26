'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsNotice, DsSelect } from '@/components/dropship-ui';
import { createClient } from '@/lib/supabase/client';
import { fmtWh } from '@/lib/warehouse-inbound';
import { DG_LABEL, EVIDENCE_KINDS, EVIDENCE_LABEL, EVIDENCE_MAX_BYTES, evidencePath, grams, type EvidenceKind } from '@/lib/warehouse-orders';
import {
  USE_SOURCE_LABEL, benchOptionText, benchUsable, firstUsableBench, orderCloseBlocker, parcelCloseBlocker, parcelWeight, qtyText,
  type MultiParcel, type Parcel,
} from '@/lib/warehouse-w3b';
import { EvidenceGallery, OrderStatusBadge, DgBadge } from '../orders/order-bits';
import {
  addParcelAction, closeOrderParcelsAction, parcelBoxAction, parcelCloseAction, parcelEvidenceAction, parcelOverrideAction, parcelRemoveAction,
  parcelReopenAction, parcelScanAction, parcelUnlockAction, parcelUnscanAction, parcelWeighAction, recordMaterialAction, voidMaterialAction,
} from '../w3b-actions';
import { MsgLine, useRun, type Msg } from '../wh-run';

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const digits = (s: string) => s.replace(/\D/g, '');

function ParcelPhoto({ d, p, kind }: { d: MultiParcel; p: Parcel; kind: EvidenceKind }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const has = p.evidence.some((e) => e.kind === kind);
  const id = `wh-p${p.seq}-photo-${kind}`;
  return (
    <div className="rounded-[10px] border border-[#E3E7EF] p-3 flex flex-col gap-2" data-testid={`wh-p${p.seq}-photo-step-${kind}`}>
      <div className="flex items-center gap-2"><strong className="text-[14px]">{EVIDENCE_LABEL[kind]}</strong>{has && <DsBadge tone="ok">Saved</DsBadge>}</div>
      <label htmlFor={id} className="text-[13px] text-[#5B6478]">{has ? 'Add another photo' : 'Take or choose a photo'} (parcel {p.seq})</label>
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={pending} data-testid={`wh-p${p.seq}-photo-file-${kind}`}
        className="text-[13px] min-h-[44px]"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > EVIDENCE_MAX_BYTES) { setMsg({ ok: false, text: 'Photos can be up to 10 MB.' }); return; }
          const path = evidencePath(d.order.warehouse_code, d.order.code, kind, crypto.randomUUID(), file.type);
          if (!path) { setMsg({ ok: false, text: 'Use a JPG, PNG or WebP photo.' }); return; }
          start(async () => {
            const { error } = await createClient().storage.from('wh-evidence').upload(path, file, { contentType: file.type, upsert: false });
            if (error) { setMsg({ ok: false, text: 'The photo did not upload. Check the connection and try again.' }); return; }
            const r = await parcelEvidenceAction(p.id, d.order.code, kind, path);
            setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
            if (r.ok) router.refresh();
          });
        }} />
      {pending && <p className="m-0 text-[13px] text-[#5B6478]" role="status">Uploading…</p>}
      <MsgLine msg={msg} testId={`wh-p${p.seq}-photo-msg-${kind}`} />
    </div>
  );
}

function ParcelCard({ d, p, last }: { d: MultiParcel; p: Parcel; last: boolean }) {
  const code = d.order.code;
  const scan = useRun();
  const box = useRun();
  const weigh = useRun();
  const ovr = useRun();
  const close = useRun();
  const misc = useRun();
  const mats = useRun();
  const open = p.status === 'open' && ['picked', 'packing'].includes(d.order.status);
  const [item, setItem] = useState('');
  const [boxId, setBoxId] = useState(p.box?.id ?? '');
  const [bench, setBench] = useState(firstUsableBench(d.benches) ?? '');
  const [g, setG] = useState(p.measured_weight_g ? String(p.measured_weight_g) : '');
  const [sup, setSup] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [mark, setMark] = useState(p.battery_mark);
  const [why, setWhy] = useState('');
  const [mat, setMat] = useState('');
  const [mqty, setMqty] = useState('1');
  const w = parcelWeight(p);
  const blocker = parcelCloseBlocker(p, mark, d.me);
  const benchMissing = d.bench_required && !bench;
  return (
    <DsCard testId={`wh-parcel-${p.seq}`}
      title={<span className="flex items-center gap-2">Parcel {p.seq}{p.source === 'single' ? ' (packing station)' : ''}</span>} icon="package"
      actions={<>{p.status === 'closed' ? <DsBadge tone="ok" testId={`wh-parcel-${p.seq}-state`}>Closed</DsBadge> : <DsBadge tone="info" testId={`wh-parcel-${p.seq}-state`}>Open</DsBadge>}
        {p.dg.length > 0 && <DsBadge tone="warn" icon="alert">DG: {p.dg.map((k) => DG_LABEL[k] ?? k).join(', ')}</DsBadge>}</>}>
      <div className="flex flex-col gap-4">
        {/* items */}
        <section aria-label={`Items in parcel ${p.seq}`}>
          {open && (
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (item) scan.run(() => parcelScanAction(p.id, code, item), () => setItem('')); }}>
              <DsInput id={`wh-p${p.seq}-scan`} label={`Scan product into parcel ${p.seq}`} value={item} onChange={(e) => setItem(upper(e.target.value))} autoComplete="off"
                autoCapitalize="characters" className="text-[18px] min-h-[48px]" containerClassName="flex-1 min-w-[200px]" />
              <DsButton type="submit" disabled={scan.pending || !item} testId={`wh-p${p.seq}-scan-submit`}>Scan</DsButton>
            </form>
          )}
          <MsgLine msg={scan.msg} testId={`wh-p${p.seq}-scan-msg`} />
          {p.items.length === 0 ? <p className="mt-2 mb-0 text-[13px] text-[#5B6478]">No items in this parcel yet.</p> : (
            <ul className="mt-2 mb-0 p-0 list-none flex flex-col gap-1.5">
              {p.items.map((i) => (
                <li key={i.line_id} className="flex flex-wrap items-center gap-2 text-[14px]" data-testid={`wh-p${p.seq}-item-${i.sku}`}>
                  <span className="font-mono font-semibold">{i.sku}</span><span>{i.name}</span><span className="ml-auto"><DsBadge tone="info">× {i.qty}</DsBadge></span>
                  {open && <DsButton variant="link" disabled={misc.pending} onClick={() => misc.run(() => parcelUnscanAction(p.id, code, i.line_id))} aria-label={`Take one ${i.sku} out of parcel ${p.seq}`}>Take one out</DsButton>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* box */}
        <section aria-label={`Box of parcel ${p.seq}`}>
          {open ? (d.boxes.length === 0 ? <DsNotice tone="warn" title="No boxes set up for this warehouse">A supervisor adds boxes under Station settings on the packing station.</DsNotice> : (
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); box.run(() => parcelBoxAction(p.id, code, boxId)); }}>
              <DsSelect id={`wh-p${p.seq}-box`} label="Box or mailer" value={boxId} onChange={(e) => setBoxId(e.target.value)} containerClassName="flex-1 min-w-[220px]">
                <option value="">Choose a box</option>
                {d.boxes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code}) · empty {b.tare_g} g{b.stock != null ? ` · ${b.stock} in stock` : ''}</option>)}
              </DsSelect>
              <DsButton type="submit" variant="secondary" disabled={box.pending || !boxId || boxId === p.box?.id} testId={`wh-p${p.seq}-box-submit`}>Use this box</DsButton>
            </form>
          )) : null}
          {p.box && <p className="mt-2 mb-0 text-[14px]" data-testid={`wh-p${p.seq}-expected`}>{p.box.name} · expected {p.expected_weight_g == null ? 'unknown (a product has no weight)' : `${grams(p.expected_weight_g)} ± ${p.tolerance_g} g`}</p>}
          <MsgLine msg={box.msg} testId={`wh-p${p.seq}-box-msg`} />
        </section>

        {/* photos */}
        <section aria-label={`Photos of parcel ${p.seq}`}>
          {open && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{EVIDENCE_KINDS.map((k) => <ParcelPhoto key={k} d={d} p={p} kind={k} />)}</div>}
          <div className="mt-3"><EvidenceGallery items={p.evidence} testId={`wh-p${p.seq}-gallery`} /></div>
        </section>

        {/* weigh */}
        <section aria-label={`Weight of parcel ${p.seq}`}>
          {open && (
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); weigh.run(() => parcelWeighAction(p.id, code, bench || null, Number(g))); }}>
              {d.benches.length > 0 && (
                <DsSelect id={`wh-p${p.seq}-bench`} label="Scale bench" value={bench} onChange={(e) => setBench(e.target.value)} containerClassName="min-w-[220px]">
                  <option value="">Choose the bench</option>
                  {d.benches.map((b) => <option key={b.id} value={b.id} disabled={!benchUsable(b)}>{benchOptionText(b)}</option>)}
                </DsSelect>
              )}
              <DsInput id={`wh-p${p.seq}-grams`} label="Scale reading (grams)" inputMode="numeric" value={g} onChange={(e) => setG(digits(e.target.value))} disabled={!p.box}
                className="text-[18px] min-h-[48px]" hint={!p.box ? 'Choose the box first' : undefined} />
              <DsButton type="submit" variant="secondary" icon="scale" disabled={weigh.pending || !p.box || !g || benchMissing}
                disabledReason={benchMissing ? (d.benches.some(benchUsable) ? 'Choose the scale bench' : 'No checked bench — run the scale check first') : undefined} testId={`wh-p${p.seq}-weigh-submit`}>Save weight</DsButton>
            </form>
          )}
          {d.bench_required && !d.benches.some(benchUsable) && open && (
            <div className="mt-2"><DsNotice tone="bad" title="No scale bench is checked" action={<Link href="/office/warehouse/scale" className="font-semibold text-[#2559B8] underline">Scale check</Link>}>A bench must pass its calibration check before parcels are weighed on it.</DsNotice></div>
          )}
          {p.measured_weight_g != null && (
            <p className="mt-2 mb-0 text-[14px] flex flex-wrap items-center gap-2" data-testid={`wh-p${p.seq}-weight`}>
              Measured {grams(p.measured_weight_g)}{p.bench ? ` on ${p.bench}` : ''}
              {w.within === true && <DsBadge tone="ok">Inside tolerance</DsBadge>}
              {w.within === false && <DsBadge tone="bad">{w.diff! > 0 ? '+' : ''}{w.diff} g · outside ± {p.tolerance_g} g</DsBadge>}
              {w.within === null && <DsBadge tone="warn">Expected weight unknown</DsBadge>}
              {w.approved && <DsBadge tone="ok">Approved by {p.override_by_name ?? 'a supervisor'}</DsBadge>}
            </p>
          )}
          <MsgLine msg={weigh.msg} testId={`wh-p${p.seq}-weigh-msg`} />
          {open && w.needsApproval && (
            <div className="mt-3 flex flex-col gap-3" data-testid={`wh-p${p.seq}-override`}>
              {p.override_locked_at ? (
                <>
                  <DsNotice tone="bad" title="Override locked" testId={`wh-p${p.seq}-override-locked`}>Three wrong PINs. A warehouse admin unlocks it here or from the Exceptions queue.</DsNotice>
                  {d.can_unlock && (
                    <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); misc.run(() => parcelUnlockAction(p.id, code, why), () => setWhy('')); }}>
                      <DsInput id={`wh-p${p.seq}-unlock`} label="Why unlock?" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} containerClassName="flex-1 min-w-[220px]" />
                      <DsButton type="submit" variant="secondary" icon="lock" disabled={misc.pending || !why.trim()}>Unlock</DsButton>
                    </form>
                  )}
                </>
              ) : p.supervisors.length === 0 ? (
                <DsNotice tone="warn" title="No supervisor can approve this parcel">Two people: the supervisor who approves must not have scanned or weighed this parcel, and needs a PIN set on the packing station.</DsNotice>
              ) : (
                <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" autoComplete="off"
                  onSubmit={(e) => { e.preventDefault(); ovr.run(() => parcelOverrideAction({ parcelId: p.id, code, supervisorId: sup, pin, reason }), () => setReason('')); setPin(''); }}>
                  <DsSelect id={`wh-p${p.seq}-sup`} label="Supervisor" value={sup} onChange={(e) => setSup(e.target.value)}>
                    <option value="">Choose</option>
                    {p.supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </DsSelect>
                  <DsInput id={`wh-p${p.seq}-pin`} label="Supervisor PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value).slice(0, 8))} />
                  <DsInput id={`wh-p${p.seq}-reason`} label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. extra padding" />
                  <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                    <DsButton type="submit" variant="secondary" icon="lock" disabled={ovr.pending || !sup || pin.length < 4 || reason.trim().length < 3} testId={`wh-p${p.seq}-override-submit`}>Approve weight</DsButton>
                    <span className="text-[13px] text-[#5B6478]">{3 - p.override_attempts} attempt(s) left</span>
                  </div>
                </form>
              )}
              <MsgLine msg={ovr.msg} testId={`wh-p${p.seq}-override-msg`} />
            </div>
          )}
        </section>

        {/* extra materials */}
        <section aria-label={`Materials of parcel ${p.seq}`}>
          {p.materials.length > 0 && (
            <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[13.5px]">
              {p.materials.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{m.material}</span><span>{qtyText(m.qty, m.unit)}</span><span className="text-[#5B6478]">{USE_SOURCE_LABEL[m.source] ?? m.source}</span>
                  {m.voided && <DsBadge tone="neutral">Taken back</DsBadge>}
                  {open && m.source === 'manual' && !m.voided && (
                    <DsButton variant="link" disabled={mats.pending} onClick={() => mats.run(() => voidMaterialAction(m.id, code, 'Not used'))}>Take back</DsButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {open && d.materials.length > 0 && (
            <form className="mt-2 flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); mats.run(() => recordMaterialAction({ orderId: d.order.id, code, parcelId: p.id, materialId: mat, qty: Number(mqty) }), () => setMqty('1')); }}>
              <DsSelect id={`wh-p${p.seq}-mat`} label="Extra material (tape, filler …)" value={mat} onChange={(e) => setMat(e.target.value)} containerClassName="flex-1 min-w-[200px]">
                <option value="">Choose</option>
                {d.materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code}) · {m.on_hand} left</option>)}
              </DsSelect>
              <DsInput id={`wh-p${p.seq}-matqty`} label="How many" inputMode="numeric" value={mqty} onChange={(e) => setMqty(digits(e.target.value))} containerClassName="w-[110px]" />
              <DsButton type="submit" variant="secondary" icon="plus" disabled={mats.pending || !mat || !mqty}>Record</DsButton>
            </form>
          )}
          <MsgLine msg={mats.msg} testId={`wh-p${p.seq}-mat-msg`} />
        </section>

        {/* close */}
        {open && p.dg.length > 0 && (
          <DsCheckbox label="Battery / dangerous goods mark is on this parcel" hint={`This parcel carries: ${p.dg.map((k) => DG_LABEL[k] ?? k).join(', ')}`} checked={mark}
            onChange={(e) => setMark(e.target.checked)} data-testid={`wh-p${p.seq}-dg-mark`} />
        )}
        {open ? (
          <div className="flex flex-wrap items-start gap-3">
            <DsButton icon="check" disabled={close.pending || Boolean(blocker)} disabledReason={blocker} className="min-h-[52px]" testId={`wh-p${p.seq}-close-submit`}
              onClick={() => close.run(() => parcelCloseAction(p.id, code, mark))}>Close parcel {p.seq}</DsButton>
            {last && p.items.length === 0 && p.evidence.length === 0 && (
              <DsButton variant="link" disabled={misc.pending} onClick={() => misc.run(() => parcelRemoveAction(p.id, code))} testId={`wh-p${p.seq}-remove`}>Remove this empty parcel</DsButton>
            )}
          </div>
        ) : p.status === 'closed' && (
          <p className="m-0 text-[13px] text-[#5B6478]">Closed {fmtWh(p.closed_at)}{p.closed_by_name ? ` by ${p.closed_by_name}` : ''}{p.battery_mark ? ' · battery mark applied' : ''}</p>
        )}
        {p.status === 'closed' && d.can_reopen && ['picked', 'packing'].includes(d.order.status) && (
          <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); misc.run(() => parcelReopenAction(p.id, code, why), () => setWhy('')); }}>
            <DsInput id={`wh-p${p.seq}-reopen`} label="Reopen (supervisor) — why?" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} containerClassName="flex-1 min-w-[220px]" />
            <DsButton type="submit" variant="secondary" disabled={misc.pending || !why.trim()} testId={`wh-p${p.seq}-reopen-submit`}>Reopen</DsButton>
          </form>
        )}
        <MsgLine msg={close.msg} testId={`wh-p${p.seq}-close-msg`} />
        <MsgLine msg={misc.msg} testId={`wh-p${p.seq}-misc-msg`} />
      </div>
    </DsCard>
  );
}

export function MultiParcelClient({ d }: { d: MultiParcel }) {
  const add = useRun();
  const fin = useRun();
  const o = d.order;
  const packing = ['picked', 'packing'].includes(o.status);
  const blocker = orderCloseBlocker(d);
  if (!d.can_pack) {
    return <DsNotice tone="info" title="Packers, supervisors and admins of this warehouse pack">You can see the order on its <Link href={`/office/warehouse/orders/${o.code}`} className="underline">detail page</Link>.</DsNotice>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wh-multi-order">
      <DsCard title={o.code} icon="layers" actions={<><OrderStatusBadge status={o.status} testId="wh-multi-status" /><DgBadge kinds={o.dg_kinds} /></>}>
        <p className="m-0 text-[14px]">{o.owner} · {o.ship_name} · {o.ship_country}{o.store_order ? ` · ${o.store_order}` : ''}</p>
        <ul className="mt-3 mb-0 p-0 list-none flex flex-col gap-1.5" aria-label="Picked items">
          {d.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 text-[14px]" data-testid={`wh-multi-line-${l.sku}`}>
              <span className="font-mono font-semibold">{l.sku}</span><span>{l.name}</span>
              <span className="ml-auto"><DsBadge tone={l.packed >= l.picked ? 'ok' : 'info'}>{l.packed} of {l.picked} in parcels</DsBadge></span>
            </li>
          ))}
        </ul>
        {o.status === 'packed' && <div className="mt-3"><DsNotice tone="ok" title="Packed" testId="wh-multi-packed" action={<Link href={`/office/warehouse/evidence/${o.code}`} className="font-semibold text-[#2559B8] underline">Evidence</Link>}>{d.parcels.length} parcels · {grams(o.measured_weight_g)} in total · closed {fmtWh(o.packed_at)}.</DsNotice></div>}
        {o.store_order_cancelled && <div className="mt-3"><DsNotice tone="bad" title="The Dropship order was cancelled">Don’t pack it; a supervisor cancels this warehouse order.</DsNotice></div>}
        {o.override_locked_at && packing && <div className="mt-3"><DsNotice tone="bad" title="Weight override locked on the order">A warehouse admin unlocks it on the order page before it is split into parcels.</DsNotice></div>}
        {packing && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <DsButton variant="secondary" icon="plus" disabled={add.pending || Boolean(o.override_locked_at)} onClick={() => add.run(() => addParcelAction(o.id, o.code))} testId="wh-multi-add">
              {d.parcels.length === 0 ? 'Pack in parcels' : 'Add a parcel'}
            </DsButton>
            {d.parcels.length === 0 && <span className="text-[13px] text-[#5B6478]">Anything already scanned at the packing station becomes parcel 1.</span>}
          </div>
        )}
        <MsgLine msg={add.msg} testId="wh-multi-add-msg" />
      </DsCard>
      {d.parcels.map((p, i) => <ParcelCard key={p.id} d={d} p={p} last={i === d.parcels.length - 1} />)}
      {packing && d.parcels.length > 0 && (
        <DsCard testId="wh-multi-close">
          <DsButton icon="check" disabled={fin.pending || Boolean(blocker)} disabledReason={blocker} className="min-h-[52px]" testId="wh-multi-close-submit"
            onClick={() => fin.run(() => closeOrderParcelsAction(o.id, o.code))}>Close the order ({d.parcels.length} parcels)</DsButton>
          <div className="mt-2"><MsgLine msg={fin.msg} testId="wh-multi-close-msg" /></div>
        </DsCard>
      )}
    </div>
  );
}
