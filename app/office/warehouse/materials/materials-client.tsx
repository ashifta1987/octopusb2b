'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import {
  MATERIAL_KINDS, MATERIAL_KIND_LABEL, MATERIAL_UNITS, MOVE_LABEL, UNIT_LABEL, chargeText, qtyText,
  type Material, type MaterialKind, type MaterialStation, type MaterialUnit,
} from '@/lib/warehouse-w3b';
import { countMaterialAction, receiveMaterialAction, saveMaterialAction, setMaterialChargeAction } from '../w3b-actions';
import { MsgLine, useRun } from '../wh-run';

const digits = (s: string) => s.replace(/\D/g, '');
const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');

function MaterialRow({ m, s }: { m: Material; s: MaterialStation }) {
  const rcv = useRun();
  const cnt = useRun();
  const price = useRun();
  const edit = useRun();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [p, setP] = useState(m.charge_per_unit_cents == null ? '' : (Number(m.charge_per_unit_cents) / 100).toFixed(2));
  const [low, setLow] = useState(m.low_stock_at == null ? '' : String(m.low_stock_at));
  return (
    <li className="rounded-[12px] border border-[#E3E7EF] bg-white p-4 flex flex-col gap-3" data-testid={`wh-material-${m.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold text-[15px]">{m.code}</span>
        <span className="text-[14px]">{m.name}</span>
        <DsBadge tone="neutral" icon="tag">{MATERIAL_KIND_LABEL[m.kind]}</DsBadge>
        {m.box_code && <DsBadge tone="info" icon="box">Box {m.box_code} · used automatically</DsBadge>}
        {m.auto_dg_mark && <DsBadge tone="info">Battery mark · used automatically</DsBadge>}
        {!m.active && <DsBadge tone="neutral">Not in use</DsBadge>}
        <span className="ml-auto flex items-center gap-2">
          <strong className="text-[18px]" data-testid={`wh-material-onhand-${m.code}`}>{qtyText(m.on_hand, m.unit)}</strong>
          {m.low ? <DsBadge tone="warn" testId={`wh-material-low-${m.code}`}>Low stock</DsBadge> : null}
        </span>
      </div>
      <p className="m-0 text-[13px] text-[#5B6478]">
        Low-stock alert {m.low_stock_at == null ? 'not set' : `at ${m.low_stock_at}`} · used in the last 30 days: {m.used_30d} ·
        price per unit <span data-testid={`wh-material-price-${m.code}`}>{chargeText(m.charge_per_unit_cents)}</span>
      </p>
      {m.active && s.can_receive && (
        <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" data-testid={`wh-material-receive-${m.code}`}
          onSubmit={(e) => { e.preventDefault(); rcv.run(() => receiveMaterialAction(m.id, Number(qty), note), () => { setQty(''); setNote(''); }); }}>
          <DsInput id={`wh-rcv-${m.id}`} label={`Receive (${UNIT_LABEL[m.unit]})`} inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} />
          <DsInput id={`wh-rcv-note-${m.id}`} label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} containerClassName="sm:col-span-2" placeholder="Supplier delivery, PO …" />
          <DsButton type="submit" variant="secondary" icon="download" disabled={rcv.pending || !qty} testId={`wh-material-receive-submit-${m.code}`}>Receive</DsButton>
          <div className="sm:col-span-4"><MsgLine msg={rcv.msg} testId={`wh-material-receive-msg-${m.code}`} /></div>
        </form>
      )}
      {(s.can_count || s.can_price || s.can_manage) && (
        <details>
          <summary className="cursor-pointer text-[13.5px] font-semibold text-[#2559B8] min-h-[44px] flex items-center">Count, price and settings</summary>
          <div className="mt-2 flex flex-col gap-3">
            {s.can_count && (
              <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); cnt.run(() => countMaterialAction(m.id, Number(counted), reason), () => { setCounted(''); setReason(''); }); }}>
                <DsInput id={`wh-cnt-${m.id}`} label="Counted on the shelf" inputMode="numeric" value={counted} onChange={(e) => setCounted(digits(e.target.value))} />
                <DsInput id={`wh-cnt-r-${m.id}`} label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} containerClassName="sm:col-span-2" placeholder="Stock take, damaged …" />
                <DsButton type="submit" variant="secondary" disabled={cnt.pending || counted === '' || !reason.trim()}>Save count</DsButton>
                <div className="sm:col-span-4"><MsgLine msg={cnt.msg} testId={`wh-material-count-msg-${m.code}`} /></div>
              </form>
            )}
            {s.can_price ? (
              <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); price.run(() => setMaterialChargeAction(m.id, p)); }}>
                <DsInput id={`wh-price-${m.id}`} label="Price per unit charged to the client (US$)" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value.replace(/[^0-9.]/g, ''))}
                  containerClassName="sm:col-span-3" hint="Leave empty for “Not set” — uses are then recorded without a charge." />
                <DsButton type="submit" variant="secondary" icon="dollar" disabled={price.pending} testId={`wh-material-price-submit-${m.code}`}>Save price</DsButton>
                <div className="sm:col-span-4"><MsgLine msg={price.msg} testId={`wh-material-price-msg-${m.code}`} /></div>
              </form>
            ) : <p className="m-0 text-[12.5px] text-[#5B6478]">A warehouse admin sets the price per unit.</p>}
            {s.can_manage && (
              <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => {
                e.preventDefault();
                edit.run(() => saveMaterialAction({ warehouse: s.warehouse_code, id: m.id, code: m.code, name: m.name, kind: m.kind, unit: m.unit, boxId: m.box_id, lowStockAt: low, autoDgMark: m.auto_dg_mark, active: m.active }));
              }}>
                <DsInput id={`wh-low-${m.id}`} label="Low-stock alert at" inputMode="numeric" value={low} onChange={(e) => setLow(digits(e.target.value))} hint="Empty = no alert" />
                <DsButton type="submit" variant="secondary" disabled={edit.pending}>Save alert</DsButton>
                <DsButton variant="link" disabled={edit.pending} onClick={() => edit.run(() => saveMaterialAction({ warehouse: s.warehouse_code, id: m.id, code: m.code, name: m.name, kind: m.kind, unit: m.unit, boxId: m.box_id, lowStockAt: low, autoDgMark: m.auto_dg_mark, active: !m.active }))}>
                  {m.active ? 'Stop using' : 'Use again'}
                </DsButton>
                <div className="sm:col-span-4"><MsgLine msg={edit.msg} testId={`wh-material-edit-msg-${m.code}`} /></div>
              </form>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

export function MaterialsClient({ station: s }: { station: MaterialStation }) {
  const add = useRun();
  const empty = { code: '', name: '', kind: 'tape' as MaterialKind, unit: 'each' as MaterialUnit, boxId: '', low: '', dg: false };
  const [f, setF] = useState(empty);
  const lowCount = s.materials.filter((m) => m.active && m.low).length;
  return (
    <div className="flex flex-col gap-4">
      <DsCard title={`${s.name} materials`} icon="tag" testId={`wh-materials-${s.warehouse_code}`}
        subtitle={s.materials.length === 0 ? 'No materials yet. Nothing is taken from stock until a material is set up.'
          : `${s.materials.filter((m) => m.active).length} in use${lowCount ? ` · ${lowCount} low on stock` : ''}`}>
        {s.materials.length > 0 && <ul className="m-0 p-0 list-none flex flex-col gap-3">{s.materials.map((m) => <MaterialRow key={m.id} m={m} s={s} />)}</ul>}
        {s.can_manage ? (
          <form className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end" data-testid="wh-material-form"
            onSubmit={(e) => { e.preventDefault(); add.run(() => saveMaterialAction({ warehouse: s.warehouse_code, id: null, code: f.code, name: f.name, kind: f.kind, unit: f.unit, boxId: f.boxId || null, lowStockAt: f.low, autoDgMark: f.dg, active: true }), () => setF(empty)); }}>
            <DsInput label="Material code" value={f.code} onChange={(e) => setF({ ...f, code: upper(e.target.value) })} placeholder="TAPE-48" />
            <DsInput label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} containerClassName="col-span-2 sm:col-span-2" />
            <DsSelect label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MaterialKind, boxId: '', dg: false })}>
              {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{MATERIAL_KIND_LABEL[k]}</option>)}
            </DsSelect>
            <DsSelect label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as MaterialUnit })}>
              {MATERIAL_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </DsSelect>
            <DsInput label="Low-stock alert at" inputMode="numeric" value={f.low} onChange={(e) => setF({ ...f, low: digits(e.target.value) })} />
            {(f.kind === 'box' || f.kind === 'mailer') && (
              <DsSelect label="Packing box it stands for" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })} containerClassName="col-span-2 sm:col-span-3"
                hint={s.boxes_without_material.length ? 'Each parcel closed in this box takes one from stock.' : 'Every packing box here is already stocked (boxes are added under Station settings on the packing station).'}>
                <option value="">No packing box</option>
                {s.boxes_without_material.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </DsSelect>
            )}
            {f.kind === 'mark' && (
              <div className="col-span-2 sm:col-span-3">
                <DsCheckbox label="Use one automatically for every parcel with the battery mark" checked={f.dg} onChange={(e) => setF({ ...f, dg: e.target.checked })} />
              </div>
            )}
            <div className="col-span-2 sm:col-span-6"><DsButton type="submit" variant="secondary" icon="plus" disabled={add.pending || !f.code || !f.name.trim()} testId="wh-material-submit">Add material</DsButton></div>
            <div className="col-span-2 sm:col-span-6"><MsgLine msg={add.msg} testId="wh-material-msg" /></div>
          </form>
        ) : <p className="mt-3 mb-0 text-[13px] text-[#5B6478]">Supervisors and admins set up materials; receivers receive them.</p>}
      </DsCard>
      {s.moves.length > 0 && (
        <DsCard title="Recent movements" icon="activity" noPadding testId={`wh-material-moves-${s.warehouse_code}`}>
          <div className="overflow-x-auto" role="region" aria-label="Recent material movements" tabIndex={0}>
            <table className="ds-tbl" style={{ minWidth: 720 }}>
              <thead><tr><th scope="col">When</th><th scope="col">Material</th><th scope="col">Movement</th><th scope="col">Change</th><th scope="col">After</th><th scope="col">Order / reason</th><th scope="col">By</th></tr></thead>
              <tbody>
                {s.moves.map((v, i) => (
                  <tr key={i}>
                    <td>{fmtWh(v.at)}</td><td className="font-mono">{v.material}</td><td>{MOVE_LABEL[v.kind] ?? v.kind}</td>
                    <td>{v.delta > 0 ? '+' : ''}{v.delta}</td><td>{v.balance_after}</td>
                    <td>{v.order_code ? <span className="font-mono">{v.order_code}</span> : null}{v.reason ? <div className="text-[12px] text-[#5B6478]">{v.reason}</div> : null}</td>
                    <td>{v.by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DsCard>
      )}
    </div>
  );
}
