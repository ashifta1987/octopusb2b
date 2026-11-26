'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsNotice } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { grams } from '@/lib/warehouse-orders';
import { benchState, checkPasses, type Bench, type ScaleStation } from '@/lib/warehouse-w3b';
import { saveBenchAction, scaleCheckAction } from '../w3b-actions';
import { MsgLine, useRun } from '../wh-run';

const digits = (s: string) => s.replace(/\D/g, '');
const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');

function CheckForm({ b, station }: { b: Bench; station: ScaleStation }) {
  const { pending, msg, run } = useRun();
  const [ref, setRef] = useState('');
  const [read, setRead] = useState('');
  const [note, setNote] = useState('');
  const needsSupervisor = b.status === 'locked' && b.last_check_ok === false && !station.can_unlock_failed;
  const preview = ref && read ? checkPasses(Number(ref), Number(read), b.check_tolerance_g) : null;
  return (
    <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" autoComplete="off" data-testid={`wh-scale-check-${b.code}`}
      onSubmit={(e) => { e.preventDefault(); run(() => scaleCheckAction({ benchId: b.id, referenceG: ref, readingG: read, note }), () => { setRead(''); setNote(''); }); }}>
      <DsInput id={`wh-ref-${b.id}`} label="Reference weight (g)" inputMode="numeric" value={ref} onChange={(e) => setRef(digits(e.target.value))} className="min-h-[48px]" />
      <DsInput id={`wh-read-${b.id}`} label="Scale shows (g)" inputMode="numeric" value={read} onChange={(e) => setRead(digits(e.target.value))} className="min-h-[48px]"
        hint={preview === null ? `Allowed ± ${b.check_tolerance_g} g` : preview ? `Within ± ${b.check_tolerance_g} g` : `Outside ± ${b.check_tolerance_g} g — the bench will lock`} />
      <DsInput id={`wh-note-${b.id}`} label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. 1 kg class M1 weight" />
      <DsButton type="submit" variant="secondary" icon="scale" disabled={pending || !ref || !read || needsSupervisor}
        disabledReason={needsSupervisor ? 'This bench failed its last check; a supervisor runs the check that unlocks it.' : undefined} testId={`wh-scale-check-submit-${b.code}`}>
        Record check
      </DsButton>
      <div className="sm:col-span-4"><MsgLine msg={msg} testId={`wh-scale-check-msg-${b.code}`} /></div>
    </form>
  );
}

function BenchSettings({ b, station }: { b: Bench; station: ScaleStation }) {
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ name: b.name, maxG: b.max_g ? String(b.max_g) : '', tol: String(b.check_tolerance_g), every: b.check_every_hours ? String(b.check_every_hours) : '' });
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[13.5px] font-semibold text-coral-text min-h-[44px] flex items-center">Bench settings</summary>
      <form className="mt-2 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end" data-testid={`wh-bench-edit-${b.code}`}
        onSubmit={(e) => { e.preventDefault(); run(() => saveBenchAction({ warehouse: station.warehouse_code, id: b.id, code: b.code, name: f.name, maxG: f.maxG, toleranceG: f.tol, everyHours: f.every, active: b.active })); }}>
        <DsInput label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
        <DsInput label="Capacity (g)" inputMode="numeric" value={f.maxG} onChange={(e) => setF({ ...f, maxG: digits(e.target.value) })} hint="Empty = not set" />
        <DsInput label="Check tolerance (g)" inputMode="numeric" value={f.tol} onChange={(e) => setF({ ...f, tol: digits(e.target.value) })} />
        <DsInput label="Check every (hours)" inputMode="numeric" value={f.every} onChange={(e) => setF({ ...f, every: digits(e.target.value) })} hint="Empty = no fixed interval" />
        <DsButton type="submit" variant="secondary" disabled={pending}>Save</DsButton>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <DsButton variant="link" disabled={pending} onClick={() => run(() => saveBenchAction({ warehouse: station.warehouse_code, id: b.id, code: b.code, name: b.name, maxG: b.max_g ? String(b.max_g) : '', toleranceG: String(b.check_tolerance_g), everyHours: b.check_every_hours ? String(b.check_every_hours) : '', active: !b.active }))}>
          {b.active ? 'Stop using this bench' : 'Use this bench again'}
        </DsButton>
        <span className="text-[12.5px] text-muted">Changing the tolerance, capacity or interval locks the bench until it passes again.</span>
      </div>
      <MsgLine msg={msg} testId={`wh-bench-edit-msg-${b.code}`} />
    </details>
  );
}

