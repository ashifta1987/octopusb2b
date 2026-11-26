'use client';

import { useMemo, useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { BIN_CODE, BIN_STATUS, binRange } from '@/lib/warehouse-putaway';
import { createBinAction, createBinRangeAction, setBinStatusAction } from '../../putaway-actions';
import { MsgLine, useRun } from '../../wh-run';

export type BinAdminRow = {
  id: string; code: string; warehouse_code: string; zone: string | null; status: string; block_reason: string | null; created_at: string; units: number | null;
};
type Place = { code: string; name: string };
const digits = (s: string) => s.replace(/\D/g, '').slice(0, 2);
const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');

function RangeForm({ places }: { places: Place[] }) {
  const { pending, msg, run } = useRun();
  const [wh, setWh] = useState(places[0]?.code ?? '');
  const [rack, setRack] = useState('');
  const [rowFrom, setRowFrom] = useState('1');
  const [rowTo, setRowTo] = useState('5');
  const [binFrom, setBinFrom] = useState('1');
  const [binTo, setBinTo] = useState('10');
  const [zone, setZone] = useState('');
  const codes = binRange(rack, Number(rowFrom), Number(rowTo), Number(binFrom), Number(binTo));
  const why = !rack ? 'Enter the rack' : codes.length === 0 ? 'Rows and bins run from 1 to 99, first to last' : codes.length > 500 ? `Up to 500 bins at a time (this range has ${codes.length})` : undefined;
  return (
    <form className="flex flex-col gap-3" data-testid="wh-bin-range-form"
      onSubmit={(e) => { e.preventDefault(); if (!why) run(() => createBinRangeAction({ warehouse: wh, rack, rowFrom: Number(rowFrom), rowTo: Number(rowTo), binFrom: Number(binFrom), binTo: Number(binTo), zone })); }}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {places.length > 1 && (
          <DsSelect label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)} containerClassName="col-span-2 sm:col-span-3">
            {places.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </DsSelect>
        )}
        <DsInput label="Rack" placeholder="A" value={rack} maxLength={5} autoCapitalize="characters" onChange={(e) => setRack(upper(e.target.value))} />
        <DsInput label="Zone (optional)" placeholder="Fast movers" value={zone} maxLength={30} onChange={(e) => setZone(e.target.value)} containerClassName="sm:col-span-2" />
        <DsInput label="Rows from" inputMode="numeric" value={rowFrom} onChange={(e) => setRowFrom(digits(e.target.value))} />
        <DsInput label="Rows to" inputMode="numeric" value={rowTo} onChange={(e) => setRowTo(digits(e.target.value))} />
        <span className="hidden sm:block" aria-hidden="true" />
        <DsInput label="Bins from" inputMode="numeric" value={binFrom} onChange={(e) => setBinFrom(digits(e.target.value))} />
        <DsInput label="Bins to" inputMode="numeric" value={binTo} onChange={(e) => setBinTo(digits(e.target.value))} />
      </div>
      <p className="m-0 text-[13px] text-muted" data-testid="wh-bin-range-preview" aria-live="polite">
        {codes.length ? `${codes.length} bin(s): ${codes[0]} … ${codes[codes.length - 1]}. Bins that already exist are skipped.` : 'Enter a rack, rows and bins to see the codes.'}
      </p>
      <div><DsButton type="submit" icon="plus" disabled={pending || Boolean(why)} disabledReason={why} testId="wh-bin-range-submit">Create bins</DsButton></div>
      <MsgLine msg={msg} testId="wh-bin-range-msg" />
    </form>
  );
}

