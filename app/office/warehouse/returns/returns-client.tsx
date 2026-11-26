'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { createClient } from '@/lib/supabase/client';
import { usd } from '@/lib/format';
import { fmtWh } from '@/lib/warehouse-inbound';
import {
  CONDITIONS, CONDITION_LABEL, DECISION_STAFF, RETURN_PHOTO_MAX_BYTES, RETURN_STATUS_STAFF, decisionOutcome, returnPhotoPath, sendBackText,
  type Condition, type ReturnRow, type ReturnsBoard,
} from '@/lib/warehouse-w5';
import { addReturnPhotoAction, applyReturnDefaultAction, completeReturnAction, inspectReturnAction, registerReturnAction } from '../w5-actions';
import { MsgLine, useRun } from '../wh-run';

const CHIP = 'inline-flex items-center px-3 min-h-[44px] rounded-full border text-[13.5px] font-semibold no-underline';
const chip = (on: boolean) => `${CHIP} ${on ? 'bg-[#1A174A] border-[#1A174A] text-white hover:text-white' : 'bg-white border-[#C9D0DD] text-[#1A174A] hover:bg-[#F2F7FE]'}`;

function Register({ board }: { board: ReturnsBoard }) {
  const reg = useRun();
  const whs = board.warehouses.filter((w) => board.can_returns.includes(w.code));
  const [org, setOrg] = useState('');
  const [wh, setWh] = useState(whs[0]?.code ?? '');
  const [order, setOrder] = useState('');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ skuId: string; qty: string }[]>([{ skuId: '', qty: '1' }]);
  const skus = board.skus.filter((k) => k.org_id === org);
  const filled = lines.filter((l) => l.skuId);
  const why = !org ? 'Choose the client' : !wh ? 'Choose the warehouse' : filled.length === 0 ? 'Add at least one product'
    : filled.some((l) => !(Number(l.qty) > 0)) ? 'Enter the units for every product' : new Set(filled.map((l) => l.skuId)).size !== filled.length ? 'Each product goes on one line' : null;
  const setLine = (i: number, p: Partial<{ skuId: string; qty: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <DsCard title="Register a return" icon="download" testId="wh-rt-register" subtitle="A returned parcel arrived: record whose it is and what is inside. Photos and grading come next.">
      <form className="flex flex-col gap-3" onSubmit={(e) => {
        e.preventDefault();
        if (why) return;
        reg.run(() => registerReturnAction({ orgId: org, warehouse: wh, orderCode: order, carrierRef: ref, reason, lines }), () => {
          setOrder(''); setRef(''); setReason(''); setLines([{ skuId: '', qty: '1' }]);
        });
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <DsSelect id="wh-rt-client" label="Client" value={org} onChange={(e) => { setOrg(e.target.value); setLines([{ skuId: '', qty: '1' }]); }}>
            <option value="">Choose a client</option>
            {board.clients.map((c) => <option key={c.org_id} value={c.org_id}>{c.name}</option>)}
          </DsSelect>
          <DsSelect id="wh-rt-wh" label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)}>
            {whs.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </DsSelect>
          <DsInput id="wh-rt-order" label="Original order (optional)" placeholder="WO-000123" value={order} onChange={(e) => setOrder(e.target.value)} maxLength={20} autoComplete="off" />
          <DsInput id="wh-rt-ref" label="Return tracking number (optional)" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={64} autoComplete="off" />
          <DsInput id="wh-rt-reason" label="Reason given (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} containerClassName="sm:col-span-2 lg:col-span-4" autoComplete="off" />
        </div>
        <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
          <legend className="ds-label">Products in the parcel</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2 items-end" data-testid={`wh-rt-line-${i}`}>
              <DsSelect id={`wh-rt-sku-${i}`} label={`Product ${i + 1}`} value={l.skuId} onChange={(e) => setLine(i, { skuId: e.target.value })} disabled={!org}>
                <option value="">{org ? 'Choose a product' : 'Choose the client first'}</option>
                {skus.map((k) => <option key={k.id} value={k.id}>{k.sku} · {k.name}{k.status !== 'active' ? ' (archived)' : ''}</option>)}
              </DsSelect>
              <DsInput id={`wh-rt-qty-${i}`} label={`Units of product ${i + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} />
              <DsButton variant="secondary" icon="x" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove product ${i + 1}`}>Remove</DsButton>
            </div>
          ))}
          <div><DsButton variant="link" icon="plus" onClick={() => setLines((ls) => [...ls, { skuId: '', qty: '1' }])} disabled={lines.length >= 100}>Add a product</DsButton></div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <DsButton type="submit" icon="check" disabled={reg.pending || Boolean(why)} disabledReason={why ?? undefined} testId="wh-rt-register-submit">Register return</DsButton>
        </div>
        <MsgLine msg={reg.msg} testId="wh-rt-register-msg" />
      </form>
    </DsCard>
  );
}

