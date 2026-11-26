'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsLinkButton, DsSelect } from '@/components/dropship-ui';
import { SLOT_STATUS, fmtDay, loadText } from '@/lib/warehouse-inbound';
import { bookSlotAction, cancelSlotAction, slotLinkAsnAction, slotStepAction, type InResult } from '../inbound-actions';

export type DockSlot = {
  id: string; warehouse_code: string; dock: string; starts_at: string; ends_at: string; start_local: string; end_local: string;
  status: string; load_note: string | null; asn_id: string | null; asn_code: string | null; asn_status: string | null;
  owner: string | null; cartons: number | null; pallets: number | null; can_act: boolean;
};
export type OpenAsn = { id: string; code: string; warehouse_code: string; expected_date: string; owner: string; cartons: number | null; pallets: number | null };
export type DockBoard = { day: string; slots: DockSlot[]; open_asns: OpenAsn[]; docks: string[] };

type Msg = { ok: boolean; text: string } | null;
const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (p: () => Promise<InResult>, after?: () => void) => start(async () => {
    const r = await p();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { pending, msg, run };
}

function MsgLine({ msg, testId }: { msg: Msg; testId: string }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[13px] ${msg.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>{msg.text}</p>;
}

function BookForm({ board, bookable }: { board: DockBoard; bookable: { code: string; name: string }[] }) {
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ warehouse: bookable[0]?.code ?? '', dock: '', date: board.day, start: '', end: '', asnId: '', note: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const asns = board.open_asns.filter((a) => a.warehouse_code === f.warehouse);
  if (bookable.length === 0) {
    return <DsCard title="Book a slot" icon="plus"><p className="m-0 text-[13.5px] text-[#5B6478]">Receivers, supervisors and admins book dock slots. Choose a warehouse where you have one of these roles.</p></DsCard>;
  }
  return (
    <DsCard title="Book a slot" icon="plus" testId="wh-dock-book" subtitle="Times are local at the warehouse. Two bookings on the same dock can't overlap.">
      <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
        onSubmit={(e) => { e.preventDefault(); run(() => bookSlotAction({ ...f, asnId: f.asnId || null }), () => setF((x) => ({ ...x, asnId: '', note: '' }))); }}>
        {bookable.length > 1 && (
          <DsSelect label="Warehouse" value={f.warehouse} onChange={set('warehouse')}>
            {bookable.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </DsSelect>
        )}
        <DsInput label="Dock" value={f.dock} onChange={set('dock')} placeholder="D1" required maxLength={10} list="wh-dock-names" autoCapitalize="characters" />
        <datalist id="wh-dock-names">{board.docks.map((d) => <option key={d} value={d} />)}</datalist>
        <DsInput label="Date" type="date" value={f.date} onChange={set('date')} required />
        <DsInput label="From" type="time" value={f.start} onChange={set('start')} required />
        <DsInput label="To" type="time" value={f.end} onChange={set('end')} required />
        <DsSelect label="Stock notice" value={f.asnId} onChange={set('asnId')} containerClassName="sm:col-span-2">
          <option value="">No notice yet (check-in stays locked)</option>
          {asns.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.owner} · arrives {fmtDay(a.expected_date)}{loadText(a.cartons, a.pallets) ? ` · ${loadText(a.cartons, a.pallets)}` : ''}</option>)}
        </DsSelect>
        <DsInput label="Load note (optional)" value={f.note} onChange={set('note')} maxLength={300} />
        <div><DsButton type="submit" disabled={pending} loading={pending} testId="wh-dock-book-submit">Book slot</DsButton></div>
      </form>
      <div className="mt-3"><MsgLine msg={msg} testId="wh-dock-book-msg" /></div>
    </DsCard>
  );
}

function SlotRow({ s, asns }: { s: DockSlot; asns: OpenAsn[] }) {
  const { pending, msg, run } = useRun();
  const [link, setLink] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [label, tone] = SLOT_STATUS[s.status] ?? [s.status, 'neutral'];
  const linkable = asns.filter((a) => a.warehouse_code === s.warehouse_code);
  return (
    <li className="border-b border-[#EEF0F4] last:border-0 px-5 py-3 flex flex-col gap-2" data-testid={`wh-slot-${s.dock}-${s.start_local}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{s.start_local}–{s.end_local}</span>
          {s.asn_code
            ? <Link href={`/office/warehouse/receive/${s.asn_code}`} className="font-mono font-semibold text-[#2559B8] hover:underline">{s.asn_code}</Link>
            : <DsBadge tone="bad">No ASN</DsBadge>}
          {s.owner && <span className="text-[13px]">{s.owner}</span>}
          {loadText(s.cartons, s.pallets) && <span className="text-[13px] text-[#5B6478]">{loadText(s.cartons, s.pallets)}</span>}
        </div>
        <DsBadge tone={tone}>{label}</DsBadge>
      </div>
      {s.load_note && <p className="m-0 text-[12.5px] text-[#5B6478]">{s.load_note}</p>}
      {s.can_act && (
        <div className="flex flex-wrap gap-2 items-start">
          {s.status === 'booked' && (
            <DsButton disabled={pending || !s.asn_id} disabledReason={!s.asn_id ? 'No ASN — link a stock notice before check-in' : undefined}
              onClick={() => run(() => slotStepAction(s.id, 'arrived'))} testId="wh-slot-checkin">Check in</DsButton>
          )}
          {s.status === 'booked' && !s.asn_id && linkable.length > 0 && (
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => slotLinkAsnAction(s.id, link)); }}>
              <DsSelect label="Link a stock notice" value={link} onChange={(e) => setLink(e.target.value)} containerClassName="min-w-[220px]">
                <option value="">Choose</option>
                {linkable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.owner}</option>)}
              </DsSelect>
              <DsButton type="submit" variant="secondary" disabled={pending || !link}>Link</DsButton>
            </form>
          )}
          {s.status === 'arrived' && <DsButton disabled={pending} onClick={() => run(() => slotStepAction(s.id, 'unloading'))} testId="wh-slot-unload">Start unloading</DsButton>}
          {(s.status === 'arrived' || s.status === 'unloading') && s.asn_code && (
            <DsLinkButton href={`/office/warehouse/receive/${s.asn_code}`} variant="secondary" icon="list">Receive</DsLinkButton>
          )}
          {s.status === 'unloading' && (
            <DsButton disabled={pending || s.asn_status !== 'received'} disabledReason={s.asn_status !== 'received' ? 'Count and accept every line first' : undefined}
              onClick={() => run(() => slotStepAction(s.id, 'done'))} testId="wh-slot-done">Done</DsButton>
          )}
          {s.status === 'booked' && (cancelling ? (
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => cancelSlotAction(s.id, reason), () => setCancelling(false)); }}>
              <DsInput label="Why is it cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} required />
              <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()}>Cancel slot</DsButton>
              <DsButton variant="link" onClick={() => setCancelling(false)}>Keep</DsButton>
            </form>
          ) : <DsButton variant="link" onClick={() => { setCancelling(true); setReason(''); }}>Cancel slot</DsButton>)}
        </div>
      )}
      <MsgLine msg={msg} testId="wh-slot-msg" />
    </li>
  );
}

export function DockClient({ board, bookable, warehouseNames }: { board: DockBoard; bookable: { code: string; name: string }[]; warehouseNames: Record<string, string> }) {
  const docks = [...new Set(board.slots.map((s) => `${s.warehouse_code}|${s.dock}`))];
  const multiWh = new Set(board.slots.map((s) => s.warehouse_code)).size > 1;
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Day" className="flex flex-wrap items-center gap-2">
        <DsLinkButton href={`/office/warehouse/dock?day=${shiftDay(board.day, -1)}`} variant="secondary">Previous day</DsLinkButton>
        <h2 className="m-0 px-2 text-[18px] font-semibold" data-testid="wh-dock-day">{fmtDay(board.day)}</h2>
        <DsLinkButton href={`/office/warehouse/dock?day=${shiftDay(board.day, 1)}`} variant="secondary">Next day</DsLinkButton>
        <DsLinkButton href="/office/warehouse/dock" variant="link">Today</DsLinkButton>
      </nav>
      <BookForm key={board.day} board={board} bookable={bookable} />
      {docks.length === 0 ? (
        <DsCard><DsEmptyState icon="clock" title="No slots on this day" description="Book a slot above. Each delivery needs a booked slot and a stock notice." /></DsCard>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {docks.map((k) => {
            const [wh, dock] = k.split('|');
            return (
              <DsCard key={k} title={`Dock ${dock}${multiWh ? ` · ${warehouseNames[wh] ?? wh}` : ''}`} icon="truck" noPadding testId={`wh-dock-${dock}`}>
                <ul className="list-none m-0 p-0">
                  {board.slots.filter((s) => s.warehouse_code === wh && s.dock === dock).map((s) => <SlotRow key={s.id} s={s} asns={board.open_asns} />)}
                </ul>
              </DsCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