function BenchCard({ b, station }: { b: Bench; station: ScaleStation }) {
  const [label, tone] = benchState(b);
  return (
    <li className="rounded-[12px] border border-line bg-white p-4 flex flex-col gap-3" data-testid={`wh-bench-${b.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold text-[15px]">{b.code}</span>
        <span className="text-[14px]">{b.name}</span>
        <span className="ml-auto"><DsBadge tone={tone} testId={`wh-bench-state-${b.code}`}>{label}</DsBadge></span>
      </div>
      <p className="m-0 text-[13px] text-muted">
        Tolerance ± {b.check_tolerance_g} g{b.max_g ? ` · up to ${grams(b.max_g)}` : ''}{b.check_every_hours ? ` · check every ${b.check_every_hours} h` : ''}
        {b.last_pass_at ? ` · last passed ${fmtWh(b.last_pass_at)}` : ' · never passed'}
      </p>
      {b.active && b.status === 'locked' && (
        <DsNotice tone="bad" title="Locked — nothing is weighed on this bench" testId={`wh-bench-locked-${b.code}`}>{b.locked_reason ?? 'Run a calibration check.'}</DsNotice>
      )}
      {b.active && b.due && <DsNotice tone="warn" title="Check due">Weigh the reference weight before packing on this bench.</DsNotice>}
      {b.active && station.can_check && <CheckForm b={b} station={station} />}
      {b.checks.length > 0 && (
        <div className="overflow-x-auto" role="region" aria-label={`Recent checks of ${b.code}`} tabIndex={0}>
          <table className="ds-tbl" style={{ minWidth: 520 }}>
            <thead><tr><th scope="col">When</th><th scope="col">Reference</th><th scope="col">Read</th><th scope="col">Result</th><th scope="col">By</th></tr></thead>
            <tbody>
              {b.checks.map((c, i) => (
                <tr key={i}>
                  <td>{fmtWh(c.at)}</td><td>{grams(c.reference_g)}</td>
                  <td>{grams(c.reading_g)} <span className="text-[12px] text-muted">({c.reading_g - c.reference_g > 0 ? '+' : ''}{c.reading_g - c.reference_g} g)</span></td>
                  <td>{c.passed ? <DsBadge tone="ok">Passed</DsBadge> : <DsBadge tone="bad">Failed</DsBadge>}{c.note ? <div className="text-[12px] text-muted">{c.note}</div> : null}</td>
                  <td>{c.by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {station.can_manage && <BenchSettings b={b} station={station} />}
    </li>
  );
}

export function ScaleClient({ station }: { station: ScaleStation }) {
  const add = useRun();
  const [f, setF] = useState({ code: '', name: '', maxG: '', tol: '', every: '' });
  const [showOld, setShowOld] = useState(false);
  const active = station.benches.filter((b) => b.active);
  const old = station.benches.filter((b) => !b.active);
  const locked = active.filter((b) => b.status === 'locked').length;
  return (
    <DsCard title={station.name} icon="scale" testId={`wh-scale-${station.warehouse_code}`}
      subtitle={active.length === 0 ? 'No bench yet. Until a bench is added, packing stations here weigh without one.'
        : `${active.length} bench${active.length === 1 ? '' : 'es'} in use${locked ? ` · ${locked} locked` : ''}. Every parcel here is weighed on a checked bench.`}>
      {active.length > 0 && <ul className="m-0 p-0 list-none flex flex-col gap-3">{active.map((b) => <BenchCard key={b.id} b={b} station={station} />)}</ul>}
      {old.length > 0 && (
        <div className="mt-3">
          <DsCheckbox label={`Show benches not in use (${old.length})`} checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />
          {showOld && <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-3">{old.map((b) => <BenchCard key={b.id} b={b} station={station} />)}</ul>}
        </div>
      )}
      {station.can_manage ? (
        <form className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end" data-testid="wh-bench-form"
          onSubmit={(e) => { e.preventDefault(); add.run(() => saveBenchAction({ warehouse: station.warehouse_code, id: null, code: f.code, name: f.name, maxG: f.maxG, toleranceG: f.tol, everyHours: f.every, active: true }), () => setF({ code: '', name: '', maxG: '', tol: '', every: '' })); }}>
          <DsInput label="Bench code" value={f.code} onChange={(e) => setF({ ...f, code: upper(e.target.value) })} placeholder="BENCH-1" />
          <DsInput label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} containerClassName="col-span-2 sm:col-span-2" maxLength={80} />
          <DsInput label="Check tolerance (g)" inputMode="numeric" value={f.tol} onChange={(e) => setF({ ...f, tol: digits(e.target.value) })} />
          <DsInput label="Capacity (g)" inputMode="numeric" value={f.maxG} onChange={(e) => setF({ ...f, maxG: digits(e.target.value) })} />
          <DsInput label="Check every (h)" inputMode="numeric" value={f.every} onChange={(e) => setF({ ...f, every: digits(e.target.value) })} />
          <div className="col-span-2 sm:col-span-6 flex flex-wrap items-center gap-3">
            <DsButton type="submit" variant="secondary" icon="plus" disabled={add.pending || !f.code || !f.name.trim() || !f.tol} testId="wh-bench-submit">Add bench</DsButton>
            <span className="text-[12.5px] text-muted">A new bench is locked until it passes its first check.</span>
          </div>
          <div className="col-span-2 sm:col-span-6"><MsgLine msg={add.msg} testId="wh-bench-msg" /></div>
        </form>
      ) : (
        <p className="mt-3 mb-0 text-[13px] text-muted">Supervisors and admins add benches and change their check settings.</p>
      )}
    </DsCard>
  );
}
