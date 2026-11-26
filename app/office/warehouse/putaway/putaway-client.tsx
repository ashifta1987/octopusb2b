'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtWh, itemText } from '@/lib/warehouse-inbound';
import { BIN_STATUS, MOVE_KIND, PALLET_STATUS, SOURCE_TEXT, type BinContent, type PalletRow, type PutawayBoard, type UnplacedLot } from '@/lib/warehouse-putaway';
import { createPalletAction, moveStockAction, movePalletAction, putawayAction } from '../putaway-actions';
import { MsgLine, useRun } from '../wh-run';

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const digits = (s: string) => s.replace(/\D/g, '');

/** Lots grouped by source (notice / transfer) and owner, as on board 10. */
function groupLots(lots: UnplacedLot[]) {
  const m = new Map<string, { key: string; owner: string; source: string; ref: string | null; lots: UnplacedLot[] }>();
  for (const l of lots) {
    const key = `${l.source_ref ?? 'none'}|${l.owner ?? ''}`;
    if (!m.has(key)) m.set(key, { key, owner: l.owner ?? 'Unknown owner', source: l.source ? SOURCE_TEXT[l.source] ?? l.source : 'No source', ref: l.source_ref, lots: [] });
    m.get(key)!.lots.push(l);
  }
  return [...m.values()];
}

