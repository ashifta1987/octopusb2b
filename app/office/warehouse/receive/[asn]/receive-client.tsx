'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsNotice, DsTextarea } from '@/components/dropship-ui';
import { ASN_STATUS, LINE_STATUS, SLOT_STATUS, SOURCE_LABEL, fmtDay, fmtWh, itemText, loadText, type AsnDetail } from '@/lib/warehouse-inbound';
import { cancelAsnStaffAction, countLineAction, type InResult } from '../../inbound-actions';

type Line = AsnDetail['lines'][number];
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

function CountForm({ code, line, pass, blockedReason, onResult }: { code: string; line: Line; pass: 1 | 2; blockedReason?: string; onResult: (m: Msg) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [good, setGood] = useState('');
  const [damaged, setDamaged] = useState('0');
  const [note, setNote] = useState('');
  const valid = /^\d+$/.test(good) && /^\d+$/.test(damaged);
  const why = blockedReason ?? (!valid ? 'Enter the good and damaged quantities' : undefined);
  return (
    <form className="flex flex-col gap-3" data-testid={`wh-count-form-${pass}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (why) return;
        start(async () => {
          const r = await countLineAction(code, line.id, Number(good), Number(damaged), note);
          // the message lives on the line card: this form is replaced once the line moves on
          onResult({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
          if (r.ok) { setGood(''); setDamaged('0'); setNote(''); router.refresh(); }
        });
      }}>
      <div className="grid grid-cols-2 gap-3">
        <DsInput label={pass === 1 ? 'Good units' : 'Good units (recount)'} inputMode="numeric" pattern="[0-9]*" value={good}
          onChange={(e) => setGood(e.target.value.replace(/\D/g, ''))} className="text-[20px] min-h-[52px]" disabled={Boolean(blockedReason)} />
        <DsInput label="Damaged units" inputMode="numeric" pattern="[0-9]*" value={damaged}
          onChange={(e) => setDamaged(e.target.value.replace(/\D/g, ''))} className="text-[20px] min-h-[52px]" disabled={Boolean(blockedReason)} />
      </div>
      <DsTextarea label="Note (short, over, damage seen)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} disabled={Boolean(blockedReason)} />
      <div>
        <DsButton type="submit" disabled={pending || Boolean(why)} disabledReason={why} loading={pending} className="w-full sm:w-auto min-h-[52px]" testId={`wh-count-submit-${pass}`}>
          {pass === 1 ? 'Save count' : 'Save recount'}
        </DsButton>
      </div>
    </form>
  );
}

function LineCard({ d, line }: { d: AsnDetail; line: Line }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [label, tone] = LINE_STATUS[line.status] ?? [line.status, 'neutral'];
  const p1 = line.counts.find((c) => c.pass === 1);
  const p2 = line.counts.find((c) => c.pass === 2);
  const open = d.asn.status === 'arrived' || d.asn.status === 'receiving';
  return (
    <DsCard title={itemText(line.item)} icon="box" testId={`wh-line-${line.item?.sku ?? line.id}`} actions={<DsBadge tone={tone}>{label}</DsBadge>}>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 m-0 text-[14px]">
        <dt className="text-muted">Expected</dt><dd className="m-0 text-[20px] font-bold leading-tight" data-testid="wh-line-expected">{line.expected.toLocaleString('en-US')}</dd>
        {line.item?.barcode && <><dt className="text-muted">Barcode</dt><dd className="m-0 font-mono">{line.item.barcode}</dd></>}
        {p1 && <><dt className="text-muted">Count 1</dt><dd className="m-0">{p1.good} good · {p1.damaged} damaged · {p1.by === d.me ? 'you' : p1.by_name ?? 'staff'}{p1.note ? ` · “${p1.note}”` : ''}</dd></>}
        {p2 && <><dt className="text-muted">Count 2</dt><dd className="m-0">{p2.good} good · {p2.damaged} damaged · {p2.by === d.me ? 'you' : p2.by_name ?? 'staff'}{p2.note ? ` · “${p2.note}”` : ''}</dd></>}
        {line.status === 'accepted' && <><dt className="text-muted">Received</dt><dd className="m-0">{line.good ?? '—'} good · {line.damaged ?? '—'} damaged</dd></>}
        {line.lot && <><dt className="text-muted">Lot</dt><dd className="m-0 font-mono">{line.lot.code} · {line.lot.qty} · {line.lot.status === 'blocked' ? 'blocked' : 'on hand'}</dd></>}
      </dl>
      {open && d.can_receive && line.status === 'pending' && <div className="mt-4"><CountForm code={d.asn.code} line={line} pass={1} onResult={setMsg} /></div>}
      {open && d.can_receive && line.status === 'counted' && (
        <div className="mt-4 flex flex-col gap-3">
          <DsNotice tone="warn" title="Recount needed">The first count differs from the notice. A different person counts again.</DsNotice>
          <CountForm code={d.asn.code} line={line} pass={2} blockedReason={p1?.by === d.me ? 'You did the first count; a different person must recount' : undefined} onResult={setMsg} />
        </div>
      )}
      {line.status === 'blocked' && (
        <div className="mt-4">
          <DsNotice tone="bad" title="Blocked until a supervisor approves" action={<Link href="/office/warehouse/counts" className="font-semibold text-coral-text underline">Counts and lots</Link>}>
            The lot is not on hand and can’t be picked.
          </DsNotice>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-count-msg" className={`mt-3 mb-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </DsCard>
  );
}

export function ReceiveClient({ detail: d }: { detail: AsnDetail }) {
  const { pending, msg, run } = useRun();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const a = d.asn;
  const [label, tone] = ASN_STATUS[a.status] ?? [a.status, 'neutral'];
  const slot = d.slot ? SLOT_STATUS[d.slot.status] ?? [d.slot.status, 'neutral'] : null;
  const counted = d.lines.filter((l) => l.status === 'accepted').length;
  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <DsCard title={a.code} icon="file" testId="wh-receive-head" actions={<DsBadge tone={tone} testId="wh-asn-status">{label}</DsBadge>}>
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <dt className="text-muted">Owner</dt><dd className="m-0">{a.org_name ?? SOURCE_LABEL[a.source] ?? a.source}</dd>
          <dt className="text-muted">Arrives</dt><dd className="m-0">{fmtDay(a.expected_date)}</dd>
          <dt className="text-muted">Load</dt><dd className="m-0">{loadText(a.cartons, a.pallets) || '—'}</dd>
          <dt className="text-muted">Dock slot</dt>
          <dd className="m-0">{d.slot && slot ? <>Dock {d.slot.dock} · {fmtWh(d.slot.starts_at)} China time · <DsBadge tone={slot[1]}>{slot[0]}</DsBadge></> : 'Not booked yet'}</dd>
          <dt className="text-muted">Lines accepted</dt><dd className="m-0">{counted} of {d.lines.length}</dd>
          {a.client_note && <><dt className="text-muted">Client note</dt><dd className="m-0 whitespace-pre-line">{a.client_note}</dd></>}
          {a.created_by_name && <><dt className="text-muted">Sent by</dt><dd className="m-0">{a.created_by_name}</dd></>}
          {a.cancel_reason && <><dt className="text-muted">Cancelled because</dt><dd className="m-0">{a.cancel_reason}</dd></>}
        </dl>
        {(a.status === 'submitted' || a.status === 'booked') && (
          <div className="mt-3">
            <DsNotice tone="info" title="Not checked in yet" action={<Link href="/office/warehouse/dock" className="font-semibold text-coral-text underline">Dock appointments</Link>}>
              Counting opens once the delivery is checked in at the dock.
            </DsNotice>
            {d.can_receive && (cancelling ? (
              <form className="mt-3 flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => cancelAsnStaffAction(a.id, reason), () => setCancelling(false)); }}>
                <DsInput label="Why is the notice cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} required />
                <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()}>Cancel notice</DsButton>
                <DsButton variant="link" onClick={() => setCancelling(false)}>Keep</DsButton>
              </form>
            ) : <div className="mt-2"><DsButton variant="link" onClick={() => { setCancelling(true); setReason(''); }}>Cancel this notice</DsButton></div>)}
          </div>
        )}
        {!d.can_receive && (a.status === 'arrived' || a.status === 'receiving') && (
          <p className="mt-3 mb-0 text-[13px] text-muted">Receivers, supervisors and admins record counts.</p>
        )}
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 mb-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
      </DsCard>
      {d.lines.map((l) => <LineCard key={l.id} d={d} line={l} />)}
    </div>
  );
}
