import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, EmptyState, Notice } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { TurnkeyStaffNav } from '@/components/turnkey/staff-nav';
import { nowMs } from '@/components/admin/server';
import { feeTotals, funnelShare, reportPeriod, type TkAgeingRow, type TkFeeRow, type TkFunnelRow, type TkInspectorRow, type TkUnpaidRow } from '@/lib/turnkey/reports';

export const metadata = { title: 'Turnkey reports' };

const PERIODS: [string, string][] = [['1', 'This month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['all', 'All time']];

/** CSV download of one report for the chosen period (same database function as the table). */
function Csv({ report, label, months }: { report: string; label: string; months: string }) {
  return (
    <a href={`/admin/turnkey/reports/export?report=${report}&months=${months}`} className="btn btn-ghost btn-sm min-h-11 inline-flex items-center" data-testid={`tk-csv-${report}`} download>
      Download CSV<span className="sr-only"> of {label}</span>
    </a>
  );
}

/**
 * Admin › Turnkey › Reports (Turnkey T7; design "Reports shows fees by service, funnel, unpaid ageing and inspector
 * workload"): every number is counted by the tk_report_* database functions from real rows (proformas and the fee rows
 * that issued them, projects, inspections). Money is in integer US cents underneath; nothing is estimated. Demo data is
 * left out. Each table has a CSV download. Turnkey staff of the TK division only (the functions check again).
 */
export default async function TurnkeyReportsPage({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/reports');
  const sp = await searchParams;
  const period = reportPeriod(sp.months, new Date(nowMs()));
  const sb = await createClient();
  const from = period.from;
  const [fees, funnel, ageing, unpaid, inspectors] = await Promise.all([
    sb.rpc('tk_report_fees_by_service', { p_from: from, p_to: null, p_include_test: false }),
    sb.rpc('tk_report_funnel', { p_from: from, p_to: null, p_include_test: false }),
    sb.rpc('tk_report_unpaid_ageing', { p_include_test: false }),
    sb.rpc('tk_report_unpaid_list', { p_include_test: false }),
    sb.rpc('tk_report_inspector_load', { p_from: from, p_to: null, p_include_test: false }),
  ]);
  const forbidden = [fees, funnel, ageing, unpaid, inspectors].some((r) => r.error && /FORBIDDEN/.test(r.error.message));
  const failed = [fees, funnel, ageing, unpaid, inspectors].some((r) => r.error && !/FORBIDDEN/.test(r.error.message));
  const F = (fees.data ?? []) as TkFeeRow[];
  const totals = feeTotals(F);
  const FU = (funnel.data ?? []) as TkFunnelRow[];
  const AG = (ageing.data ?? []) as TkAgeingRow[];
  const UL = (unpaid.data ?? []) as TkUnpaidRow[];
  const IN = (inspectors.data ?? []) as TkInspectorRow[];
  const months = period.months ? String(period.months) : 'all';
  const sum = (k: 'issued_cents' | 'paid_cents' | 'outstanding_cents') => totals.reduce((a, t) => a + t[k], 0);
  const first = FU[0]?.reached ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Turnkey reports" subtitle="Fees by service, the phase funnel, unpaid proformas by age and inspector workload. Counted from real records only; demo data is left out." />
      <TurnkeyStaffNav current="reports" isAdmin={s.isAdmin} />
      {forbidden ? <Notice tone="amber">Turnkey reports are for the Turnkey team (and company-wide finance and admins) on a 2FA session.</Notice> : (
        <>
          {failed && <Notice tone="red">Some numbers could not be loaded. Reload the page to try again.</Notice>}
          <nav aria-label="Report period" className="flex flex-wrap gap-2" data-testid="tk-report-period">
            {PERIODS.map(([k, label]) => (
              <Link key={k} href={`/admin/turnkey/reports?months=${k}`} aria-current={months === k ? 'page' : undefined}
                className={`min-h-11 px-3 inline-flex items-center rounded-[10px] border ${months === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-ink'}`}>{label}</Link>
            ))}
          </nav>
          <p className="m-0 text-[13.5px] text-muted">{period.label}{period.from ? ` (from ${fmtDate(period.from)}, by the date each proforma or project was created)` : ''}. Months are calendar months in UTC. Unpaid ageing is always as of today.</p>

          <Card title="Fees by service" action={<Csv report="fees" label="fees by service" months={months} />}>
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Proformas issued in the period, by the service they bill. Paid = what the client has paid towards them. Replaced (void) proformas are counted apart and not in the totals.</p>
            <Table head={['Service', 'Issued', 'Issued amount', 'Paid', 'Outstanding', 'Void']}
              empty={<EmptyState title="No fees issued in this period" body="Fees appear here once a proforma is issued to a client." />}>
              {totals.map((t) => (
                <tr key={t.service_key} data-testid={`tk-fee-${t.service_key}`}>
                  <td className="td font-semibold">{t.service_name}</td>
                  <td className="td mono">{t.issued_count}</td>
                  <td className="td mono">{money(t.issued_cents)}</td>
                  <td className="td mono">{money(t.paid_cents)}</td>
                  <td className="td mono">{money(t.outstanding_cents)}</td>
                  <td className="td mono">{t.void_count || '—'}</td>
                </tr>
              ))}
              {totals.length > 1 && (
                <tr className="font-semibold" data-testid="tk-fee-total">
                  <td className="td">Total</td><td className="td mono">{totals.reduce((a, t) => a + t.issued_count, 0)}</td>
                  <td className="td mono">{money(sum('issued_cents'))}</td><td className="td mono">{money(sum('paid_cents'))}</td><td className="td mono">{money(sum('outstanding_cents'))}</td><td className="td" />
                </tr>
              )}
            </Table>
            {F.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer font-semibold min-h-11 inline-flex items-center">By month</summary>
                <Table head={['Month', 'Service', 'Issued amount', 'Paid', 'Outstanding']}>
                  {F.map((r) => (
                    <tr key={`${r.period}-${r.service_key}`}>
                      <td className="td text-sm">{new Date(r.period).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                      <td className="td text-sm">{r.service_name}</td>
                      <td className="td mono text-sm">{money(r.issued_cents)}</td><td className="td mono text-sm">{money(r.paid_cents)}</td><td className="td mono text-sm">{money(r.outstanding_cents)}</td>
                    </tr>
                  ))}
                </Table>
              </details>
            )}
          </Card>

          <Card title="Phase funnel" action={<Csv report="funnel" label="the phase funnel" months={months} />}>
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Projects started in the period: how many reached each phase, and where they are now.</p>
            {first === 0 ? <EmptyState title="No projects started in this period" body="The funnel fills as clients send enquiries." /> : (
              <Table head={['Phase', 'Reached', 'Of all', 'In progress here', 'On hold here', 'Cancelled here', 'Completed']}>
                {FU.map((r) => (
                  <tr key={r.stage} data-testid={`tk-funnel-${r.stage}`}>
                    <td className="td">{r.seq}. {r.stage_name}</td>
                    <td className="td mono">{r.reached}</td>
                    <td className="td">
                      <span className="sr-only">{funnelShare(r.reached, first)}% of the projects</span>
                      <span aria-hidden="true" className="inline-flex items-center gap-2">
                        <span className="inline-block h-2 rounded bg-ink" style={{ width: `${Math.max(2, funnelShare(r.reached, first) ?? 0)}px` }} />
                        <span className="mono text-[12.5px]">{funnelShare(r.reached, first)}%</span>
                      </span>
                    </td>
                    <td className="td mono">{r.open_now || '—'}</td><td className="td mono">{r.on_hold_now || '—'}</td>
                    <td className="td mono">{r.cancelled_here || '—'}</td><td className="td mono">{r.completed_here || '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Unpaid proformas by age" action={<Csv report="ageing" label="unpaid ageing" months={months} />}>
            <div id="ageing" className="scroll-mt-24" />
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Days since each unpaid proforma was issued (every Turnkey service is paid before the work starts).</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="tk-ageing">
              {AG.map((b) => (
                <div key={b.bucket} className="card p-4" data-testid={`tk-ageing-${b.sort}`}>
                  <div className="text-sm text-muted">{b.bucket} days</div>
                  <div className="mt-1 text-[22px] font-bold">{b.open_count}</div>
                  <div className="text-sm">{b.open_count ? money(b.outstanding_cents) : '—'}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[15px] font-semibold">Unpaid list</h3>
              <Csv report="unpaid" label="the unpaid list" months={months} />
            </div>
            <Table head={['Proforma', 'Project', 'Client', 'Service', 'Outstanding', 'Issued', 'Days']}
              empty={<EmptyState title="Nothing unpaid" body="Every issued Turnkey proforma is paid." />}>
              {UL.map((u) => (
                <tr key={u.document_id} data-testid={`tk-unpaid-${u.project_code}`}>
                  <td className="td mono text-sm">{u.number ?? '—'}</td>
                  <td className="td text-sm"><Link href={`/admin/turnkey/projects/${u.project_code}`} className="hover:text-coral-text">{u.project_code}</Link></td>
                  <td className="td text-sm">{u.client_name ?? '—'}</td>
                  <td className="td text-sm">{u.service_name}</td>
                  <td className="td mono text-sm">{money(u.outstanding_cents)}</td>
                  <td className="td text-sm">{fmtDate(u.issued_at)}</td>
                  <td className="td mono text-sm">{u.age_days}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Inspector workload" action={<Csv report="inspectors" label="inspector workload" months={months} />}>
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Open jobs are scheduled or in progress. Published = reports published in the period.</p>
            <Table head={['Inspector', 'Open jobs', 'Due in 7 days', 'Overdue', 'Waiting for review', 'Published', 'Next date']}
              empty={<EmptyState title="No inspections assigned" body="Inspectors appear here once an inspection is scheduled for them." />}>
              {IN.map((i) => (
                <tr key={i.inspector_id} data-testid="tk-inspector-row">
                  <td className="td font-semibold">{i.inspector_name}</td>
                  <td className="td mono">{i.open_jobs}</td><td className="td mono">{i.due_7_days}</td>
                  <td className={`td mono ${i.overdue ? 'text-bad font-semibold' : ''}`}>{i.overdue}</td>
                  <td className="td mono">{i.awaiting_review}</td><td className="td mono">{i.published_in_period}</td>
                  <td className="td text-sm">{i.next_on ? fmtDate(i.next_on) : '—'}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
