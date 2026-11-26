import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, StatusBadge, Stat, EmptyState, Notice } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { categoryLabel, servicePrice, TK_PHASES, phaseLabel, tkStatus, inspectionLabel, type TkService } from '@/lib/turnkey/format';
import type { TkDashboard } from '@/lib/turnkey/reports';
import { getDivisionScope } from '@/lib/divisions/scope';
import { ImportClient } from './import-client';
import { DepositSetting } from '@/components/turnkey/quote-staff';
import { TurnkeyStaffNav } from '@/components/turnkey/staff-nav';

export const metadata = { title: 'Turnkey' };

type Project = { project_id: string; title: string; category: string; status: string; starting_budget_usd: number | null; hero_image_path: string | null; floor_area_m2: number | null; sort_rank: number };
type Lead = { lead_id: string; reference: string; kind: string; status: string; company_name: string; country: string; created_at: string; turnkey_projects: { title: string } | null };

/**
 * Admin › Turnkey (T0–T7, design docs/design/turnkey-v2): T7 makes the Dashboard the staff home (KPIs from real rows:
 * open projects by phase, fees waiting for approval, unpaid proformas, inspections due, China visits coming up, and
 * "my projects" for account managers). The catalogue + CSV import, the services price list (admins set the deposit %
 * here, T4) and the old leads (read-only; T2 moved each one into a client project) are the other tabs.
 */