function Inspect({ r }: { r: ReturnRow }) {
  const up = useRun();
  const ins = useRun();
  const [grades, setGrades] = useState<Record<string, Condition | ''>>(Object.fromEntries(r.lines.map((l) => [l.id, (CONDITIONS as readonly string[]).includes(l.condition) ? l.condition as Condition : ''])));
  const [note, setNote] = useState(r.condition_note ?? '');
  const ungraded = r.lines.some((l) => !grades[l.id]);
  const why = r.photos.length === 0 ? 'Add at least one photo first' : ungraded ? 'Grade every product' : null;
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-[#EEF0F4] pt-3">
      <div>
        <label htmlFor={`wh-rt-photo-${r.code}`} className="ds-label">Add a photo to {r.code}</label>
        <input id={`wh-rt-photo-${r.code}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="text-[14px] min-h-[44px]" disabled={up.pending}
          data-testid={`wh-rt-photo-input-${r.code}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > RETURN_PHOTO_MAX_BYTES) { up.setMsg({ ok: false, text: 'The photo is larger than 10 MB.' }); return; }
            const path = returnPhotoPath(r.warehouse_code, r.code, crypto.randomUUID(), file.type);
            if (!path) { up.setMsg({ ok: false, text: 'Use a JPG, PNG or WebP photo.' }); return; }
            up.run(async () => {
              const { error } = await createClient().storage.from('wh-returns').upload(path, file, { contentType: file.type, upsert: false });
              if (error) return { ok: false, error: `The photo could not be uploaded: ${error.message}` };
              return addReturnPhotoAction(r.id, path);
            });
          }} />
        <MsgLine msg={up.msg} testId={`wh-rt-photo-msg-${r.code}`} />
      </div>
      <form className="flex flex-col gap-3" onSubmit={(e) => {
        e.preventDefault();
        if (why) return;
        ins.run(() => inspectReturnAction({ returnId: r.id, lines: r.lines.map((l) => ({ lineId: l.id, condition: grades[l.id] ?? '' })), note }));
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {r.lines.map((l) => (
            <DsSelect key={l.id} id={`wh-rt-cond-${r.code}-${l.sku}`} label={`Condition of ${l.sku} (${l.qty} unit${l.qty === 1 ? '' : 's'})`} value={grades[l.id] ?? ''}
              onChange={(e) => setGrades((g) => ({ ...g, [l.id]: e.target.value as Condition }))}>
              <option value="">Choose</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </DsSelect>
          ))}
        </div>
        <DsTextarea id={`wh-rt-note-${r.code}`} label="Inspection notes (the client reads these)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2}
          placeholder="e.g. outer carton crushed, product unused" />
        <div className="flex flex-wrap items-center gap-3">
          <DsButton type="submit" icon="check" disabled={ins.pending || Boolean(why)} disabledReason={why ?? undefined} testId={`wh-rt-inspect-${r.code}`}>
            {r.status === 'inspected' ? 'Update inspection' : 'Finish inspection'}
          </DsButton>
        </div>
        <MsgLine msg={ins.msg} testId={`wh-rt-inspect-msg-${r.code}`} />
      </form>
    </div>
  );
}

