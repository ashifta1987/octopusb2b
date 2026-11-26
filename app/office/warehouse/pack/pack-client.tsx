'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsEmptyState, DsInput, DsNotice, DsSelect } from '@/components/dropship-ui';
import { createClient } from '@/lib/supabase/client';
import { fmtWh } from '@/lib/warehouse-inbound';
import {
  EVIDENCE_KINDS, EVIDENCE_LABEL, EVIDENCE_MAX_BYTES, evidencePath, grams,
  type EvidenceKind, type OrderDetail, type PackBoard, type Station,
} from '@/lib/warehouse-orders';
import {
  addEvidenceAction, closeParcelAction, overrideAction, packScanAction, saveBoxAction, saveSettingsAction, setBoxAction, setMyPinAction,
} from '../order-actions';
import { USE_SOURCE_LABEL, benchOptionText, benchUsable, firstUsableBench, qtyText, type PackExtras } from '@/lib/warehouse-w3b';
import { recordMaterialAction, voidMaterialAction, weighOnBenchAction } from '../w3b-actions';
import { MsgLine, useRun, type Msg } from '../wh-run';
import { DgBadge, EvidenceGallery, OrderStatusBadge } from '../orders/order-bits';

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const digits = (s: string) => s.replace(/\D/g, '');

function Step({ n, title, done, children, testId }: { n: number; title: string; done: boolean; children: ReactNode; testId: string }) {
  return (
    <DsCard testId={testId} title={<span className="flex items-center gap-2"><span className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-[13px] font-bold ${done ? 'bg-ok text-white' : 'border-2 border-line-strong text-muted'}`} aria-hidden="true">{n}</span>{title}</span>}
      actions={done ? <DsBadge tone="ok">Done</DsBadge> : undefined}>
      {children}
    </DsCard>
  );
}

function PhotoInput({ d, kind }: { d: OrderDetail; kind: EvidenceKind }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const has = d.evidence.some((e) => e.kind === kind);
  const id = `wh-photo-input-${kind}`;
  return (
    <div className="rounded-[10px] border border-line p-3 flex flex-col gap-2" data-testid={`wh-photo-step-${kind}`}>
      <div className="flex items-center gap-2"><strong className="text-[14px]">{EVIDENCE_LABEL[kind]}</strong>{has && <DsBadge tone="ok">Saved</DsBadge>}</div>
      <label htmlFor={id} className="text-[13px] text-muted">{has ? 'Add another photo' : 'Take or choose a photo'}</label>
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={pending} data-testid={`wh-photo-file-${kind}`}
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
            const r = await addEvidenceAction(d.order.id, d.order.code, kind, path);
            setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
            if (r.ok) router.refresh();
          });
        }} />
      {pending && <p className="m-0 text-[13px] text-muted" role="status">Uploading…</p>}
      <MsgLine msg={msg} testId={`wh-photo-msg-${kind}`} />
    </div>
  );
}

/** W3b: extra packaging (tape, filler …) used for this order; the box and battery mark are taken automatically at close. */
function Materials({ d, x }: { d: OrderDetail; x: PackExtras }) {
  const { pending, msg, run } = useRun();
  const [mat, setMat] = useState('');
  const [qty, setQty] = useState('1');
  const open = ['picked', 'packing'].includes(d.order.status);
  const extra = x.materials.filter((m) => !m.box_id);
  if (!x.usage.length && (!open || !extra.length)) return null;
  return (
    <DsCard title="Packaging used" icon="tag" testId="wh-pack-materials" subtitle="Charged to the client by use. The box and the battery mark are taken from stock when the parcel closes (when they are stocked).">
      {x.usage.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[13.5px]">
          {x.usage.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2" data-testid={`wh-pack-use-${u.material}`}>
              <span className="font-mono">{u.material}</span><span>{qtyText(u.qty, u.unit)}</span><span className="text-muted">{USE_SOURCE_LABEL[u.source] ?? u.source}</span>
              {u.voided && <DsBadge tone="neutral">Taken back</DsBadge>}
              {open && u.source === 'manual' && !u.voided && <DsButton variant="link" disabled={pending} onClick={() => run(() => voidMaterialAction(u.id, d.order.code, 'Not used'))}>Take back</DsButton>}
            </li>
          ))}
        </ul>
      )}
      {open && extra.length > 0 && (
        <form className="mt-2 flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => recordMaterialAction({ orderId: d.order.id, code: d.order.code, parcelId: null, materialId: mat, qty: Number(qty) }), () => setQty('1')); }}>
          <DsSelect id="wh-pack-mat" label="Extra material (tape, filler …)" value={mat} onChange={(e) => setMat(e.target.value)} containerClassName="flex-1 min-w-[200px]">
            <option value="">Choose</option>
            {extra.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code}) · {m.on_hand} left</option>)}
          </DsSelect>
          <DsInput id="wh-pack-mat-qty" label="How many" inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} containerClassName="w-[110px]" />
          <DsButton type="submit" variant="secondary" icon="plus" disabled={pending || !mat || !qty} testId="wh-pack-mat-submit">Record</DsButton>
        </form>
      )}
      <div className="mt-2"><MsgLine msg={msg} testId="wh-pack-mat-msg" /></div>
    </DsCard>
  );
}

function PackOrder({ d, x }: { d: OrderDetail; x: PackExtras | null }) {
  const o = d.order;
  const scan = useRun();
  const box = useRun();
  const weigh = useRun();
  const ovr = useRun();
  const close = useRun();
  const [code, setCode] = useState('');
  const [boxId, setBoxId] = useState(o.box?.id ?? '');
  const [g, setG] = useState(o.measured_weight_g ? String(o.measured_weight_g) : '');
  const benches = x?.benches ?? [];
  const [bench, setBench] = useState(firstUsableBench(benches) ?? '');
  const benchMissing = Boolean(x?.bench_required) && !bench;
  const [sup, setSup] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [mark, setMark] = useState(o.battery_mark);
  const open = ['picked', 'packing'].includes(o.status);
  const allScanned = d.lines.every((l) => l.packed >= l.picked) && d.lines.some((l) => l.picked > 0);
  const photosDone = EVIDENCE_KINDS.every((k) => d.evidence.some((e) => e.kind === k));
  const diff = o.expected_weight_g != null && o.measured_weight_g != null ? o.measured_weight_g - o.expected_weight_g : null;
  const within = diff != null && o.tolerance_g != null ? Math.abs(diff) <= o.tolerance_g : null;
  const overridden = o.override_by_name != null && o.override_weight_g === o.measured_weight_g;
  const needsOverride = o.measured_weight_g != null && within !== true && !overridden;
  const weightOk = o.measured_weight_g != null && (within === true || overridden);
  const why = !open ? `This order is ${o.status}` : !allScanned ? 'Scan every item first' : !o.box ? 'Choose the box' : !photosDone ? 'Add the contents, sealed and scale photos'
    : o.measured_weight_g == null ? 'Weigh the parcel' : !weightOk ? 'Weight outside tolerance: a supervisor approves with a PIN'
      : o.has_dangerous_goods && !mark ? 'Apply the battery mark and tick it'
        : overridden && within !== true && o.override_by_id === d.me ? 'You approved this weight; another person closes the parcel' : undefined;
  if (!d.can_pack) {
    return <DsNotice tone="info" title="Packers, supervisors and admins of this warehouse pack">You can see the order on its <Link href={`/office/warehouse/orders/${o.code}`} className="underline">detail page</Link>.</DsNotice>;
  }
  // W3b: an order split into parcels is packed on the multi-parcel screen
  if (open && x && x.parcels > 0) {
    return (
      <DsNotice tone="info" title={`${o.code} is packed in ${x.parcels} parcels`} testId="wh-pack-multi"
        action={<Link href={`/office/warehouse/multi-parcel?order=${o.code}`} className="font-semibold text-coral-text underline">Open multi-parcel packing</Link>}>
        Items, boxes, photos and weights are recorded per parcel there.
      </DsNotice>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wh-pack-order">
      <DsCard title={o.code} icon="package" actions={<><OrderStatusBadge status={o.status} testId="wh-pack-status" /><DgBadge kinds={o.dg_kinds} /></>}>
        <p className="m-0 text-[14px]">{o.owner} · {o.ship_name} · {o.ship_country}{o.store_order ? ` · ${o.store_order}` : ''}</p>
        {o.status === 'packed' && <div className="mt-3"><DsNotice tone="ok" title="Packed" action={<Link href={`/office/warehouse/evidence/${o.code}`} className="font-semibold text-coral-text underline">Evidence</Link>}>Closed at {fmtWh(o.packed_at)}.</DsNotice></div>}
        {o.store_order_cancelled && <div className="mt-3"><DsNotice tone="bad" title="The Dropship order was cancelled">Don’t pack it; a supervisor cancels this warehouse order.</DsNotice></div>}
        {open && (
          <p className="mt-3 mb-0 text-[13px] text-muted">Needs more than one box? <Link href={`/office/warehouse/multi-parcel?order=${o.code}`} className="font-semibold text-coral-text underline" data-testid="wh-pack-to-multi">Pack it in several parcels</Link></p>
        )}
      </DsCard>

      <Step n={1} title="Scan every item" done={allScanned} testId="wh-pack-step-scan">
        {open && (
          <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (code) scan.run(() => packScanAction(o.id, o.code, code), () => setCode('')); }}>
            <DsInput id="wh-pack-scan" label="Scan product (SKU or barcode)" value={code} onChange={(e) => setCode(upper(e.target.value))} autoComplete="off"
              autoCapitalize="characters" className="text-[18px] min-h-[48px]" containerClassName="flex-1 min-w-[220px]" />
            <DsButton type="submit" disabled={scan.pending || !code} testId="wh-pack-scan-submit">Scan</DsButton>
          </form>
        )}
        <ul className="mt-3 mb-0 p-0 list-none flex flex-col gap-1.5">
          {d.lines.filter((l) => l.picked > 0).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 text-[14px]" data-testid={`wh-pack-line-${l.sku}`}>
              <span className="font-mono font-semibold">{l.sku}</span><span>{l.name}</span>
              <span className="ml-auto"><DsBadge tone={l.packed >= l.picked ? 'ok' : 'info'}>{l.packed} of {l.picked}</DsBadge></span>
            </li>
          ))}
        </ul>
        <div className="mt-2"><MsgLine msg={scan.msg} testId="wh-pack-scan-msg" /></div>
      </Step>

      <Step n={2} title="Box" done={Boolean(o.box)} testId="wh-pack-step-box">
        {d.boxes.length === 0 ? (
          <DsNotice tone="warn" title="No boxes set up for this warehouse">A supervisor adds the boxes and their empty weight under Station settings below.</DsNotice>
        ) : (
          <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); box.run(() => setBoxAction(o.id, o.code, boxId)); }}>
            <DsSelect label="Box or mailer" value={boxId} onChange={(e) => setBoxId(e.target.value)} disabled={!open} containerClassName="flex-1 min-w-[220px]">
              <option value="">Choose a box</option>
              {d.boxes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code}) · empty {b.tare_g} g{b.length_mm ? ` · ${b.length_mm}×${b.width_mm}×${b.height_mm} mm` : ''}</option>)}
            </DsSelect>
            <DsButton type="submit" variant="secondary" disabled={box.pending || !open || !boxId || boxId === o.box?.id} testId="wh-pack-box-submit">Use this box</DsButton>
          </form>
        )}
        {o.box && <p className="mt-2 mb-0 text-[14px]" data-testid="wh-pack-expected">Expected {o.expected_weight_g == null ? 'unknown (a product has no weight)' : `${grams(o.expected_weight_g)} ± ${o.tolerance_g} g`}</p>}
        <MsgLine msg={box.msg} testId="wh-pack-box-msg" />
      </Step>

      <Step n={3} title="Photos" done={photosDone} testId="wh-pack-step-photos">
        {open && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{EVIDENCE_KINDS.map((k) => <PhotoInput key={k} d={d} kind={k} />)}</div>}
        <div className="mt-3"><EvidenceGallery items={d.evidence} /></div>
      </Step>

      <Step n={4} title="Weigh" done={weightOk} testId="wh-pack-step-weigh">
        <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); weigh.run(() => weighOnBenchAction(o.id, o.code, bench || null, Number(g))); }}>
          {benches.length > 0 && (
            <DsSelect id="wh-pack-bench" label="Scale bench" value={bench} onChange={(e) => setBench(e.target.value)} disabled={!open} containerClassName="min-w-[220px]">
              <option value="">Choose the bench</option>
              {benches.map((b) => <option key={b.id} value={b.id} disabled={!benchUsable(b)}>{benchOptionText(b)}</option>)}
            </DsSelect>
          )}
          <DsInput label="Scale reading (grams)" inputMode="numeric" pattern="[0-9]*" value={g} onChange={(e) => setG(digits(e.target.value))} disabled={!open || !o.box}
            className="text-[18px] min-h-[48px]" hint={!o.box ? 'Choose the box first' : undefined} />
          <DsButton type="submit" variant="secondary" icon="scale" disabled={weigh.pending || !open || !o.box || !g || benchMissing}
            disabledReason={benchMissing ? (benches.some(benchUsable) ? 'Choose the scale bench' : 'No checked bench — run the scale check first') : undefined} testId="wh-pack-weigh-submit">Save weight</DsButton>
        </form>
        {open && x?.bench_required && !benches.some(benchUsable) && (
          <div className="mt-2"><DsNotice tone="bad" title="No scale bench is checked" testId="wh-pack-no-bench" action={<Link href="/office/warehouse/scale" className="font-semibold text-coral-text underline">Scale check</Link>}>A bench must pass its calibration check before parcels are weighed on it.</DsNotice></div>
        )}
        {o.measured_weight_g != null && (
          <p className="mt-2 mb-0 text-[14px] flex flex-wrap items-center gap-2" data-testid="wh-pack-weight-result">
            Measured {grams(o.measured_weight_g)}{x?.weighed_bench ? ` on ${x.weighed_bench}` : ''}
            {within === true && <DsBadge tone="ok">Inside tolerance</DsBadge>}
            {within === false && <DsBadge tone="bad">{diff! > 0 ? '+' : ''}{diff} g · outside ± {o.tolerance_g} g</DsBadge>}
            {within === null && <DsBadge tone="warn">Expected weight unknown</DsBadge>}
            {overridden && <DsBadge tone="ok">Approved by {o.override_by_name}</DsBadge>}
          </p>
        )}
        <MsgLine msg={weigh.msg} testId="wh-pack-weigh-msg" />
        {open && needsOverride && (
          <div className="mt-4 flex flex-col gap-3" data-testid="wh-override">
            {o.override_locked_at ? (
              <DsNotice tone="bad" title="Override locked" testId="wh-override-locked">Three wrong PINs. A warehouse admin unlocks it on the <Link href={`/office/warehouse/orders/${o.code}`} className="underline">order page</Link>.</DsNotice>
            ) : d.supervisors.length === 0 ? (
              <DsNotice tone="warn" title="No supervisor can approve this parcel" testId="wh-override-no-supervisor">
                Two people: the supervisor who approves must not be the person who packed or weighed this parcel. Ask another supervisor (with a PIN set under Station settings), or let another packer re-weigh it.
              </DsNotice>
            ) : (
              <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" autoComplete="off"
                onSubmit={(e) => { e.preventDefault(); ovr.run(() => overrideAction({ orderId: o.id, code: o.code, supervisorId: sup, pin, reason }), () => { setPin(''); setReason(''); }); setPin(''); }}>
                <DsSelect label="Supervisor" value={sup} onChange={(e) => setSup(e.target.value)}>
                  <option value="">Choose</option>
                  {d.supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </DsSelect>
                <DsInput label="Supervisor PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value).slice(0, 8))} />
                <DsInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. heavier protective box" />
                <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                  <DsButton type="submit" variant="secondary" icon="lock" disabled={ovr.pending || !sup || pin.length < 4 || reason.trim().length < 3} testId="wh-override-submit">Approve weight</DsButton>
                  <span className="text-[13px] text-muted" data-testid="wh-override-left">{3 - o.override_attempts} attempt(s) left · packers, and whoever packed or weighed this parcel, cannot approve</span>
                </div>
              </form>
            )}
            <MsgLine msg={ovr.msg} testId="wh-override-msg" />
          </div>
        )}
      </Step>

      {o.has_dangerous_goods && (
        <Step n={5} title="Battery mark" done={mark} testId="wh-pack-step-dg">
          <DsCheckbox label="Battery / dangerous goods mark is on the box" hint={`This parcel carries: ${o.dg_kinds.join(', ')}`} checked={mark} disabled={!open}
            onChange={(e) => setMark(e.target.checked)} data-testid="wh-pack-dg-mark" />
        </Step>
      )}

      {x && <Materials d={d} x={x} />}

      <DsCard testId="wh-pack-close">
        <DsButton icon="check" disabled={close.pending || Boolean(why)} disabledReason={why} className="min-h-[52px]" testId="wh-pack-close-submit"
          onClick={() => close.run(() => closeParcelAction(o.id, o.code, mark))}>Close parcel</DsButton>
        <div className="mt-2"><MsgLine msg={close.msg} testId="wh-pack-close-msg" /></div>
      </DsCard>
    </div>
  );
}

function MyPin() {
  const { pending, msg, run } = useRun();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  return (
    <form className="flex flex-wrap gap-3 items-end" autoComplete="off" data-testid="wh-pin-form"
      onSubmit={(e) => { e.preventDefault(); run(() => setMyPinAction(pin, again), () => { setPin(''); setAgain(''); }); }}>
      <DsInput label="New PIN (4–8 digits)" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value).slice(0, 8))} />
      <DsInput label="Repeat PIN" type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(digits(e.target.value).slice(0, 8))} />
      <DsButton type="submit" variant="secondary" icon="lock" disabled={pending || pin.length < 4 || pin !== again} testId="wh-pin-submit">Save my PIN</DsButton>
      <div className="w-full"><MsgLine msg={msg} testId="wh-pin-msg" /></div>
    </form>
  );
}

function StationSettings({ s }: { s: Station }) {
  const set = useRun();
  const bx = useRun();
  const [tolG, setTolG] = useState(String(s.tolerance_g));
  const [tolPct, setTolPct] = useState(String(s.tolerance_pct));
  const [days, setDays] = useState(String(s.retention_days));
  const [f, setF] = useState({ code: '', name: '', l: '', w: '', h: '', tare: '' });
  return (
    <DsCard title={`${s.name} station`} icon="gear" testId={`wh-station-${s.warehouse_code}`}>
      {s.can_settings ? (
        <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" data-testid="wh-settings-form"
          onSubmit={(e) => { e.preventDefault(); set.run(() => saveSettingsAction({ warehouse: s.warehouse_code, toleranceG: Number(tolG), tolerancePct: Number(tolPct), retentionDays: Number(days) })); }}>
          <DsInput label="Tolerance (grams)" inputMode="numeric" value={tolG} onChange={(e) => setTolG(digits(e.target.value))} />
          <DsInput label="Tolerance (%)" inputMode="decimal" value={tolPct} onChange={(e) => setTolPct(e.target.value.replace(/[^0-9.]/g, ''))} />
          <DsInput label="Keep photos (days)" inputMode="numeric" value={days} onChange={(e) => setDays(digits(e.target.value))} />
          <DsButton type="submit" variant="secondary" disabled={set.pending} testId="wh-settings-submit">Save settings</DsButton>
          <div className="sm:col-span-4"><MsgLine msg={set.msg} testId="wh-settings-msg" /></div>
        </form>
      ) : (
        <p className="m-0 text-[13.5px]" data-testid="wh-settings-readonly">Tolerance: {s.tolerance_g} g or {s.tolerance_pct} %, whichever is larger · photos kept {s.retention_days} days. A warehouse admin changes these.</p>
      )}
      <h3 className="mt-4 mb-2 text-[15px] font-semibold">Boxes</h3>
      {s.boxes.length === 0 ? <p className="m-0 text-[13px] text-muted">No boxes yet.</p> : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
          {s.boxes.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 text-[13.5px]" data-testid={`wh-box-${b.code}`}>
              <span className="font-mono font-semibold">{b.code}</span><span>{b.name}</span><span className="text-muted">empty {b.tare_g} g{b.length_mm ? ` · ${b.length_mm}×${b.width_mm}×${b.height_mm} mm` : ''}</span>
              {!b.active && <DsBadge tone="neutral">Not in use</DsBadge>}
              {s.can_boxes && (
                <DsButton variant="link" disabled={bx.pending} onClick={() => bx.run(() => saveBoxAction({
                  warehouse: s.warehouse_code, id: b.id, code: b.code, name: b.name, lengthMm: b.length_mm ? String(b.length_mm) : '', widthMm: b.width_mm ? String(b.width_mm) : '',
                  heightMm: b.height_mm ? String(b.height_mm) : '', tareG: String(b.tare_g), active: !b.active }))}>{b.active ? 'Stop using' : 'Use again'}</DsButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.can_boxes && (
        <form className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end" data-testid="wh-box-form"
          onSubmit={(e) => { e.preventDefault(); bx.run(() => saveBoxAction({ warehouse: s.warehouse_code, id: null, code: f.code, name: f.name, lengthMm: f.l, widthMm: f.w, heightMm: f.h, tareG: f.tare, active: true }), () => setF({ code: '', name: '', l: '', w: '', h: '', tare: '' })); }}>
          <DsInput label="Code" value={f.code} onChange={(e) => setF({ ...f, code: upper(e.target.value) })} placeholder="BOX-S" />
          <DsInput label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} containerClassName="col-span-2 sm:col-span-1" />
          <DsInput label="Length (mm)" inputMode="numeric" value={f.l} onChange={(e) => setF({ ...f, l: digits(e.target.value) })} />
          <DsInput label="Width (mm)" inputMode="numeric" value={f.w} onChange={(e) => setF({ ...f, w: digits(e.target.value) })} />
          <DsInput label="Height (mm)" inputMode="numeric" value={f.h} onChange={(e) => setF({ ...f, h: digits(e.target.value) })} />
          <DsInput label="Empty weight (g)" inputMode="numeric" value={f.tare} onChange={(e) => setF({ ...f, tare: digits(e.target.value) })} />
          <div className="col-span-2 sm:col-span-6"><DsButton type="submit" variant="secondary" icon="plus" disabled={bx.pending || !f.code || !f.name.trim() || !f.tare} testId="wh-box-submit">Add box</DsButton></div>
        </form>
      )}
      <div className="mt-2"><MsgLine msg={bx.msg} testId="wh-box-msg" /></div>
    </DsCard>
  );
}

export function PackClient({ board, detail, extras = null }: { board: PackBoard; detail: OrderDetail | null; extras?: PackExtras | null }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        <DsCard title="Ready to pack" icon="list" testId="wh-pack-queue">
          {board.queue.length === 0 ? <p className="m-0 text-[13px] text-muted">Nothing to pack. Orders appear once they are fully picked.</p> : (
            <ul className="m-0 p-0 list-none flex flex-col gap-2">
              {board.queue.map((o) => (
                <li key={o.id}>
                  <Link href={`/office/warehouse/pack?order=${o.code}`} aria-current={detail?.order.code === o.code ? 'page' : undefined} data-testid={`wh-pack-open-${o.code}`}
                    className={`block rounded-[10px] border p-3 no-underline text-ink min-h-[44px] ${detail?.order.code === o.code ? 'border-coral-text bg-tint-2' : 'border-line hover:bg-pearl'}`}>
                    <span className="font-mono font-semibold">{o.code}</span> <span className="text-[12.5px] text-muted">· {o.picked} unit(s){o.has_dangerous_goods ? ' · DG' : ''}</span>
                    <span className="block text-[12.5px] text-muted">{o.owner}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
        {detail ? <PackOrder d={detail} x={extras} /> : (
          <DsEmptyState icon="package" title="Choose an order" description="Pick an order from the list, or scan its WO number on the order page." testId="wh-pack-none" />
        )}
      </div>

      <section aria-labelledby="wh-station-settings" className="flex flex-col gap-4">
        <h2 id="wh-station-settings" className="m-0 text-[18px] font-bold">Station settings</h2>
        {board.can_set_pin && (
          <DsCard title="My override PIN" icon="lock" testId="wh-my-pin"
            subtitle={board.my_pin_locked ? 'Your PIN is locked after too many wrong tries. Set a new one.' : board.my_pin_set ? 'Your PIN is set. You can change it here.' : 'Set your PIN to approve weight differences at the station.'}>
            <MyPin />
          </DsCard>
        )}
        {board.stations.map((s) => <StationSettings key={s.warehouse_code} s={s} />)}
      </section>
    </div>
  );
}
