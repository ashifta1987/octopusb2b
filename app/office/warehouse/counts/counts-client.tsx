'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { itemText, type CountPass, type ItemLabel } from '@/lib/warehouse-inbound';
import { addSerialsAction, approveLotAction, type InResult } from '../inbound-actions';

type Recount = { line_id: string; asn_code: string; warehouse_code: string; expected: number; item: ItemLabel; pass1: CountPass | null };
type Blocked = { lot_id: string; lot_code: string; qty: number; asn_code: string | null; warehouse_code: string; expected: number | null; item: ItemLabel; can_approve: boolean; counts: CountPass[] };
type Lot = { lot_id: string; lot_code: string; qty: number; status: string; warehouse_code: string; item: ItemLabel; created_at: string; serials: number; can_receive: boolean };
export type CountsBoard = { me: string; recount: Recount[]; blocked: Blocked[]; lots: Lot[] };
type Msg = { ok: boolean; text: string } | null;

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
const MsgLine = ({ msg, testId }: { msg: Msg; testId: string }) => msg
  ? <p role={msg.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[13px] ${msg.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>{msg.text}</p>
  : null;

function BlockedLot({ b, me }: { b: Blocked; me: string }) {
  const { pending, msg, run } = useRun();
  const [qty, setQty] = useState(String(b.qty));
  const [reason, setReason] = useState('');
  const second = b.counts.find((c) => c.pass === 2);
  const own = second?.by === me;
  const why = own ? 'You did the recount; another supervisor approves this lot'
    : !/^\d+$/.test(qty) ? 'Enter the approved quantity' : !reason.trim() ? 'Enter a reason' : undefined;
  return (
    <li className="border-b border-[#EEF0F4] last:border-0 px-5 py-4 flex flex-col gap-3" data-testid={`wh-blocked-${b.lot_code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{itemText(b.item)}</div>
          <div className="text-[12.5px] text-[#5B6478]"><span className="font-mono">{b.lot_code}</span>{b.asn_code && <> · <Link href={`/office/warehouse/receive/${b.asn_code}`} className="font-mono text-[#2559B8] hover:underline">{b.asn_code}</Link></>}</div>
        </div>
        <DsBadge tone="bad">Blocked · not on hand</DsBadge>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 m-0 text-[13.5px]">
        <dt className="text-[#5B6478]">Expected</dt><dd className="m-0">{b.expected ?? '—'}</dd>
        {b.counts.map((c) => (
          <div key={c.pass} className="contents"><dt className="text-[#5B6478]">Count {c.pass}</dt><dd className="m-0">{c.good} good · {c.damaged} damaged · {c.by === me ? 'you' : c.by_name ?? 'staff'}{c.note ? ` · “${c.note}”` : ''}</dd></div>
        ))}
      </dl>
      {b.can_approve ? (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); if (!why) run(() => approveLotAction(b.lot_id, Number(qty), reason)); }}>
          <DsInput label="Approved quantity" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} containerClassName="w-[160px]" disabled={own} />
          <DsInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} containerClassName="min-w-[240px] flex-1" disabled={own} maxLength={300} />
          <DsButton type="submit" disabled={pending || Boolean(why)} disabledReason={why} testId="wh-approve-lot">Approve and release</DsButton>
        </form>
      ) : <p className="m-0 text-[13px] text-[#5B6478]">Only a supervisor or admin approves counts.</p>}
      <MsgLine msg={msg} testId="wh-approve-msg" />
    </li>
  );
}

function SerialScan({ lots }: { lots: Lot[] }) {
  const { pending, msg, run } = useRun();
  const usable = lots.filter((l) => l.can_receive);
  const [lot, setLot] = useState(usable[0]?.lot_id ?? '');
  const [raw, setRaw] = useState('');
  const sel = usable.find((l) => l.lot_id === lot);
  if (usable.length === 0) return <DsEmptyState icon="tag" title="No lots to scan" description="Lots appear here after receiving. Receivers, supervisors and admins scan serials." />;
  return (
    <form className="flex flex-col gap-3" data-testid="wh-serial-form"
      onSubmit={(e) => { e.preventDefault(); run(() => addSerialsAction(lot, raw), () => setRaw('')); }}>
      <DsSelect label="Lot" value={lot} onChange={(e) => setLot(e.target.value)}>
        {usable.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_code} · {itemText(l.item)} · {l.serials}/{l.qty} serials{l.status === 'blocked' ? ' · blocked' : ''}</option>)}
      </DsSelect>
      <DsTextarea label="Serials (scan one per line)" value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} className="font-mono" />
      <div className="flex flex-wrap items-center gap-3">
        <DsButton type="submit" disabled={pending || !raw.trim() || !sel} testId="wh-serial-submit">Record serials</DsButton>
        {sel && <span className="text-[13px] text-[#5B6478]">{sel.serials} of {sel.qty} recorded for this lot</span>}
      </div>
      <MsgLine msg={msg} testId="wh-serial-msg" />
    </form>
  );
}

export function CountsClient({ board }: { board: CountsBoard }) {
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([['Waiting for a recount', board.recount.length], ['Blocked lots', board.blocked.length], ['Recent lots', board.lots.length]] as const).map(([l, n]) => (
          <div key={l} className="ds-card" data-testid={`wh-counts-${l.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-[#5B6478]">{l}</div><div className="text-[28px] font-bold leading-tight">{n}</div>
          </div>
        ))}
      </section>
      <DsCard title="Waiting for a recount" icon="refresh" noPadding testId="wh-recount-list" subtitle="The first count differs from the notice. Someone other than the first counter counts again.">
        {board.recount.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">No lines are waiting for a recount.</p> : (
          <ul className="list-none m-0 p-0">
            {board.recount.map((r) => (
              <li key={r.line_id} className="border-b border-[#EEF0F4] last:border-0 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{itemText(r.item)}</div>
                  <div className="text-[12.5px] text-[#5B6478]">
                    <span className="font-mono">{r.asn_code}</span> · expected {r.expected}
                    {r.pass1 && <> · count 1: {r.pass1.good} good, {r.pass1.damaged} damaged by {r.pass1.by === board.me ? 'you' : r.pass1.by_name ?? 'staff'}</>}
                  </div>
                </div>
                <Link href={`/office/warehouse/receive/${r.asn_code}`} className="ds-btn ds-btn-secondary">Recount</Link>
              </li>
            ))}
          </ul>
        )}
      </DsCard>
      <DsCard title="Blocked lots" icon="lock" noPadding testId="wh-blocked-list" subtitle="Not on hand and can’t be picked until approved. The person who recounted can’t approve.">
        {board.blocked.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-[#5B6478]">No blocked lots.</p> : (
          <ul className="list-none m-0 p-0">{board.blocked.map((b) => <BlockedLot key={b.lot_id} b={b} me={board.me} />)}</ul>
        )}
      </DsCard>
      <DsCard title="Serial scan" icon="tag" testId="wh-serial-card" subtitle="Each serial is recorded once per product. Duplicates are refused and listed.">
        <SerialScan lots={board.lots} />
      </DsCard>
    </div>
  );
}
