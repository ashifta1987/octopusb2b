/**
 * ODS T9 · Turnkey inspector screens (/office/turnkey/inspect, /office/turnkey/inspect/[id]) — presentational, PHONE FIRST,
 * comfortable density (the T8 inspect layout sets data-density="comfortable": 44 px controls). One column up to 640 px,
 * big tap targets, status in words. The checklist / photos / report form is TODAY's InspectorForm (start, photos to the
 * private bucket, AQL numbers, result, signature, one submit → app/office/turnkey/inspect/actions.ts).
 */
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { Breadcrumbs, EmptyState, Icon, StatusPill } from '@octopus/ui';
import { fmtDate } from '@/lib/format';
import { inspectionLabel, inspectionStatusLabel } from '@/lib/turnkey/format';
import type { TkInspectorJob, TkInspectorJobListItem } from '@/lib/turnkey/qc';
import { InspectorForm } from '@/components/turnkey/inspector-form';
import { odsTone } from '@/app/ods/admin/turnkey/_lib/turnkey-logic';

const OPEN = new Set(['scheduled', 'in_progress', 'planned']);

export function InspectListView({ jobs, error }: { jobs: TkInspectorJobListItem[]; error?: boolean }) {
  const open = jobs.filter((j) => OPEN.has(j.status));
  const done = jobs.filter((j) => !OPEN.has(j.status));
  return (
    <div className="mx-auto grid w-full max-w-[640px] gap-4" data-testid="tk-insp-list">
      <div>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">My inspections</h1>
        <p className="m-0 mt-1 text-ods-body text-ods-slate">Factory audits and pre-shipment inspections assigned to you.</p>
      </div>
      {error ? <p role="alert" className="m-0 rounded-ods-card bg-ods-danger-tint p-3 text-ods-body text-ods-danger">We couldn&apos;t load your inspections. Pull to refresh or reload the page.</p> : null}
      {!error && jobs.length === 0 ? (
        <div className="rounded-ods-card border border-ods-line bg-ods-surface p-4"><EmptyState icon={ClipboardCheck} title="Nothing assigned" description="Inspections the team schedules for you appear here." headingLevel={2} /></div>
      ) : null}
      {[['To do', open, 'tk-insp-open'], ['Done (last 30 days)', done, 'tk-insp-done']].map(([title, list, tid]) =>
        (list as TkInspectorJobListItem[]).length ? (
          <section key={tid as string} aria-labelledby={`${tid}-h`} className="grid gap-2" data-testid={tid as string}>
            <h2 id={`${tid}-h`} className="m-0 text-ods-h2 font-semibold text-ods-navy">{title as string}</h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {(list as TkInspectorJobListItem[]).map((j) => {
                const st = inspectionStatusLabel(j.status, 'staff');
                return (
                  <li key={j.id}>
                    <a href={`/office/turnkey/inspect/${j.id}`} data-testid={`tk-insp-job-${j.project_code}-${j.kind}-${j.round}`}
                      className="flex min-h-[72px] items-center gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 text-ods-text no-underline shadow-ods-card hover:border-ods-navy">
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-ods-body font-semibold text-ods-navy">{inspectionLabel(j.kind, j.round)}</span>
                          <StatusPill tone={odsTone(st.tone)}>{st.label}</StatusPill>
                        </span>
                        <span className="text-ods-body">{j.factory_name}</span>
                        <span className="text-ods-small text-ods-slate">{j.scheduled_on ? fmtDate(j.scheduled_on) : 'No date'} · <span className="font-mono">{j.project_code}</span> · {j.project_title}</span>
                      </span>
                      <Icon icon={ChevronRight} className="shrink-0 text-ods-slate" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

export function InspectJobView({ j, sampleForm }: { j: TkInspectorJob; sampleForm?: boolean }) {
  const st = inspectionStatusLabel(j.status, 'staff');
  return (
    <div className="mx-auto grid w-full max-w-[640px] gap-4" data-testid="tk-inspect-job">
      <Breadcrumbs items={[{ label: 'My inspections', href: '/office/turnkey/inspect' }, { label: inspectionLabel(j.kind, j.round) }]} variant="back" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{inspectionLabel(j.kind, j.round)}</h1>
          <p className="m-0 mt-1 text-ods-body text-ods-slate"><span className="font-mono">{j.project_code}</span> · {j.project_title}</p>
        </div>
        <StatusPill tone={odsTone(st.tone)} data-testid="tk-insp-status">{st.label}</StatusPill>
      </div>
      {j.returned_reason && j.status === 'in_progress' ? <p className="m-0 rounded-ods-card bg-ods-warning-tint p-3 text-ods-body text-ods-warning" data-testid="tk-insp-returned">Returned by the team: {j.returned_reason}</p> : null}
      {!j.paid ? <p className="m-0 rounded-ods-card bg-ods-info-tint p-3 text-ods-body text-ods-info">This inspection starts after the client pays its fee.</p> : null}
      <section aria-labelledby="tk-insp-facts-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
        <h2 id="tk-insp-facts-h" className="m-0 mb-2 text-ods-h2 font-semibold text-ods-navy">Where and what</h2>
        <dl className="m-0 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-ods-body" data-testid="tk-insp-facts">
          <dt className="text-ods-slate">Factory</dt><dd className="m-0 font-semibold">{j.factory_name}</dd>
          {j.factory_address ? <><dt className="text-ods-slate">Address</dt><dd className="m-0">{j.factory_address}</dd></> : null}
          <dt className="text-ods-slate">Date</dt><dd className="m-0">{j.scheduled_on ? fmtDate(j.scheduled_on) : 'Not set'}</dd>
          {j.brief ? <><dt className="text-ods-slate">Brief</dt><dd className="m-0 whitespace-pre-line">{j.brief}</dd></> : null}
        </dl>
      </section>
      <section aria-labelledby="tk-insp-form-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-4" data-testid="tk-insp-form">
        <h2 id="tk-insp-form-h" className="m-0 mb-2 text-ods-h2 font-semibold text-ods-navy">Checklist and report</h2>
        {sampleForm ? (
          <ol className="m-0 grid list-none gap-2 p-0">
            {j.items.map((it) => (
              <li key={it.id} className="grid gap-1 rounded-ods-control border border-ods-line p-3">
                <span className="text-ods-body font-semibold">{it.position}. {it.label}</span>
                <span className="text-ods-small text-ods-slate">Pass · Fail · N/A (sample: the real form is today&apos;s inspector form)</span>
              </li>
            ))}
          </ol>
        ) : (
          <InspectorForm job={{ id: j.id, projectId: j.project_id, kind: j.kind, round: j.round, status: j.status, paid: j.paid, projectOpen: j.project_open, items: j.items, photos: j.photos, report: j.report }} />
        )}
      </section>
    </div>
  );
}
