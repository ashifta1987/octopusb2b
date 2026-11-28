/**
 * ODS T9 · /admin/turnkey/reports — presentational. Every number comes from today's tk_report_* functions; CSV downloads are
 * today's route handler (/admin/turnkey/reports/export, never rewritten). Period pills = ?months=.
 */
import { EmptyState } from '@octopus/ui';
import { fmtDate } from '@/lib/format';
import { feeTotals, funnelShare, type TkAgeingRow, type TkFeeRow, type TkFunnelRow, type TkInspectorRow, type TkUnpaidRow } from '@/lib/turnkey/reports';
import { A, LoadError, Note, Panel, SimpleTable, TurnkeyHead } from './tk-ui';

export const PERIODS: [string, string][] = [['1', 'This month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['all', 'All time']];

export type ReportsViewProps = {
  isAdmin: boolean;
  months: string;
  periodText: string;
  forbidden: boolean;
  failed: boolean;
  fees: TkFeeRow[];
  funnel: TkFunnelRow[];
  ageing: TkAgeingRow[];
  unpaid: TkUnpaidRow[];
  inspectors: TkInspectorRow[];
  money: (c: number) => string;
  base?: string;
};

function Csv({ report, label, months }: { report: string; label: string; months: string }) {
  return (
    <a href={`/admin/turnkey/reports/export?report=${report}&months=${months}`} className="inline-flex min-h-ods-control items-center rounded-ods-control border border-ods-line-strong px-3 text-ods-small font-semibold text-ods-navy no-underline hover:bg-ods-canvas" data-testid={`tk-csv-${report}`} download>
      Download CSV<span className="sr-only"> of {label}</span>
    </a>
  );
}

export function ReportsView(r: ReportsViewProps) {
  const totals = feeTotals(r.fees);
  const sum = (k: 'issued_cents' | 'paid_cents' | 'outstanding_cents') => totals.reduce((a, t) => a + t[k], 0);
  const first = r.funnel[0]?.reached ?? 0;
  const base = r.base ?? '/admin/turnkey/reports';
  const sep = base.includes('?') ? '&' : '?';
  return (
    <div className="grid gap-4" data-testid="tk-reports">
      <TurnkeyHead title="Turnkey reports" subtitle="Fees by service, the phase funnel, unpaid proformas by age and inspector workload. Counted from real records only; demo data is left out." current="reports" isAdmin={r.isAdmin} />
      {r.forbidden ? <Note tone="warning">Turnkey reports are for the Turnkey team (and company-wide finance and admins) on a 2FA session.</Note> : (
        <>
          {r.failed ? <LoadError what="some numbers" /> : null}
          <nav aria-label="Report period" className="flex flex-wrap gap-2" data-testid="tk-report-period">
            {PERIODS.map(([k, label]) => (
              <a key={k} href={`${base}${sep}months=${k}`} aria-current={r.months === k ? 'page' : undefined}
                className={`inline-flex min-h-ods-control items-center rounded-ods-control border px-3 text-ods-body no-underline ${r.months === k ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy'}`}>{label}</a>
            ))}
          </nav>
          <p className="m-0 text-ods-small text-ods-slate">{r.periodText}. Months are calendar months in UTC. Unpaid ageing is always as of today.</p>
          <dl className="m-0 grid grid-cols-2 gap-2 ods-tablet:grid-cols-4" data-testid="tk-report-kpis">
            {[
              ['Issued', r.money(sum('issued_cents'))],
              ['Paid', r.money(sum('paid_cents'))],
              ['Outstanding', r.money(sum('outstanding_cents'))],
              ['Unpaid proformas', String(r.unpaid.length)],
            ].map(([k, val]) => (
              <div key={k} className="rounded-ods-card border border-ods-line bg-ods-surface p-3"><dt className="text-ods-small text-ods-slate">{k}</dt><dd className="m-0 text-ods-h2 font-bold tabular-nums text-ods-navy">{val}</dd></div>
            ))}
          </dl>

          <Panel title="Fees by service" actions={<Csv report="fees" label="fees by service" months={r.months} />} description="Proformas issued in the period, by the service they bill. Paid = what the client has paid towards them. Replaced (void) proformas are counted apart and not in the totals.">
            <SimpleTable
              caption="Fees by service"
              head={['Service', 'Issued', 'Issued amount', 'Paid', 'Outstanding', 'Void']}
              numeric={[1, 2, 3, 4, 5]}
              empty={<EmptyState title="No fees issued in this period" description="Fees appear here once a proforma is issued to a client." headingLevel={3} />}
              rows={[
                ...totals.map((t) => ({ key: t.service_key, testId: `tk-fee-${t.service_key}`, cells: [<b key="n">{t.service_name}</b>, t.issued_count, r.money(t.issued_cents), r.money(t.paid_cents), r.money(t.outstanding_cents), t.void_count || '—'] })),
                ...(totals.length > 1 ? [{ key: 'total', testId: 'tk-fee-total', className: 'font-semibold', cells: ['Total', totals.reduce((a, t) => a + t.issued_count, 0), r.money(sum('issued_cents')), r.money(sum('paid_cents')), r.money(sum('outstanding_cents')), ''] }] : []),
              ]}
            />
            {r.fees.length > 0 ? (
              <details className="mt-2">
                <summary className="inline-flex min-h-ods-control cursor-pointer items-center font-semibold">By month</summary>
                <SimpleTable caption="Fees by month" head={['Month', 'Service', 'Issued amount', 'Paid', 'Outstanding']} numeric={[2, 3, 4]} rows={r.fees.map((f) => ({ key: `${f.period}-${f.service_key}`, cells: [new Date(f.period).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), f.service_name, r.money(f.issued_cents), r.money(f.paid_cents), r.money(f.outstanding_cents)] }))} />
              </details>
            ) : null}
          </Panel>

          <Panel title="Phase funnel" actions={<Csv report="funnel" label="the phase funnel" months={r.months} />} description="Projects started in the period: how many reached each phase, and where they are now.">
            {first === 0 ? <EmptyState title="No projects started in this period" description="The funnel fills as clients send enquiries." headingLevel={3} /> : (
              <SimpleTable caption="Phase funnel" head={['Phase', 'Reached', 'Of all', 'In progress here', 'On hold here', 'Cancelled here', 'Completed']} numeric={[1, 3, 4, 5, 6]}
                rows={r.funnel.map((f) => ({
                  key: f.stage, testId: `tk-funnel-${f.stage}`,
                  cells: [
                    `${f.seq}. ${f.stage_name}`, f.reached,
                    <span key="s"><span className="sr-only">{funnelShare(f.reached, first)}% of the projects</span><span aria-hidden="true" className="inline-flex items-center gap-2"><span className="inline-block h-2 rounded bg-ods-navy" style={{ width: `${Math.max(2, funnelShare(f.reached, first) ?? 0)}px` }} /><span className="text-ods-small tabular-nums">{funnelShare(f.reached, first)}%</span></span></span>,
                    f.open_now || '—', f.on_hold_now || '—', f.cancelled_here || '—', f.completed_here || '—',
                  ],
                }))} />
            )}
          </Panel>

          <Panel title="Unpaid proformas by age" id="ageing" actions={<Csv report="ageing" label="unpaid ageing" months={r.months} />} description="Days since each unpaid proforma was issued (every Turnkey service is paid before the work starts).">
            <dl className="m-0 grid grid-cols-2 gap-2 ods-desktop:grid-cols-4" data-testid="tk-ageing">
              {r.ageing.map((a) => (
                <div key={a.bucket} className="rounded-ods-card border border-ods-line p-3" data-testid={`tk-ageing-${a.sort}`}>
                  <dt className="text-ods-small text-ods-slate">{a.bucket} days</dt>
                  <dd className="m-0 text-ods-h2 font-bold tabular-nums">{a.open_count}</dd>
                  <dd className="m-0 text-ods-small">{a.open_count ? r.money(a.outstanding_cents) : '—'}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-ods-body font-semibold text-ods-navy">Unpaid list</h3>
              <Csv report="unpaid" label="the unpaid list" months={r.months} />
            </div>
            <SimpleTable caption="Unpaid proformas" head={['Proforma', 'Project', 'Client', 'Service', 'Outstanding', 'Issued', 'Days']} numeric={[4, 6]}
              empty={<EmptyState title="Nothing unpaid" description="Every issued Turnkey proforma is paid." headingLevel={3} />}
              rows={r.unpaid.map((u) => ({ key: u.document_id, testId: `tk-unpaid-${u.project_code}`, cells: [<span key="n" className="font-mono">{u.number ?? '—'}</span>, <A key="p" href={`/admin/turnkey/projects/${u.project_code}`}>{u.project_code}</A>, u.client_name ?? '—', u.service_name, r.money(u.outstanding_cents), fmtDate(u.issued_at), u.age_days] }))} />
          </Panel>

          <Panel title="Inspector workload" actions={<Csv report="inspectors" label="inspector workload" months={r.months} />} description="Open jobs are scheduled or in progress. Published = reports published in the period.">
            <SimpleTable caption="Inspector workload" head={['Inspector', 'Open jobs', 'Due in 7 days', 'Overdue', 'Waiting for review', 'Published', 'Next date']} numeric={[1, 2, 3, 4, 5]}
              empty={<EmptyState title="No inspections assigned" description="Inspectors appear here once an inspection is scheduled for them." headingLevel={3} />}
              rows={r.inspectors.map((i) => ({ key: i.inspector_id, testId: 'tk-inspector-row', cells: [<b key="n">{i.inspector_name}</b>, i.open_jobs, i.due_7_days, <span key="o" className={i.overdue ? 'font-semibold text-ods-danger' : undefined}>{i.overdue}</span>, i.awaiting_review, i.published_in_period, i.next_on ? fmtDate(i.next_on) : '—'] }))} />
          </Panel>
        </>
      )}
    </div>
  );
}