function SingleForm({ places }: { places: Place[] }) {
  const { pending, msg, run } = useRun();
  const [wh, setWh] = useState(places[0]?.code ?? '');
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('');
  const why = !BIN_CODE.test(code) ? 'Use rack-row-bin, e.g. A-01-03' : undefined;
  return (
    <form className="flex flex-col gap-3" data-testid="wh-bin-single-form" onSubmit={(e) => { e.preventDefault(); if (!why) run(() => createBinAction(wh, code, zone), () => setCode('')); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {places.length > 1 && (
          <DsSelect label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)} containerClassName="sm:col-span-2">
            {places.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </DsSelect>
        )}
        <DsInput label="Bin code" placeholder="A-01-03" value={code} autoCapitalize="characters" onChange={(e) => setCode(upper(e.target.value))} />
        <DsInput label="Zone (optional)" value={zone} maxLength={30} onChange={(e) => setZone(e.target.value)} />
      </div>
      <div><DsButton type="submit" variant="secondary" disabled={pending || Boolean(why)} disabledReason={code ? why : undefined} testId="wh-bin-single-submit">Add bin</DsButton></div>
      <MsgLine msg={msg} testId="wh-bin-single-msg" />
    </form>
  );
}

function BinItem({ b, can, whName }: { b: BinAdminRow; can: boolean; whName: string | null }) {
  const { pending, msg, run } = useRun();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [label, tone] = BIN_STATUS[b.status] ?? [b.status, 'neutral'];
  return (
    <li className="border-b border-divider last:border-0 px-5 py-3 flex flex-col gap-2" data-testid={`wh-bin-${b.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono font-semibold">{b.code}</span>
          <span className="text-[12.5px] text-muted">{whName ? ` · ${whName}` : ''}{b.zone ? ` · ${b.zone}` : ''} · {b.units ? `${b.units} unit(s)` : 'empty'}</span>
          {b.block_reason && <div className="text-[12.5px] text-muted">Blocked: {b.block_reason}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DsBadge tone={tone}>{label}</DsBadge>
          {can && b.status === 'active' && <DsButton variant="link" onClick={() => setBlocking((v) => !v)} aria-expanded={blocking} testId="wh-bin-block-toggle">Block</DsButton>}
          {can && b.status !== 'active' && <DsButton variant="link" disabled={pending} onClick={() => run(() => setBinStatusAction(b.id, 'active', ''))} testId="wh-bin-activate">{b.status === 'blocked' ? 'Unblock' : 'Restore'}</DsButton>}
          {can && b.status !== 'archived' && (
            <DsButton variant="link" disabled={pending || Boolean(b.units)} disabledReason={b.units ? 'Empty the bin first' : undefined}
              onClick={() => run(() => setBinStatusAction(b.id, 'archived', ''))} testId="wh-bin-archive">Archive</DsButton>
          )}
        </div>
      </div>
      {blocking && (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => setBinStatusAction(b.id, 'blocked', reason), () => { setBlocking(false); setReason(''); }); }}>
          <DsInput label="Why is it blocked?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} containerClassName="min-w-[220px] flex-1" />
          <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} testId="wh-bin-block">Block bin</DsButton>
        </form>
      )}
      <MsgLine msg={msg} testId="wh-bin-msg" />
    </li>
  );
}

export function BinsClient({ rows, manageable, warehouseNames }: { rows: BinAdminRow[]; manageable: Place[]; warehouseNames: Record<string, string> }) {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('live');
  const can = new Set(manageable.map((p) => p.code));
  const multi = new Set(rows.map((r) => r.warehouse_code)).size > 1;
  const shown = useMemo(() => rows.filter((r) => (status === 'live' ? r.status !== 'archived' : r.status === status) && (!filter || r.code.includes(filter.toUpperCase()))), [rows, filter, status]);
  return (
    <div className="flex flex-col gap-5">
      {manageable.length === 0 ? (
        <DsCard><p className="m-0 text-[13.5px] text-muted" data-testid="wh-bins-readonly">Only receivers, supervisors and admins create or change bins.</p></DsCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <DsCard title="Create a range" icon="grid" testId="wh-bin-range" subtitle="Rack A, rows 1–5, bins 1–10 makes A-01-01 to A-05-10."><RangeForm places={manageable} /></DsCard>
          <DsCard title="Add one bin" icon="plus" testId="wh-bin-single"><SingleForm places={manageable} /></DsCard>
        </div>
      )}
      <DsCard title={`Bins (${rows.filter((r) => r.status !== 'archived').length})`} icon="list" noPadding testId="wh-bin-list">
        <div className="px-5 py-3 flex flex-wrap gap-3 border-b border-divider">
          <DsInput label="Find a bin" value={filter} onChange={(e) => setFilter(e.target.value)} containerClassName="w-[180px]" placeholder="A-01" />
          <DsSelect label="Show" value={status} onChange={(e) => setStatus(e.target.value)} containerClassName="w-[180px]">
            <option value="live">Active and blocked</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="archived">Archived</option>
          </DsSelect>
        </div>
        {shown.length === 0 ? (
          <div className="px-5 py-4"><DsEmptyState icon="grid" title="No bins" description={rows.length ? 'No bin matches this filter.' : 'Create a range of bins to start putting stock away.'} /></div>
        ) : (
          <ul className="list-none m-0 p-0">
            {shown.slice(0, 500).map((b) => <BinItem key={b.id} b={b} can={can.has(b.warehouse_code)} whName={multi ? warehouseNames[b.warehouse_code] ?? b.warehouse_code : null} />)}
          </ul>
        )}
        {shown.length > 500 && <p className="m-0 px-5 py-3 text-[12px] text-muted">Showing the first 500 of {shown.length}. Use Find a bin to narrow down.</p>}
      </DsCard>
    </div>
  );
}