function PutawayForm({ board, lotId, setLotId, canAt }: { board: PutawayBoard; lotId: string; setLotId: (v: string) => void; canAt: (wh: string) => boolean }) {
  const { pending, msg, run } = useRun();
  const usable = board.unplaced.filter((l) => canAt(l.warehouse_code));
  const lot = usable.find((l) => l.lot_id === lotId) ?? null;
  const [scan, setScan] = useState('');
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState('');
  const [pallet, setPallet] = useState('');
  const pallets = board.pallets.filter((p) => lot && p.warehouse_code === lot.warehouse_code && (p.org_id ?? '') === (lot.org_id ?? ''));
  const qtyNum = qty === '' ? lot?.free ?? 0 : Number(qty);
  const why = !lot ? 'Choose or scan a lot' : !bin.trim() ? 'Scan or type the bin' : !(qtyNum > 0) ? 'Enter the units'
    : qtyNum > lot.free ? `Only ${lot.free} unit(s) left to put away` : undefined;
  if (usable.length === 0) {
    return <DsEmptyState icon="box" title="Nothing to put away" description="Released lots appear here after receiving or a transfer. Receivers, supervisors and admins put stock away." testId="wh-putaway-empty" />;
  }
  return (
    <form className="flex flex-col gap-3" data-testid="wh-putaway-form"
      onSubmit={(e) => { e.preventDefault(); if (!why && lot) run(() => putawayAction({ lotId: lot.lot_id, warehouse: lot.warehouse_code, bin, qty: qtyNum, pallet }), () => { setBin(''); setQty(''); setScan(''); }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DsInput label="Scan lot" placeholder="LOT-00012" value={scan} autoCapitalize="characters" autoComplete="off"
          onChange={(e) => {
            const v = upper(e.target.value); setScan(v);
            const hit = usable.find((l) => l.lot_code === v);
            if (hit) { setLotId(hit.lot_id); setQty(''); setPallet(''); }
          }}
          hint={scan && !usable.some((l) => l.lot_code === scan) ? 'No lot with this code is waiting for putaway here.' : undefined} />
        <DsSelect label="Lot" value={lotId} onChange={(e) => { setLotId(e.target.value); setQty(''); setPallet(''); }}>
          <option value="">Choose a lot</option>
          {usable.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_code} · {itemText(l.item)} · {l.free} left</option>)}
        </DsSelect>
        <DsInput label="Bin" placeholder="A-01-03" value={bin} autoCapitalize="characters" autoComplete="off" onChange={(e) => setBin(upper(e.target.value))} />
        <DsInput label="Units" inputMode="numeric" value={qty} placeholder={lot ? String(lot.free) : ''} onChange={(e) => setQty(digits(e.target.value))}
          hint={lot ? `Leave empty to put away all ${lot.free}` : undefined} />
        <DsSelect label="Pallet (optional)" value={pallet} onChange={(e) => setPallet(e.target.value)} disabled={!lot}
          hint={lot ? 'Only pallets of the same owner at this warehouse' : undefined}>
          <option value="">Loose (no pallet)</option>
          {pallets.map((p) => <option key={p.id} value={p.code}>{p.code}{p.bin_code ? ` · in ${p.bin_code}` : ' · open'}</option>)}
        </DsSelect>
      </div>
      {lot && <p className="m-0 text-[13px] text-[#5B6478]" data-testid="wh-putaway-lot">{itemText(lot.item)} · {lot.owner} · {lot.free} of {lot.qty} left to put away</p>}
      <div><DsButton type="submit" disabled={pending || Boolean(why)} disabledReason={why} testId="wh-putaway-submit" icon="check">Put away</DsButton></div>
      <MsgLine msg={msg} testId="wh-putaway-msg" />
    </form>
  );
}

function NewPallet({ board, current, warehouseNames }: { board: PutawayBoard; current: string | null; warehouseNames: Record<string, string> }) {
  const { pending, msg, run } = useRun();
  const places = board.can_putaway;
  const [wh, setWh] = useState(current && places.includes(current) ? current : places[0] ?? '');
  const [asn, setAsn] = useState('');
  const [org, setOrg] = useState('');
  const [note, setNote] = useState('');
  if (places.length === 0) return <p className="m-0 text-[13px] text-[#5B6478]">Only receivers, supervisors and admins build pallets.</p>;
  return (
    <form className="flex flex-col gap-3" data-testid="wh-pallet-form" onSubmit={(e) => { e.preventDefault(); run(() => createPalletAction(wh, asn, org, note), () => setNote('')); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {places.length > 1 && (
          <DsSelect label="Warehouse" value={wh} onChange={(e) => { setWh(e.target.value); setAsn(''); }}>
            {places.map((c) => <option key={c} value={c}>{warehouseNames[c] ?? c}</option>)}
          </DsSelect>
        )}
        <DsSelect label="Source" value={asn} onChange={(e) => setAsn(e.target.value)}>
          <option value="">No stock notice</option>
          {board.asns.filter((a) => a.warehouse_code === wh).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.owner}</option>)}
        </DsSelect>
        {!asn && (
          <DsSelect label="Owner" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">Octopus stock</option>
            {board.clients.map((c) => <option key={c.org_id} value={c.org_id}>{c.name}</option>)}
          </DsSelect>
        )}
        <DsInput label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div><DsButton type="submit" variant="secondary" icon="plus" disabled={pending || !wh} testId="wh-pallet-create">New pallet</DsButton></div>
      <MsgLine msg={msg} testId="wh-pallet-msg" />
    </form>
  );
}

function PalletItem({ p, can, warehouseNames }: { p: PalletRow; can: boolean; warehouseNames: Record<string, string> }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [label, tone] = PALLET_STATUS[p.status] ?? [p.status, 'neutral'];
  return (
    <li className="border-b border-[#EEF0F4] last:border-0 px-5 py-3 flex flex-col gap-2" data-testid={`wh-pallet-${p.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold font-mono">{p.code}</div>
          <div className="text-[12.5px] text-[#5B6478]">
            {p.owner ?? 'Unknown owner'} · {p.asn_code ? <span className="font-mono">{p.asn_code}</span> : 'no stock notice'} · {warehouseNames[p.warehouse_code] ?? p.warehouse_code}
            {p.units ? ` · ${p.units} unit(s) in ${p.lots} lot(s)` : ' · empty'}{p.bin_code ? <> · bin <span className="font-mono">{p.bin_code}</span></> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DsBadge tone={tone}>{label}</DsBadge>
          {can && p.status === 'stored' && <DsButton variant="link" onClick={() => setOpen((o) => !o)} aria-expanded={open} testId="wh-pallet-move-toggle">Move</DsButton>}
        </div>
      </div>
      {open && (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => movePalletAction(p.id, p.warehouse_code, to, reason), () => { setOpen(false); setTo(''); setReason(''); }); }}>
          <DsInput label="To bin" placeholder="A-02-01" value={to} onChange={(e) => setTo(upper(e.target.value))} containerClassName="w-[150px]" autoCapitalize="characters" />
          <DsInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} containerClassName="min-w-[200px] flex-1" maxLength={300} />
          <DsButton type="submit" variant="secondary" disabled={pending || !to || !reason.trim()} testId="wh-pallet-move">Move pallet</DsButton>
        </form>
      )}
      <MsgLine msg={msg} testId="wh-pallet-move-msg" />
    </li>
  );
}

function MoveStock({ contents, canAt }: { contents: BinContent[]; canAt: (wh: string) => boolean }) {
  const { pending, msg, run } = useRun();
  const rows = contents.filter((c) => canAt(c.warehouse_code));
  const [key, setKey] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const keyOf = (c: BinContent) => `${c.bin_id}|${c.lot_id}|${c.pallet_code ?? ''}`;
  const sel = rows.find((c) => keyOf(c) === key);
  // loose + pallet units of this lot in this bin can be moved
  const max = sel ? rows.filter((c) => c.bin_id === sel.bin_id && c.lot_id === sel.lot_id).reduce((s, c) => s + c.qty, 0) : 0;
  const why = !sel ? 'Choose what to move' : !to ? 'Scan or type the bin to move to' : !(Number(qty) > 0) ? 'Enter the units'
    : Number(qty) > max ? `Only ${max} unit(s) of this lot are in ${sel.bin_code}` : !reason.trim() ? 'Enter a reason' : undefined;
  if (rows.length === 0) return <p className="m-0 text-[13.5px] text-[#5B6478]">No stock in bins yet.</p>;
  return (
    <form className="flex flex-col gap-3" data-testid="wh-move-form"
      onSubmit={(e) => { e.preventDefault(); if (!why && sel) run(() => moveStockAction({ warehouse: sel.warehouse_code, fromBin: sel.bin_id, toBin: to, itemId: sel.item_id, lotId: sel.lot_id, qty: Number(qty), reason }), () => { setQty(''); setReason(''); setTo(''); }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DsSelect label="From" value={key} onChange={(e) => setKey(e.target.value)} containerClassName="sm:col-span-2">
          <option value="">Choose a bin and lot</option>
          {rows.map((c) => <option key={keyOf(c)} value={keyOf(c)}>{c.bin_code} · {c.lot_code} · {itemText(c.item)}{c.pallet_code ? ` · ${c.pallet_code}` : ''} · {c.qty}</option>)}
        </DsSelect>
        <DsInput label="To bin" placeholder="A-02-01" value={to} onChange={(e) => setTo(upper(e.target.value))} autoCapitalize="characters" />
        <DsInput label="Units to move" inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} />
        <DsInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} containerClassName="sm:col-span-2" />
      </div>
      <div><DsButton type="submit" variant="secondary" disabled={pending || Boolean(why)} disabledReason={why} testId="wh-move-submit">Move stock</DsButton></div>
      <MsgLine msg={msg} testId="wh-move-msg" />
    </form>
  );
}

export function PutawayClient({ board, warehouseNames, current }: { board: PutawayBoard; warehouseNames: Record<string, string>; current: string | null }) {
  const canAt = (wh: string) => board.can_putaway.includes(wh);
  const [lotId, setLotId] = useState('');
  const groups = useMemo(() => groupLots(board.unplaced), [board.unplaced]);
  const waitingUnits = board.unplaced.reduce((s, l) => s + l.free, 0);
  const usedBins = board.bins.filter((b) => (b.units ?? 0) > 0 || b.pallets > 0).length;
  const blocked = board.bins.filter((b) => b.status === 'blocked').length;
  const tiles: [string, string, string][] = [
    ['Waiting for putaway', `${waitingUnits}`, `${board.unplaced.length} lot(s)`],
    ['Open pallets', `${board.pallets.filter((p) => p.status === 'open').length}`, `${board.pallets.filter((p) => p.status === 'stored').length} stored`],
    ['Bins in use', `${usedBins}`, `of ${board.bins.length}`],
    ['Blocked bins', `${blocked}`, 'refuse putaway'],
  ];
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map(([l, n, s]) => (
          <div key={l} className="ds-card" data-testid={`wh-pw-${l.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-[#5B6478]">{l}</div>
            <div className="text-[28px] font-bold leading-tight">{n}</div>
            <div className="text-[12px] text-[#5B6478]">{s}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <DsCard title="Waiting for putaway" icon="download" noPadding testId="wh-unplaced" subtitle="Released lots not yet in a bin, by source and owner.">
          {groups.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">No released lots are waiting.</p> : (
            <ul className="list-none m-0 p-0">
              {groups.map((g) => (
                <li key={g.key} className="border-b border-[#EEF0F4] last:border-0">
                  <div className="px-5 pt-3 text-[12.5px] font-semibold text-[#5B6478]">
                    {g.source}{g.ref && <> · {g.ref.startsWith('ASN-') ? <Link className="font-mono text-[#2559B8] hover:underline" href={`/office/warehouse/receive/${g.ref}`}>{g.ref}</Link> : <span className="font-mono">{g.ref}</span>}</>} · {g.owner}
                  </div>
                  <ul className="list-none m-0 p-0">
                    {g.lots.map((l) => (
                      <li key={l.lot_id} className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-2" data-testid={`wh-unplaced-${l.lot_code}`}>
                        <div className="min-w-0">
                          <div className="font-semibold">{itemText(l.item)}</div>
                          <div className="text-[12.5px] text-[#5B6478]"><span className="font-mono">{l.lot_code}</span> · {l.free} of {l.qty} left · {warehouseNames[l.warehouse_code] ?? l.warehouse_code}</div>
                        </div>
                        {canAt(l.warehouse_code) && <DsButton variant="secondary" onClick={() => setLotId(l.lot_id)} aria-label={`Put away ${l.lot_code}`}>Put away</DsButton>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
        <DsCard title="Put away" icon="box" testId="wh-putaway-card" subtitle="Scan the lot, then the bin label. A blocked bin refuses stock.">
          <PutawayForm board={board} lotId={lotId} setLotId={setLotId} canAt={canAt} />
        </DsCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <DsCard title="Pallets" icon="layers" noPadding testId="wh-pallets" subtitle="Open and stored pallets with their source and owner. One owner per pallet.">
          <div className="px-5 py-4 border-b border-[#EEF0F4]"><NewPallet board={board} current={current} warehouseNames={warehouseNames} /></div>
          {board.pallets.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">No open or stored pallets.</p> : (
            <ul className="list-none m-0 p-0">{board.pallets.map((p) => <PalletItem key={p.id} p={p} can={canAt(p.warehouse_code)} warehouseNames={warehouseNames} />)}</ul>
          )}
        </DsCard>
        <DsCard title="Move stock between bins" icon="refresh" testId="wh-move-card" subtitle="Units taken off a pallet arrive loose. Moving between warehouses is a transfer.">
          <MoveStock contents={board.contents} canAt={canAt} />
        </DsCard>
      </div>

      <DsCard title="Bin occupancy" icon="grid" noPadding testId="wh-bins-occupancy"
        actions={<Link href="/office/warehouse/putaway/bins" className="text-[14px] font-semibold text-[#2559B8] hover:underline">Manage bins</Link>}
        subtitle="Units, products and pallets in each bin.">
        {board.bins.length === 0 ? (
          <div className="px-5 py-4"><DsEmptyState icon="grid" title="No bins yet" description="Create bins (rack, row and bin) before putting stock away." actionLabel="Create bins" actionHref="/office/warehouse/putaway/bins" actionIcon="plus" /></div>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Bin occupancy" tabIndex={0}>
            <table className="ds-tbl" style={{ minWidth: 560 }}>
              <thead><tr><th scope="col">Bin</th><th scope="col">Zone</th><th scope="col">Status</th><th scope="col">Units</th><th scope="col">Products</th><th scope="col">Pallets</th></tr></thead>
              <tbody>
                {board.bins.map((b) => {
                  const [label, tone] = BIN_STATUS[b.status] ?? [b.status, 'neutral'];
                  return (
                    <tr key={b.id} data-testid={`wh-bin-row-${b.code}`}>
                      <td><span className="font-mono font-semibold">{b.code}</span>{current ? null : <span className="text-[12px] text-[#5B6478]"> · {warehouseNames[b.warehouse_code] ?? b.warehouse_code}</span>}</td>
                      <td>{b.zone ?? '—'}</td>
                      <td><DsBadge tone={tone}>{label}</DsBadge>{b.block_reason ? <span className="block text-[12px] text-[#5B6478]">{b.block_reason}</span> : null}</td>
                      <td>{b.units ?? 'Empty'}</td><td>{b.items}</td><td>{b.pallets}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>

      <DsCard title="Recent placement" icon="clock" noPadding testId="wh-recent-moves">
        {board.recent.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">Nothing put away or moved yet.</p> : (
          <ul className="list-none m-0 p-0">
            {board.recent.map((m) => (
              <li key={m.id} className="border-b border-[#EEF0F4] last:border-0 px-5 py-2.5 text-[13.5px]">
                <span className="font-semibold">{MOVE_KIND[m.kind] ?? m.kind}</span> · {m.qty} × {itemText(m.item)} · <span className="font-mono">{m.lot_code}</span>
                {m.from_bin && <> · from <span className="font-mono">{m.from_bin}</span></>}{m.to_bin && <> · to <span className="font-mono">{m.to_bin}</span></>}
                {m.pallet_code && <> · <span className="font-mono">{m.pallet_code}</span></>}
                <span className="text-[#5B6478]"> · {m.by_name ?? 'staff'} · {fmtWh(m.created_at)}{m.reason ? ` · “${m.reason}”` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </DsCard>
    </div>
  );
}
