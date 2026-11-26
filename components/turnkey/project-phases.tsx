import { fmtDate } from '@/lib/format';
import { phaseStates, tkPhase, tkStatus, type TkStageRow } from '@/lib/turnkey/format';
import type { TkProjectEvent } from '@/lib/turnkey/projects';

/**
 * Turnkey T2/T3/T4/T5 — the 8-phase timeline of a client project (design: "The 8-step flow"; ClientPortal / staff Project).
 * Shared by the client page and the staff page. Dates that are not known yet are simply not shown (never a made-up date).
 */
export function ProjectPhases({ stage, status, rows }: { stage: string; status: string; rows: TkStageRow[] }) {
  const phases = phaseStates(stage, rows);
  const stopped = status === 'cancelled' || status === 'on_hold';
  return (
    <ol className="list-none m-0 p-0 flex flex-col" data-testid="tk-phases-timeline">
      {phases.map((p, i) => {
        const done = p.state === 'done' || (p.state === 'current' && status === 'completed');
        const current = p.state === 'current' && status !== 'completed';
        return (
          <li key={p.code} className="relative pl-10 pb-5 last:pb-0" data-testid={`tk-phase-${p.code}`} data-state={done ? 'done' : current ? 'current' : 'todo'}
            aria-current={current ? 'step' : undefined}>
            {i < phases.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" aria-hidden />}
            <span aria-hidden className={`absolute left-0 top-0.5 w-7 h-7 rounded-full inline-flex items-center justify-center text-[13px] font-bold border-2 ${
              done ? 'bg-ok border-ok text-white' : current ? (stopped ? 'bg-warn-bg border-warn text-warn' : 'bg-coral border-coral text-white') : 'bg-white border-line-strong text-muted'}`}>
              {done ? '✓' : p.n}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-semibold ${p.state === 'todo' ? 'text-muted' : 'text-ink'}`}>{p.name}</span>
              <span className="sr-only">{done ? '(done)' : current ? '(current phase)' : '(to do)'}</span>
              <span className={`text-[13px] font-bold px-3 py-[3px] rounded-full ${p.paid ? 'bg-tint text-coral-text' : 'bg-ok-bg text-ok'}`}>{p.paid ? 'Paid first' : 'Free'}</span>
              {current && stopped && <span className="text-[12px] font-semibold text-warn">{tkStatus(status).label}</span>}
            </div>
            <p className="m-0 mt-0.5 text-[14px] text-muted">{p.what}</p>
            <p className="m-0 mt-0.5 text-[12.5px] text-muted mono">
              {[
                p.row?.started_at && `Started ${fmtDate(p.row.started_at)}`,
                p.row?.completed_at && `Done ${fmtDate(p.row.completed_at)}`,
                !p.row?.completed_at && p.row?.due_on && `Target ${fmtDate(p.row.due_on)}`,
                p.state === 'todo' && p.paid && !p.row?.due_on && 'Starts after your payment is confirmed',
              ].filter(Boolean).join(' · ')}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Text for one history entry (client-facing). */
export function eventText(e: TkProjectEvent): { title: string; body: string | null } {
  const to = e.to_stage ? tkPhase(e.to_stage)?.name ?? e.to_stage : null;
  switch (e.kind) {
    case 'created': return { title: 'Enquiry sent', body: e.message };
    case 'migrated': return { title: 'Moved to your new project page', body: e.message };
    case 'stage_forward': return { title: `Moved to ${to}`, body: e.message };
    case 'stage_back': return { title: `Moved back to ${to}`, body: e.message };
    case 'status': return { title: e.status === 'open' ? 'Project reopened' : tkStatus(e.status ?? '').label, body: e.message };
    case 'due_date': return { title: 'Target date updated', body: e.message };
    case 'fee': return { title: to ? `Fee set for ${to}` : 'Fee set', body: e.message };
    case 'manager': return { title: 'Account manager cover', body: e.message };
    case 'drawing': return { title: 'Layout drawing', body: e.message };
    case 'quote': return { title: 'Quote', body: e.message };
    case 'inspection': return { title: 'Quality control', body: e.message };
    case 'balance': return { title: 'Balance', body: e.message };
    case 'shipment': return { title: 'Shipment', body: e.message };
    case 'trip': return { title: 'China visit', body: e.message };
    case 'handover': return { title: 'Handover', body: e.message };
    default: return { title: e.kind, body: e.message };
  }
}
