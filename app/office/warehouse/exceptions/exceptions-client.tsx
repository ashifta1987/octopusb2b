'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import {
  ACTION_HINT, ACTION_LABEL, EXCEPTION_KINDS, EXCEPTION_KIND_LABEL, EXCEPTION_STATUS, MANUAL_KINDS, ageText,
  type ExceptionAction, type ExceptionKind, type ExceptionRow, type ExceptionsBoard,
} from '@/lib/warehouse-w3b';
import { OrderStatusBadge } from '../orders/order-bits';
import { assignExceptionAction, raiseExceptionAction, resolveExceptionItemAction } from '../w3b-actions';
import { MsgLine, useRun } from '../wh-run';

const CHIP = 'inline-flex items-center px-3 min-h-[44px] rounded-full border text-[13.5px] font-semibold no-underline';
const chip = (on: boolean) => `${CHIP} ${on ? 'bg-[#1A174A] border-[#1A174A] text-white hover:text-white' : 'bg-white border-[#C9D0DD] text-[#1A174A] hover:bg-[#F2F7FE]'}`;
const href = (status: string, kind: string | null) => `/office/warehouse/exceptions?status=${status}${kind ? `&kind=${kind}` : ''}`;

function Resolve({ e, board }: { e: ExceptionRow; board: ExceptionsBoard }) {
  const asg = useRun();
  const res = useRun();
  const [owner, setOwner] = useState(e.owner_id ?? '');
  const [action, setAction] = useState<ExceptionAction>(e.actions[0] ?? 'close');
  const [text, setText] = useState('');
  const [qty, setQty] = useState(e.lot ? String(e.lot.qty) : '');
  const people = board.people.filter((p) => p.warehouse_code === e.warehouse_code);
  const adminOnly = action === 'unlock_override' && !e.can_unlock;
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-[#EEF0F4] pt-3">
      <form className="flex flex-wrap gap-2 items-end" onSubmit={(ev) => { ev.preventDefault(); asg.run(() => assignExceptionAction(e.id, owner || null)); }}>
        <DsSelect id={`wh-exc-owner-${e.code}`} label="Owner" value={owner} onChange={(ev) => setOwner(ev.target.value)} containerClassName="flex-1 min-w-[200px]">
          <option value="">Me</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </DsSelect>
        <DsButton type="submit" variant="secondary" icon="user" disabled={asg.pending} testId={`wh-exc-assign-${e.code}`}>Assign</DsButton>
        <div className="w-full"><MsgLine msg={asg.msg} testId={`wh-exc-assign-msg-${e.code}`} /></div>
      </form>
      <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        onSubmit={(ev) => { ev.preventDefault(); res.run(() => resolveExceptionItemAction({ exceptionId: e.id, action, resolution: text, qty })); }}>
        <DsSelect id={`wh-exc-action-${e.code}`} label="Release" value={action} onChange={(ev) => setAction(ev.target.value as ExceptionAction)} hint={ACTION_HINT[action]}>
          {e.actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </DsSelect>
        {action === 'approve_lot' && (
          <DsInput id={`wh-exc-qty-${e.code}`} label={`Approved quantity (up to ${e.lot?.max ?? '?'})`} inputMode="numeric" value={qty} onChange={(ev) => setQty(ev.target.value.replace(/\D/g, ''))} />
        )}
        <DsTextarea id={`wh-exc-res-${e.code}`} label="Resolution" value={text} onChange={(ev) => setText(ev.target.value)} maxLength={1000} rows={2}
          containerClassName={action === 'approve_lot' ? '' : 'sm:col-span-2'} placeholder="What was found and what was done" />
        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
          <DsButton type="submit" icon="check" disabled={res.pending || text.trim().length < 3 || adminOnly}
            disabledReason={adminOnly ? 'A warehouse admin unlocks weight overrides.' : text.trim().length < 3 ? 'Write the resolution first.' : undefined} testId={`wh-exc-resolve-${e.code}`}>
            Resolve
          </DsButton>
        </div>
        <div className="sm:col-span-3"><MsgLine msg={res.msg} testId={`wh-exc-resolve-msg-${e.code}`} /></div>
      </form>
    </div>
  );
}

function Row({ e, board }: { e: ExceptionRow; board: ExceptionsBoard }) {
  const [label, tone] = EXCEPTION_STATUS[e.status] ?? [e.status, 'neutral'];
  return (
    <li className="rounded-[12px] border border-[#E3E7EF] bg-white p-4" data-testid={`wh-exc-${e.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{e.code}</span>
        <DsBadge tone={e.kind === 'weight' || e.kind === 'short_pick' ? 'bad' : 'warn'} icon="alert">{EXCEPTION_KIND_LABEL[e.kind]}</DsBadge>
        <DsBadge tone={tone} testId={`wh-exc-status-${e.code}`}>{label}</DsBadge>
        {e.held && <DsBadge tone="bad" icon="lock">Holding {e.order ? 'the order' : 'the lot'}</DsBadge>}
        <span className="ml-auto text-[12.5px] text-[#5B6478]">{e.status === 'resolved' ? `Resolved ${fmtWh(e.resolved_at)}` : `Open ${ageText(e.created_at)}`} · {e.warehouse_code}</span>
      </div>
      <p className="mt-2 mb-0 text-[14px]">{e.title}</p>
      <p className="mt-1 mb-0 text-[13px] text-[#5B6478] flex flex-wrap items-center gap-x-3 gap-y-1">
        {e.order && <span>Order <Link href={`/office/warehouse/orders/${e.order.code}`} className="font-mono font-semibold text-[#2559B8] underline">{e.order.code}</Link> <OrderStatusBadge status={e.order.status} /></span>}
        {e.parcel_seq != null && <span>Parcel {e.parcel_seq}</span>}
        {e.asn && <span>Notice <span className="font-mono">{e.asn}</span></span>}
        {e.lot && <span>Lot <span className="font-mono">{e.lot.code}</span> · {e.lot.qty} counted</span>}
        {e.client && <span>Client: {e.client}</span>}
        <span>{e.source === 'auto' ? 'Raised automatically' : `Reported by ${e.raised_by_name ?? 'staff'}`}</span>
        {e.owner_name && <span data-testid={`wh-exc-owner-name-${e.code}`}>Owner: {e.owner_name}</span>}
      </p>
      {e.status === 'resolved' && (
        <p className="mt-2 mb-0 text-[13.5px]" data-testid={`wh-exc-resolution-${e.code}`}>
          <strong>Resolution:</strong> {e.resolution}{e.resolution_action ? ` (${ACTION_LABEL[e.resolution_action as ExceptionAction] ?? e.resolution_action})` : ''}{e.resolved_by_name ? ` — ${e.resolved_by_name}` : ''}
        </p>
      )}
      {e.status !== 'resolved' && (e.can_resolve ? <Resolve e={e} board={board} />
        : <p className="mt-2 mb-0 text-[12.5px] text-[#5B6478]">A supervisor or admin assigns and resolves exceptions.</p>)}
    </li>
  );
}

function Raise({ board }: { board: ExceptionsBoard }) {
  const { pending, msg, run } = useRun();
  const empty = { warehouse: board.can_raise[0] ?? '', kind: 'label' as ExceptionKind, title: '', orderCode: '', asnCode: '' };
  const [f, setF] = useState(empty);
  if (!board.can_raise.length) return null;
  return (
    <DsCard title="Report a problem" icon="flag" testId="wh-exc-raise">
      <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={(ev) => { ev.preventDefault(); run(() => raiseExceptionAction(f), () => setF({ ...empty, warehouse: f.warehouse })); }}>
        {board.can_raise.length > 1 && (
          <DsSelect label="Warehouse" value={f.warehouse} onChange={(ev) => setF({ ...f, warehouse: ev.target.value })}>
            {board.can_raise.map((w) => <option key={w} value={w}>{w}</option>)}
          </DsSelect>
        )}
        <DsSelect label="Kind" value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value as ExceptionKind })}>
          {MANUAL_KINDS.map((k) => <option key={k} value={k}>{EXCEPTION_KIND_LABEL[k]}</option>)}
        </DsSelect>
        <DsInput label="Order (optional)" value={f.orderCode} onChange={(ev) => setF({ ...f, orderCode: ev.target.value.toUpperCase() })} placeholder="WO-000123" />
        <DsInput label="Notice (optional)" value={f.asnCode} onChange={(ev) => setF({ ...f, asnCode: ev.target.value.toUpperCase() })} placeholder="ASN-0001" />
        <DsTextarea label="What is wrong" value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} maxLength={600} rows={2} containerClassName="sm:col-span-4" />
        <div className="sm:col-span-4 flex flex-wrap items-center gap-3">
          <DsButton type="submit" variant="secondary" icon="flag" disabled={pending || f.title.trim().length < 3} testId="wh-exc-raise-submit">Report</DsButton>
          <span className="text-[12.5px] text-[#5B6478]">Short picks are reported on the picking screen; blocked lots and locked overrides appear here by themselves.</span>
        </div>
        <div className="sm:col-span-4"><MsgLine msg={msg} testId="wh-exc-raise-msg" /></div>
      </form>
    </DsCard>
  );
}

export function ExceptionsClient({ board, status, kind }: { board: ExceptionsBoard; status: string; kind: ExceptionKind | null }) {
  const open = Object.values(board.counts).reduce((n, x) => n + (x ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Exception filters" className="flex flex-wrap gap-2" data-testid="wh-exc-filters">
        {[['open', `Open (${open})`], ['resolved', 'Resolved'], ['all', 'All']].map(([s, l]) => (
          <Link key={s} href={href(s, kind)} aria-current={status === s ? 'page' : undefined}
            className={chip(status === s)}>{l}</Link>
        ))}
        <span className="w-px bg-[#E3E7EF] mx-1" aria-hidden="true" />
        <Link href={href(status, null)} aria-current={kind === null ? 'page' : undefined} className={chip(kind === null)}>Every kind</Link>
        {EXCEPTION_KINDS.map((k) => (
          <Link key={k} href={href(status, k)} aria-current={kind === k ? 'page' : undefined}
            className={chip(kind === k)}>
            {EXCEPTION_KIND_LABEL[k]}{board.counts[k] ? ` (${board.counts[k]})` : ''}
          </Link>
        ))}
      </nav>
      {board.exceptions.length === 0 ? (
        <DsEmptyState icon="check" title={status === 'open' ? 'No open exceptions' : 'Nothing here'} description="Short picks, locked weight overrides and blocked lots appear here automatically." testId="wh-exc-empty" />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3" data-testid="wh-exc-list">{board.exceptions.map((e) => <Row key={e.id} e={e} board={board} />)}</ul>
      )}
      <Raise board={board} />
    </div>
  );
}
