'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { fmtWh, itemText } from '@/lib/warehouse-inbound';
import { TRANSFER_STATUS, type TransferRow, type TransfersBoard } from '@/lib/warehouse-putaway';
import { cancelTransferAction, createTransferAction, transferStepAction } from '../putaway-actions';
import { MsgLine, useRun } from '../wh-run';

type Line = { itemId: string; qty: string };

function NewTransfer({ board, current, names }: { board: TransfersBoard; current: string | null; names: (c: string) => string }) {
  const { pending, msg, run } = useRun();
  const origins = board.warehouses.filter((w) => w.can_send && (!current || w.code === current));
  const [from, setFrom] = useState(origins[0]?.code ?? '');
  const dests = board.warehouses.filter((w) => w.code !== from);
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '' }]);
  const [note, setNote] = useState('');
  const stock = board.stock.filter((s) => s.warehouse_code === from);
  const avail = (id: string) => stock.find((s) => s.item_id === id);
  const filled = lines.filter((l) => l.itemId);
  const over = filled.find((l) => Number(l.qty) > (avail(l.itemId)?.available ?? 0));
  const why = !from ? 'Choose where the stock leaves from' : !to ? 'Choose where it goes' : filled.length === 0 ? 'Add a product'
    : filled.some((l) => !(Number(l.qty) > 0)) ? 'Every line needs a quantity' : over ? `Only ${avail(over.itemId)?.available ?? 0} available of ${itemText(avail(over.itemId)?.item ?? null)}` : undefined;
  if (origins.length === 0) return <p className="m-0 text-[13.5px] text-muted" data-testid="wh-transfer-readonly">Only receivers, supervisors and admins at an active warehouse send transfers.</p>;
  if (board.warehouses.length < 2) return <p className="m-0 text-[13.5px] text-muted" data-testid="wh-transfer-one-wh">Transfers need a second active warehouse. Add one in Locations.</p>;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <form className="flex flex-col gap-3" data-testid="wh-transfer-form"
      onSubmit={(e) => { e.preventDefault(); if (!why) run(() => createTransferAction({ from, to, note, lines: filled.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) }), () => { setLines([{ itemId: '', qty: '' }]); setNote(''); }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DsSelect label="From" value={from} onChange={(e) => { setFrom(e.target.value); setTo(''); setLines([{ itemId: '', qty: '' }]); }}>
          {origins.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
        </DsSelect>
        <DsSelect label="To" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a warehouse</option>
          {dests.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
        </DsSelect>
      </div>
      {stock.length === 0 ? (
        <p className="m-0 text-[13.5px] text-muted" data-testid="wh-transfer-no-stock">{names(from)} has no available stock to send.</p>
      ) : (
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-3">
          <legend className="ds-label">Products</legend>
          {lines.map((l, i) => {
            const a = avail(l.itemId);
            return (
              <div key={i} className="grid grid-cols-[1fr_110px] sm:grid-cols-[1fr_140px_auto] gap-3 items-end">
                <DsSelect label={`Product ${i + 1}`} value={l.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
                  <option value="">Choose a product</option>
                  {stock.filter((s) => s.item_id === l.itemId || !lines.some((x) => x.itemId === s.item_id)).map((s) => (
                    <option key={s.item_id} value={s.item_id}>{itemText(s.item)} · {s.available} available · {s.placed} in bins</option>
                  ))}
                </DsSelect>
                <DsInput label={`Units of product ${i + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/\D/g, '') })}
                  hint={a && a.placed < a.available ? `${a.placed} in bins` : undefined} />
                {lines.length > 1 && <DsButton variant="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove product ${i + 1}`}>Remove</DsButton>}
              </div>
            );
          })}
          {lines.length < Math.min(stock.length, 200) && <div><DsButton variant="link" icon="plus" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '' }])}>Add a product</DsButton></div>}
        </fieldset>
      )}
      <DsTextarea label="Note (optional)" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
      <p className="m-0 text-[12.5px] text-muted">Dispatch picks the oldest lots first from the bins. Units not yet put away can’t be sent.</p>
      <div><DsButton type="submit" disabled={pending || Boolean(why)} disabledReason={why} testId="wh-transfer-create">Save draft</DsButton></div>
      <MsgLine msg={msg} testId="wh-transfer-msg" />
    </form>
  );
}