function Complete({ r }: { r: ReturnRow }) {
  const run = useRun();
  const [note, setNote] = useState('');
  const label = r.decision === 'restock' ? 'Restock and finish' : r.decision === 'send_back' ? 'Create the send-back order' : 'Disposed of — finish';
  return (
    <form className="mt-3 flex flex-col gap-3 border-t border-[#EEF0F4] pt-3" onSubmit={(e) => { e.preventDefault(); run.run(() => completeReturnAction(r.id, note)); }}>
      <DsInput id={`wh-rt-done-note-${r.code}`} label="Note (optional, staff only)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoComplete="off" />
      <div><DsButton type="submit" icon="check" disabled={run.pending} testId={`wh-rt-complete-${r.code}`}>{label}</DsButton></div>
      <MsgLine msg={run.msg} testId={`wh-rt-complete-msg-${r.code}`} />
    </form>
  );
}

function ApplyDefault({ r }: { r: ReturnRow }) {
  const run = useRun();
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF0F4] pt-3">
      <p className="m-0 text-[13px] text-[#5B6478]">The client did not decide by {fmtWh(r.decide_by)}. Default: restock the good units ({r.good_units}), dispose of the rest; with no good unit, discard.</p>
      <div><DsButton variant="secondary" icon="clock" disabled={run.pending} onClick={() => run.run(() => applyReturnDefaultAction(r.id))} testId={`wh-rt-default-${r.code}`}>Apply the default</DsButton></div>
      <MsgLine msg={run.msg} testId={`wh-rt-default-msg-${r.code}`} />
    </div>
  );
}