export default async function TurnkeyAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey');
  const scope = await getDivisionScope(s);
  const sp = await searchParams;
  const tab = sp.tab === 'catalogue' || sp.tab === 'services' || sp.tab === 'leads' ? sp.tab : 'dashboard';
  const edit = can(s, 'turnkey', 'edit');
  const sb = await createClient();
  const PROJECT_COLS = 'project_id, title, category, status, starting_budget_usd, hero_image_path, floor_area_m2, sort_rank';
  const LEAD_COLS = 'lead_id, reference, kind, status, company_name, country, created_at, turnkey_projects(title)';
  const none = Promise.resolve({ data: null });
  const [{ data: dash, error: dashError }, { data: projects }, { data: services }, { data: leads }, { data: moved }, { data: depositPct }] = await Promise.all([
    tab === 'dashboard' ? sb.rpc('tk_dashboard') : Promise.resolve({ data: null, error: null }),
    tab === 'catalogue' ? (scope.all ? sb.from('turnkey_projects').select(PROJECT_COLS) : sb.from('turnkey_projects').select(PROJECT_COLS).eq('division_id', scope.division.id)).order('sort_rank').order('title') : none,
    tab === 'services' ? sb.from('tk_services').select('code, name, from_cents, unit, approx, rule_text, group_code, photo_path, sort').order('sort') : none,
    tab === 'leads' ? (scope.all ? sb.from('turnkey_leads').select(LEAD_COLS) : sb.from('turnkey_leads').select(LEAD_COLS).eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(300) : none,
    tab === 'leads' ? sb.from('tk_client_project_staff').select('legacy_lead_id, tk_client_projects(code)').not('legacy_lead_id', 'is', null).limit(1000) : none,
    tab === 'services' ? sb.rpc('tk_deposit_pct') : none,
  ]);
  const movedTo = new Map(((moved ?? []) as unknown as { legacy_lead_id: string; tk_client_projects: { code: string } | null }[]).map((m) => [m.legacy_lead_id, m.tk_client_projects?.code ?? null]));
  const P = (projects ?? []) as Project[];
  const L = (leads ?? []) as unknown as Lead[];
  const D = (dash ?? null) as TkDashboard | null;
  const subtitle = {
    dashboard: 'Your Turnkey home: what needs attention today. Every number comes from the projects, fees and invoices themselves.',
    catalogue: 'The public catalogue. Clients see every project that isn’t archived.',
    services: 'Every price is shown to clients as a starting price.',
    leads: 'The old lead list (read-only).',
  }[tab];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Turnkey" subtitle={subtitle} />
      <TurnkeyStaffNav current={tab} isAdmin={s.isAdmin} />

      {tab === 'dashboard' && (dashError || !D ? (
        <Notice tone="red">The dashboard could not be loaded. Try again in a moment.</Notice>
      ) : (
        <Dashboard d={D} />
      ))}

      {tab === 'catalogue' && (
        <>
          {edit && <ImportClient />}
          <Card title="Projects">
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Clients see every project that isn’t archived.</p>
            <Table head={['Project', 'Category', 'Photo', 'Space', 'From', 'Status']}
              empty={<EmptyState title="No catalogue projects yet" body="Import the project sheet above to fill the catalogue." />}>
              {P.map((p) => (
                <tr key={p.project_id}>
                  <td className="td"><div className="font-semibold">{p.title}</div><div className="mono text-[12px] text-muted">{p.project_id}</div></td>
                  <td className="td">{categoryLabel(p.category)}</td>
                  <td className="td">{p.hero_image_path ? 'Yes' : <span className="text-warn">Missing</span>}</td>
                  <td className="td">{p.floor_area_m2 != null ? `${Number(p.floor_area_m2)} m²` : '—'}</td>
                  <td className="td">{p.starting_budget_usd != null ? `From $${p.starting_budget_usd.toLocaleString('en-US')}` : '—'}</td>
                  <td className="td"><StatusBadge status={p.status === 'archived' ? 'archived' : 'live'} /></td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {tab === 'services' && (
        <Card title="Quote deposit">
          <div className="flex flex-col gap-2" data-testid="tk-deposit-card">
            <p className="text-[13.5px] text-muted m-0">The share of an accepted quote the client pays as a deposit before production. It is fixed on each quote when it is sent. Not part of the 2× fee rule.</p>
            {s.isAdmin ? <DepositSetting current={(depositPct as number | null) ?? null} />
              : <p className="m-0 text-[14px]">{depositPct ? `${depositPct as number}%` : 'Not set yet. An admin sets it.'}</p>}
          </div>
        </Card>
      )}

      {tab === 'services' && (
        <Card title="Services and starting fees">
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Shown as “From $X”. Staff set the exact fee per client on the project page; a fee above 2× the starting fee needs an admin’s approval (not the person who set it).</p>
          <Table head={['Service', 'Starting fee', 'Rule']}>
            {((services ?? []) as TkService[]).map((x) => (
              <tr key={x.code}><td className="td font-semibold">{x.name}</td><td className="td">{servicePrice({ ...x, from_cents: Number(x.from_cents) })}</td><td className="td text-[13.5px]">{x.rule_text ?? '—'}</td></tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'leads' && (
        <Card title="Old leads (read-only)">
            <p className="text-[13.5px] text-muted -mt-1 mb-3">From the retired lead form. Nothing is deleted; each lead was moved into a client project at “Enquiry”.</p>
          <Table head={['Reference', 'Company', 'Project', 'Type', 'Status', 'Sent', 'Client project']}
            empty={<EmptyState title="No old leads" body="Leads from the retired form would be listed here." />}>
            {L.map((l) => (
              <tr key={l.lead_id}>
                <td className="td mono text-sm">{l.reference}</td>
                <td className="td">{l.company_name}<div className="text-[12px] text-muted">{l.country}</div></td>
                <td className="td">{l.turnkey_projects?.title ?? '—'}</td>
                <td className="td">{l.kind === 'interest' ? 'Interest' : 'Quote request'}</td>
                <td className="td"><StatusBadge status={l.status} /></td>
                <td className="td">{fmtDate(l.created_at)}</td>
                <td className="td mono text-sm">{movedTo.get(l.lead_id) ? <Link href={`/admin/turnkey/projects/${movedTo.get(l.lead_id)}`} className="hover:text-coral-text">{movedTo.get(l.lead_id)}</Link> : '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function Dashboard({ d }: { d: TkDashboard }) {
  const k = d.kpi;
  const link = (href: string, text: string) => <Link className="text-coral-text font-semibold" href={href}>{text}</Link>;
  return (
    <>
      {k ? (
        <>
          <section aria-labelledby="tk-kpi-h" className="flex flex-col gap-3">
            <h2 id="tk-kpi-h" className="m-0 text-[17px] font-semibold">Today</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="tk-kpis">
              <div data-testid="tk-kpi-open"><Stat label="Open projects" value={k.open_total.toLocaleString('en-US')}
                hint={k.on_hold ? `${k.on_hold} on hold` : 'None on hold'} /></div>
              <div data-testid="tk-kpi-approvals"><Stat label="Fees waiting for approval" value={k.waiting_approvals.toLocaleString('en-US')}
                hint={k.waiting_approvals ? link('/admin/turnkey/approvals', 'Above 2× the starting fee →') : 'Nothing waiting'} hintTone={k.waiting_approvals ? 'warn' : undefined} /></div>
              <div data-testid="tk-kpi-unpaid"><Stat label="Unpaid proformas" value={k.unpaid_count.toLocaleString('en-US')}
                hint={k.unpaid_count ? <>{money(k.unpaid_cents)} to collect · {link('/admin/turnkey/reports#ageing', 'Ageing →')}</> : 'Everything issued is paid'} /></div>
              <div data-testid="tk-kpi-inspections"><Stat label="Inspections due in 7 days" value={k.inspections_due_7d.toLocaleString('en-US')}
                hint={k.inspections_overdue ? `${k.inspections_overdue} overdue` : k.inspections_to_schedule ? `${k.inspections_to_schedule} to schedule` : k.reports_to_review ? `${k.reports_to_review} reports to review` : 'Nothing overdue'}
                hintTone={k.inspections_overdue ? 'bad' : undefined} /></div>
              <div data-testid="tk-kpi-trips"><Stat label="China visits in 30 days" value={k.trips_upcoming_30d.toLocaleString('en-US')}
                hint={k.trips_requested ? `${k.trips_requested} request${k.trips_requested === 1 ? '' : 's'} waiting for a fee` : 'No requests waiting'} /></div>
              <div data-testid="tk-kpi-enquiries"><Stat label="New enquiries (7 days)" value={k.new_enquiries_7d.toLocaleString('en-US')}
                hint={link('/admin/turnkey/projects?stage=enquiry', 'Reply with the consultation fee →')} /></div>
              <div data-testid="tk-kpi-reviews"><Stat label="Inspection reports to review" value={k.reports_to_review.toLocaleString('en-US')} /></div>
              <div data-testid="tk-kpi-to-schedule"><Stat label="Inspections to schedule" value={k.inspections_to_schedule.toLocaleString('en-US')} /></div>
            </div>
          </section>

          <Card title="Open projects by phase">
            <ol className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" data-testid="tk-dash-phases">
              {TK_PHASES.map((p) => (
                <li key={p.code}>
                  <Link href={`/admin/turnkey/projects?stage=${p.code}&status=open`} data-testid={`tk-dash-phase-${p.code}`}
                    className="min-h-11 px-3 py-2 flex items-center justify-between gap-2 rounded-[10px] border border-line bg-white text-ink hover:border-ink">
                    <span>{p.n}. {p.name}</span><span className="mono font-semibold">{k.open_by_stage[p.code] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Inspections due">
              {k.due_inspections.length === 0 ? <EmptyState title="No inspections due" body="Scheduled inspections for the next 7 days appear here." /> : (
                <ul className="m-0 p-0 list-none flex flex-col gap-2" data-testid="tk-dash-inspections">
                  {k.due_inspections.map((i) => (
                    <li key={`${i.code}-${i.kind}-${i.round}`} className="flex flex-wrap justify-between gap-2 text-[14px]">
                      <Link href={`/admin/turnkey/projects/${i.code}`} className="font-semibold hover:text-coral-text">{i.code} · {inspectionLabel(i.kind, i.round)}</Link>
                      <span className="text-muted">{fmtDate(i.scheduled_on)}{i.status === 'in_progress' ? ' · in progress' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="China visits coming up">
              {k.next_trips.length === 0 ? <EmptyState title="No visits booked" body="Confirmed China visits appear here." /> : (
                <ul className="m-0 p-0 list-none flex flex-col gap-2" data-testid="tk-dash-trips">
                  {k.next_trips.map((t) => (
                    <li key={`${t.code}-${t.start_on}`} className="flex flex-wrap justify-between gap-2 text-[14px]">
                      <Link href={`/admin/turnkey/projects/${t.code}`} className="font-semibold hover:text-coral-text">{t.code} · {t.title}</Link>
                      <span className="text-muted">{fmtDate(t.start_on)} to {fmtDate(t.end_on)} · {t.travellers} traveller{t.travellers === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Notice tone="blue">You see the projects you manage. Company-wide Turnkey numbers are for the Turnkey team.</Notice>
      )}

      <Card title="My projects">
        <Table head={['Project', 'Client', 'Phase', 'Status', 'To pay', 'Updated']}
          empty={<EmptyState title="No projects assigned to you" body="Projects where you are the account manager (or the cover while someone is away) appear here." />}>
          {d.my_projects.map((p) => {
            const st = tkStatus(p.status);
            return (
              <tr key={p.code} data-testid={`tk-my-${p.code}`}>
                <td className="td"><Link href={`/admin/turnkey/projects/${p.code}`} className="font-semibold hover:text-coral-text">{p.title}</Link>
                  <div className="mono text-xs text-muted">{p.code}{p.on_cover ? ' · you are the cover' : ''}</div></td>
                <td className="td text-sm">{p.client ?? <span className="text-warn">Not linked yet</span>}</td>
                <td className="td text-sm">{phaseLabel(p.stage)}</td>
                <td className="td"><StatusBadge status={p.status} label={st.label} tone={st.tone} /></td>
                <td className="td text-sm">{p.unpaid ? `${p.unpaid} unpaid` : '—'}</td>
                <td className="td text-sm text-muted">{fmtDate(p.updated_at)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