function TransferItem({ t, names }: { t: TransferRow; names: (c: string) => string }) {
  const { pending, msg, run } = useRun();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [label, tone] = TRANSFER_STATUS[t.status] ?? [t.status, 'neutral'];
  const units = t.lines.reduce((s, l) => s + l.qty, 0);
  return (
    <li className="border-b border-divider last:border-0 px-5 py-4 flex flex-col gap-3" data-testid={`wh-transfer-${t.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold"><span className="font-mono">{t.code}</span> · {names(t.from_wh)} → {names(t.to_wh)}</div>
          <div className="text-[12.5px] text-muted">
            {units} unit(s) · {t.lines.length} product(s) · created {fmtWh(t.created_at)}{t.created_by_name ? ` by ${t.created_by_name}` : ''}
            {t.dispatched_at && ` · dispatched ${fmtWh(t.dispatched_at)}${t.dispatched_by_name ? ` by ${t.dispatched_by_name}` : ''}`}
            {t.received_at && ` · received ${fmtWh(t.received_at)}${t.received_by_name ? ` by ${t.received_by_name}` : ''}`}
          </div>
          {t.note && <div className="text-[12.5px] text-muted">“{t.note}”</div>}
          {t.cancel_reason && <div className="text-[12.5px] text-muted">Cancelled: {t.cancel_reason}</div>}
        </div>
        <DsBadge tone={tone} testId="wh-transfer-status">{label}</DsBadge>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5 text-[13.5px]">
        {t.lines.map((l) => (
          <li key={l.id}>
            <span className="font-semibold">{l.qty} × {itemText(l.item)}</span>
            {l.picks.length > 0 && <span className="text-muted"> · picked {l.picks.map((p) => `${p.qty} from ${p.bin_code} (${p.lot_code}${p.pallet_code ? `, ${p.pallet_code}` : ''})`).join(', ')}</span>}
            {l.dest_lot && <span className="text-muted"> · arrived as <span className="font-mono">{l.dest_lot}</span></span>}
          </li>
        ))}
      </ul>
      {t.status === 'draft' && (
        <div className="flex flex-wrap items-start gap-3">
          {t.can_dispatch ? (
            <>
              <DsButton disabled={pending} onClick={() => run(() => transferStepAction(t.id, 'dispatch'))} testId="wh-transfer-dispatch" icon="truck">Dispatch</DsButton>
              <DsButton variant="secondary" onClick={() => setCancelling((v) => !v)} aria-expanded={cancelling} testId="wh-transfer-cancel-toggle">Cancel transfer</DsButton>
            </>
          ) : <p className="m-0 text-[13px] text-muted">Receivers, supervisors and admins at {names(t.from_wh)} dispatch this transfer.</p>}
        </div>
      )}
      {t.status === 'in_transit' && (
        t.can_receive
          ? <div><DsButton disabled={pending} onClick={() => run(() => transferStepAction(t.id, 'receive'))} testId="wh-transfer-receive" icon="download">Receive at {names(t.to_wh)}</DsButton></div>
          : <p className="m-0 text-[13px] text-muted">Receiving staff at {names(t.to_wh)} receive this transfer.</p>
      )}
      {cancelling && (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => cancelTransferAction(t.id, reason), () => setCancelling(false)); }}>
          <DsInput label="Why is it cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} containerClassName="min-w-[220px] flex-1" />
          <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} testId="wh-transfer-cancel">Cancel transfer</DsButton>
        </form>
      )}
      <MsgLine msg={msg} testId="wh-transfer-row-msg" />
    </li>
  );
}

export function TransfersClient({ board, current, warehouseNames }: { board: TransfersBoard; current: string | null; warehouseNames: Record<string, string> }) {
  const names = (c: string) => warehouseNames[c] ?? board.warehouses.find((w) => w.code === c)?.name ?? c;
  const open = board.transfers.filter((t) => t.status === 'draft' || t.status === 'in_transit');
  const closed = board.transfers.filter((t) => t.status === 'received' || t.status === 'cancelled');
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([['Drafts', board.transfers.filter((t) => t.status === 'draft').length], ['In transit', board.transfers.filter((t) => t.status === 'in_transit').length],
          ['Received', board.transfers.filter((t) => t.status === 'received').length]] as const).map(([l, n]) => (
          <div key={l} className="ds-card" data-testid={`wh-trf-${l.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-muted">{l}</div><div className="text-[28px] font-bold leading-tight">{n}</div>
          </div>
        ))}
      </section>
      <DsCard title="New transfer" icon="plus" testId="wh-transfer-new" subtitle="Saved as a draft; nothing moves until it is dispatched.">
        <NewTransfer board={board} current={current} names={names} />
      </DsCard>
      <DsCard title="Open transfers" icon="truck" noPadding testId="wh-transfers-open">
        {open.length === 0 ? <div className="px-5 py-4"><DsEmptyState icon="send" title="No open transfers" description="Drafts and transfers in transit appear here." /></div>
          : <ul className="list-none m-0 p-0">{open.map((t) => <TransferItem key={t.id} t={t} names={names} />)}</ul>}
      </DsCard>
      <DsCard title="Received and cancelled" icon="check" noPadding testId="wh-transfers-closed">
        {closed.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-muted">None yet.</p>
          : <ul className="list-none m-0 p-0">{closed.map((t) => <TransferItem key={t.id} t={t} names={names} />)}</ul>}
      </DsCard>
    </div>
  );
}
