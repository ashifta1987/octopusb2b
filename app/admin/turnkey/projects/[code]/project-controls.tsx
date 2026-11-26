'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TK_PHASES, earlierPhases, nextPhase, tkPhase } from '@/lib/turnkey/format';
import { moveStageAction, setManagerAction, setStageDueAction, setStatusAction } from '../actions';

type Res = { ok: boolean; message?: string; error?: string };

/**
 * Turnkey T2 — staff controls on the Project screen: move one phase forward (or back with a reason the client sees),
 * hold / cancel / complete / reopen, target date per phase, and the account manager (cover when away comes in T3).
 * Forms use onSubmit + preventDefault so typed text stays when the database refuses; the page refreshes after a change.
 */
export function ProjectControls({ projectId, code, stage, status, managerId, candidates, dues }: {
  projectId: string; code: string; stage: string; status: string; managerId: string | null;
  candidates: { user_id: string; full_name: string }[]; dues: Record<string, string | null>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fwdNote, setFwdNote] = useState('');
  const [backTo, setBackTo] = useState('');
  const [backWhy, setBackWhy] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [statusWhy, setStatusWhy] = useState('');
  const [manager, setManager] = useState(managerId ?? '');
  const [dueStage, setDueStage] = useState(stage);
  const [due, setDue] = useState(dues[stage] ?? '');
  const next = nextPhase(stage);
  const earlier = earlierPhases(stage);
  const open = status === 'open';
  const statusOptions = ([['open', status === 'completed' || status === 'cancelled' ? 'Reopen' : 'In progress'], ['on_hold', 'Put on hold'], ['cancelled', 'Cancel the project'], ['completed', 'Complete (at Handover)']] as const)
    .filter(([v]) => v !== status && (v !== 'completed' || stage === 'handover'));
  const needsWhy = newStatus === 'on_hold' || newStatus === 'cancelled';

  const run = (p: () => Promise<Res>, after?: () => void) => start(async () => {
    const r = await p();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(); router.refresh(); }
  });
  const submit = (fn: () => void) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); fn(); };

  return (
    <div className="flex flex-col gap-5" data-testid="tk-staff-controls">
      {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid="tk-staff-msg">{msg.text}</p>}

      <section aria-labelledby="tk-move-h" className="flex flex-col gap-3">
        <h3 id="tk-move-h" className="m-0 text-[15px] font-semibold">Phase</h3>
        {!open && <p className="m-0 text-sm text-muted">Reopen the project to move it.</p>}
        {open && next && (
          <form onSubmit={submit(() => run(() => moveStageAction(projectId, code, next.code, fwdNote), () => setFwdNote('')))} className="flex flex-col gap-2">
            <label className="label" htmlFor="tk-fwd-note">Message to the client (optional)</label>
            <input id="tk-fwd-note" className="input min-h-11" value={fwdNote} onChange={(e) => setFwdNote(e.target.value)} maxLength={1000} />
            <div><button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid="tk-move-next">Move to {next.n}. {next.name}</button></div>
            {next.paid && <p className="m-0 text-[12.5px] text-muted">{next.name} is paid first. Payment checks arrive with fees (next step); until then, move it only after the client has paid.</p>}
          </form>
        )}
        {open && !next && <p className="m-0 text-sm text-muted">This is the last phase. Complete the project below after the client signs off.</p>}
        {open && earlier.length > 0 && (
          <form onSubmit={submit(() => run(() => moveStageAction(projectId, code, backTo, backWhy), () => { setBackTo(''); setBackWhy(''); }))} className="flex flex-col gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2">
              <div>
                <label className="label" htmlFor="tk-back-to">Move back to</label>
                <select id="tk-back-to" className="input min-h-11" value={backTo} onChange={(e) => setBackTo(e.target.value)}>
                  <option value="">Choose a phase</option>
                  {earlier.map((p) => <option key={p.code} value={p.code}>{p.n}. {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="tk-back-why">Reason (the client sees it) *</label>
                <input id="tk-back-why" className="input min-h-11" value={backWhy} onChange={(e) => setBackWhy(e.target.value)} maxLength={1000} />
              </div>
            </div>
            <div><button type="submit" className="btn btn-ghost btn-sm" disabled={pending || !backTo || !backWhy.trim()} data-testid="tk-move-back">Move back</button></div>
          </form>
        )}
      </section>

      <section aria-labelledby="tk-status-h" className="flex flex-col gap-2">
        <h3 id="tk-status-h" className="m-0 text-[15px] font-semibold">Status</h3>
        <form onSubmit={submit(() => run(() => setStatusAction(projectId, code, newStatus, statusWhy), () => { setNewStatus(''); setStatusWhy(''); }))} className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2">
            <div>
              <label className="label" htmlFor="tk-status">Change to</label>
              <select id="tk-status" className="input min-h-11" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} data-testid="tk-status-select">
                <option value="">Choose</option>
                {statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tk-status-why">Reason (the client sees it){needsWhy ? ' *' : ''}</label>
              <input id="tk-status-why" className="input min-h-11" value={statusWhy} onChange={(e) => setStatusWhy(e.target.value)} maxLength={500} />
            </div>
          </div>
          <div><button type="submit" className="btn btn-ghost btn-sm" disabled={pending || !newStatus || (needsWhy && !statusWhy.trim())} data-testid="tk-status-save">Save status</button></div>
        </form>
      </section>

      <section aria-labelledby="tk-due-h" className="flex flex-col gap-2">
        <h3 id="tk-due-h" className="m-0 text-[15px] font-semibold">Target dates</h3>
        <form onSubmit={submit(() => run(() => setStageDueAction(projectId, code, dueStage, due)))} className="grid grid-cols-1 sm:grid-cols-[200px_180px_auto] gap-2 items-end">
          <div>
            <label className="label" htmlFor="tk-due-stage">Phase</label>
            <select id="tk-due-stage" className="input min-h-11" value={dueStage} onChange={(e) => { setDueStage(e.target.value); setDue(dues[e.target.value] ?? ''); }}>
              {TK_PHASES.map((p) => <option key={p.code} value={p.code}>{p.n}. {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tk-due">Target date</label>
            <input id="tk-due" type="date" className="input min-h-11" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div><button type="submit" className="btn btn-ghost btn-sm" disabled={pending || (due || null) === (dues[dueStage] ?? null)} data-testid="tk-due-save">
            {due ? `Save date for ${tkPhase(dueStage)?.name}` : 'Remove date'}
          </button></div>
        </form>
      </section>

      <section aria-labelledby="tk-am-h" className="flex flex-col gap-2">
        <h3 id="tk-am-h" className="m-0 text-[15px] font-semibold">Account manager</h3>
        <form onSubmit={submit(() => run(() => setManagerAction(projectId, code, manager)))} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="label" htmlFor="tk-am">One named contact for the client</label>
            <select id="tk-am" className="input min-h-11" value={manager} onChange={(e) => setManager(e.target.value)} data-testid="tk-am-select">
              <option value="">Not set</option>
              {candidates.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
            </select>
          </div>
          <div><button type="submit" className="btn btn-ghost btn-sm" disabled={pending || manager === (managerId ?? '')} data-testid="tk-am-save">Save</button></div>
        </form>
      </section>
    </div>
  );
}
