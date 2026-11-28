import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button, EmptyState, ErrorState, Icon, Skeleton, StatusPill, formatDate } from '@octopus/ui';
import { TURNKEY_STEPS } from '../../_services/logic';

/** One project card as the list needs it (customer-safe columns of tk_client_projects + the derived labels). */
export type TurnkeyListRow = {
  code: string; title: string; stepLabel: string; phaseLabel: string; status: { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo' };
  statusReason: string | null; toPay: number; stageChangedAt: string; createdAt: string;
  /** steps done (0…6) on the 6-step ODS stepper; 6 = completed */
  stepsDone: number;
};

export type TurnkeyListState = { kind: 'ready'; rows: TurnkeyListRow[] } | { kind: 'loading' } | { kind: 'error' };

/**
 * /account/turnkey list (C_Turnkey): one card per project with its step, progress through the 6 steps (derived from today's
 * phase — never an invented percentage), status, what it is waiting for, and Open. Two per row from 768 px, stacked on phones.
 */
export function TurnkeyListView({ state }: { state: TurnkeyListState }) {
  const total = TURNKEY_STEPS.length;
  return (
    <section aria-labelledby="turnkey-list-h" className="flex flex-col gap-4" data-testid="turnkey-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="turnkey-list-h" className="m-0 text-ods-h2 text-ods-navy">Your projects</h2>
        <Button href="/account/turnkey/new" data-testid="turnkey-new">Start a turnkey project</Button>
      </div>
      {state.kind === 'loading' ? <Skeleton lines={4} label="Loading your projects" /> : state.kind === 'error' ? (
        <ErrorState title="Your projects could not be loaded" description="Reload the page. If it keeps happening, contact support." headingLevel={3} action={<Button variant="secondary" href="/account/turnkey">Reload</Button>} />
      ) : state.rows.length === 0 ? (
        <EmptyState title="No turnkey projects yet" headingLevel={3}
          description="Pick a project from the catalogue or tell us what you want to open. The enquiry is free."
          action={<Button href="/turnkey/catalogue">Browse turnkey projects</Button>} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2">
          {state.rows.map((r) => {
            const done = Math.min(r.stepsDone, total);
            return (
              <li key={r.code} className="flex flex-col gap-3 rounded-ods-card bg-ods-surface p-ods-pad-card shadow-ods-card" data-testid={`turnkey-row-${r.code}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="m-0 flex flex-col text-ods-h2 text-ods-navy">{r.title}<span className="text-ods-small font-normal text-ods-slate tabular-nums">{r.code}</span></h3>
                  <StatusPill tone={r.status.tone}>{r.status.label}</StatusPill>
                </div>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ods-body">
                  <dt className="text-ods-slate">Step</dt><dd className="m-0 text-end font-semibold">{r.stepLabel}</dd>
                  <dt className="text-ods-slate">Phase</dt><dd className="m-0 text-end">{r.phaseLabel}</dd>
                  <dt className="text-ods-slate">Since</dt><dd className="m-0 text-end">{formatDate(r.stageChangedAt)}</dd>
                </dl>
                <div className="flex flex-col gap-1">
                  <div role="progressbar" aria-label={`Progress of ${r.title}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} steps done`}
                    className="h-2 w-full overflow-hidden rounded-full bg-ods-line">
                    <div className="h-full rounded-full bg-ods-teal" style={{ width: `${Math.round((done / total) * 100)}%` }} />
                  </div>
                  <span className="text-ods-small text-ods-slate">{done} of {total} steps done</span>
                </div>
                {r.statusReason ? <p className="m-0 text-ods-small text-ods-slate">{r.statusReason}</p> : null}
                {r.toPay > 0 ? <p className="m-0 text-ods-small font-semibold text-ods-text" data-testid={`turnkey-to-pay-${r.code}`}>Waiting for your payment ({r.toPay} to pay)</p> : null}
                <div>
                  <Link href={`/account/turnkey/${r.code}`} className="inline-flex min-h-ods-control items-center gap-2 rounded-ods-control border border-ods-line-strong px-4 font-semibold text-ods-navy hover:bg-ods-canvas">
                    <Icon icon={ArrowRight} size="sm" />Open<span className="sr-only"> {r.title}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