function Row({ r, board, focus }: { r: ReturnRow; board: ReturnsBoard; focus: boolean }) {
  const [label, tone] = RETURN_STATUS_STAFF[r.status] ?? [r.status, 'neutral'];
  const can = board.can_returns.includes(r.warehouse_code);
  return (
    <li id={r.code} className={`rounded-[12px] border bg-white p-4 ${focus ? 'border-[#2A6FD1] shadow-[0_0_0_2px_#D6E4FA]' : 'border-[#E3E7EF]'}`} data-testid={`wh-rt-${r.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{r.code}</span>
        <DsBadge tone={tone} testId={`wh-rt-status-${r.code}`}>{label}</DsBadge>
        {r.overdue && <DsBadge tone="bad" icon="clock">Decision overdue</DsBadge>}
        <span className="text-[13.5px] font-semibold">{r.owner}</span>
        <span className="ml-auto text-[12.5px] text-[#5B6478]">{r.warehouse_code} · received {fmtWh(r.created_at)}{r.received_by_name ? ` by ${r.received_by_name}` : ''}</span>
      </div>
      <div className="mt-1 text-[13px] text-[#5B6478]">
        {r.order_code ? <>Order <Link href={`/office/warehouse/orders/${r.order_code}`} className="font-mono text-[#2559B8] hover:underline">{r.order_code}</Link></> : 'No original order'}
        {r.carrier_ref ? ` · tracking ${r.carrier_ref}` : ''}{r.reason ? ` · “${r.reason}”` : ''}
      </div>
      <ul className="mt-2 mb-0 pl-5 text-[13.5px]">
        {r.lines.map((l) => (
          <li key={l.id}><span className="font-mono">{l.sku}</span> · {l.name} × {l.qty} — <strong>{CONDITION_LABEL[l.condition] ?? l.condition}</strong>{l.lot_code ? ` · ${l.lot_code}` : ''}</li>
        ))}
      </ul>
      {r.photos.length > 0 && (
        <ul className="mt-2 mb-0 p-0 list-none flex flex-wrap gap-2" aria-label={`Photos of ${r.code}`} data-testid={`wh-rt-photos-${r.code}`}>
          {r.photos.map((p, i) => (
            <li key={p.path}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1} of ${r.code}`} className="w-[88px] h-[88px] object-cover rounded-[8px] border border-[#E3E7EF] block" />
                </a>
              ) : <span className="text-[12px] text-[#5B6478]">Photo unavailable</span>}
            </li>
          ))}
        </ul>
      )}
      {r.condition_note && <p className="mt-2 mb-0 text-[13px]"><span className="text-[#5B6478]">Notes for the client:</span> {r.condition_note}</p>}
      {r.status !== 'received' && (
        <p className="mt-2 mb-0 text-[13px] text-[#5B6478]">
          Inspected {fmtWh(r.inspected_at)}{r.inspected_by_name ? ` by ${r.inspected_by_name}` : ''} · client decides by {fmtWh(r.decide_by)}
          {' · '}{r.charge_cents != null && r.charge_per_item_cents != null ? `charge ${r.charge_units} × ${usd(r.charge_per_item_cents)} = ${usd(r.charge_cents)}` : 'returns rate not set for this client (no charge recorded)'}
        </p>
      )}
      {r.decision && (
        <p className="mt-2 mb-0 text-[14px]" data-testid={`wh-rt-decision-${r.code}`}>
          <strong>{DECISION_STAFF[r.decision]}</strong>{r.decision_source === 'default' ? ' (default after the date)' : ' (client)'} · {decisionOutcome(r)}
          {r.decision === 'send_back' && r.send_back_to ? <> · to {sendBackText(r)}</> : null}
        </p>
      )}
      {r.outbound_order && (
        <p className="mt-1 mb-0 text-[13px]">Send-back order <Link href={`/office/warehouse/orders/${r.outbound_order.code}`} className="font-mono text-[#2559B8] hover:underline">{r.outbound_order.code}</Link> · {r.outbound_order.status}</p>
      )}
      {r.status === 'done' && <p className="mt-1 mb-0 text-[12.5px] text-[#5B6478]">Done {fmtWh(r.done_at)}{r.done_by_name ? ` by ${r.done_by_name}` : ''}{r.done_note ? ` · ${r.done_note}` : ''}</p>}
      {can && (r.status === 'received' || r.status === 'inspected') && <Inspect r={r} />}
      {can && r.status === 'decided' && <Complete r={r} />}
      {r.overdue && board.can_default.includes(r.warehouse_code) && <ApplyDefault r={r} />}
    </li>
  );
}

export function ReturnsClient({ board, status, focus }: { board: ReturnsBoard; status: string; focus: string }) {
  const c = board.counts;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([['To inspect', c.received], ['Waiting for the client', c.inspected], ['To carry out', c.decided], ['Decision overdue', c.overdue]] as const).map(([k, v]) => (
          <div key={k} className="ds-card" data-testid={`wh-rt-count-${k.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-[#5B6478]">{k}</div>
            <div className="text-[28px] font-bold leading-tight">{v}</div>
          </div>
        ))}
      </div>
      {board.can_returns.length > 0 ? <Register board={board} /> : (
        <p className="m-0 text-[13.5px] text-[#5B6478]">Receivers, supervisors and warehouse admins register and inspect returns.</p>
      )}
      <nav aria-label="Return filters" className="flex flex-wrap gap-2">
        {[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([s, l]) => (
          <Link key={s} href={`/office/warehouse/returns?status=${s}`} aria-current={status === s ? 'page' : undefined} className={chip(status === s)}>{l}</Link>
        ))}
      </nav>
      {board.returns.length === 0 ? (
        <DsEmptyState icon="refresh" title={status === 'done' ? 'No finished returns' : 'No open returns'} description="Registered returns appear here with their photos, grading and the client's decision." testId="wh-rt-empty" />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3" data-testid="wh-rt-list">
          {board.returns.map((r) => <Row key={r.id} r={r} board={board} focus={focus === r.code} />)}
        </ul>
      )}
    </>
  );
}
