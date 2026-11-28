/**
 * ODS T9 · /admin/turnkey (Turnkey home) — presentational view. Tabs exactly as today (?tab= dashboard | catalogue | services
 * | leads). Data comes from the page (today's queries) or a fixture. Interactive parts are TODAY's client components:
 * ImportClient (tk_import_catalogue, turnkey:edit) and DepositSetting (setDepositPctAction, admin).
 */
import type { ReactNode } from 'react';
import { EmptyState, StatusPill, formatDate } from '@octopus/ui';
import { categoryLabel, inspectionLabel, phaseLabel, servicePrice, type TkService } from '@/lib/turnkey/format';
import type { TkDashboard } from '@/lib/turnkey/reports';
import { ImportClient } from '@/app/admin/turnkey/import-client';
import { DepositSetting } from '@/components/turnkey/quote-staff';
import { TK_PHASES, kpiItems, tkStatus, type OverviewTab } from '../_lib/turnkey-logic';
import { A, LoadError, Note, Panel, SimpleTable, TkPill, TurnkeyHead } from './tk-ui';

export type CatalogueRow = { project_id: string; title: string; category: string; status: string; starting_budget_usd: number | null; hero_image_path: string | null; floor_area_m2: number | null };
export type LeadRow = { lead_id: string; reference: string; kind: string; status: string; company_name: string; country: string; created_at: string; turnkey_projects: { title: string } | null };

export type OverviewViewProps = {
  tab: OverviewTab;
  isAdmin: boolean;
  edit: boolean;
  dashboard?: TkDashboard | null;
  catalogue?: CatalogueRow[] | null;
  services?: TkService[] | null;
  depositPct?: number | null;
  leads?: LeadRow[] | null;
  movedTo?: Record<string, string | null>;
  money: (cents: number) => string;
  /** fixtures: links stay on the fixture */
  sample?: boolean;
};

const SUBTITLE: Record<OverviewTab, string> = {
  dashboard: 'Your Turnkey home: what needs attention today. Every number comes from the projects, fees and invoices themselves.',
  catalogue: 'The public catalogue. Clients see every project that isn’t archived.',
  services: 'Every price is shown to clients as a starting price.',
  leads: 'The old lead list (read-only).',
};

export function OverviewView(p: OverviewViewProps) {
  return (
    <div className="grid gap-4" data-testid="tk-overview">
      <TurnkeyHead title="Turnkey" subtitle={SUBTITLE[p.tab]} current={p.tab} isAdmin={p.isAdmin} />
      {p.tab === 'dashboard' ? (p.dashboard ? <Dashboard d={p.dashboard} money={p.money} /> : <LoadError what="the dashboard" />) : null}
      {p.tab === 'catalogue' ? <Catalogue rows={p.catalogue ?? null} edit={p.edit} sample={p.sample} /> : null}
      {p.tab === 'services' ? <Services services={p.services ?? null} depositPct={p.depositPct ?? null} isAdmin={p.isAdmin} /> : null}
      {p.tab === 'leads' ? <Leads rows={p.leads ?? null} movedTo={p.movedTo ?? {}} /> : null}
    </div>
  );
}

function Dashboard({ d, money }: { d: TkDashboard; money: (c: number) => string }) {
  const k = d.kpi;
  return (
    <>
      {k ? (
        <>
          <section aria-labelledby="tk-kpi-h" className="grid gap-2">
            <h2 id="tk-kpi-h" className="m-0 text-ods-h2 font-semibold text-ods-navy">Today</h2>
            <dl className="m-0 grid grid-cols-2 gap-2 ods-tablet:grid-cols-4" data-testid="tk-kpis">
              {kpiItems(k, money).map((t) => (
                <div key={t.id} className="flex flex-col gap-0.5 rounded-ods-card border border-ods-line bg-ods-surface p-3" data-testid={t.testid}>
                  <dt className="text-ods-small text-ods-slate">{t.label}</dt>
                  <dd className="m-0 text-ods-h2 font-bold tabular-nums text-ods-navy">{t.value}</dd>
                  {t.hint ? (
                    <dd className={`m-0 text-ods-small ${t.tone === 'bad' ? 'font-semibold text-ods-danger' : t.tone === 'warn' ? 'font-semibold text-ods-warning' : 'text-ods-slate'}`}>
                      {t.hintHref ? <A href={t.hintHref}>{t.hint} →</A> : t.hint}
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
          </section>
          <Panel title="Open projects by phase">
            <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4" data-testid="tk-dash-phases">
              {TK_PHASES.map((ph) => (
                <li key={ph.code}>
                  <a href={`/admin/turnkey/projects?stage=${ph.code}&status=open`} data-testid={`tk-dash-phase-${ph.code}`} className="flex min-h-ods-control items-center justify-between gap-2 rounded-ods-control border border-ods-line bg-ods-surface px-3 text-ods-body text-ods-text no-underline hover:border-ods-navy">
                    <span>{ph.n}. {ph.name}</span><span className="font-semibold tabular-nums">{k.open_by_stage[ph.code] ?? 0}</span>
                  </a>
                </li>
              ))}
            </ol>
          </Panel>
          <div className="grid gap-4 ods-desktop:grid-cols-2">
            <Panel title="Inspections due">
              {k.due_inspections.length === 0 ? <EmptyState title="No inspections due" description="Scheduled inspections for the next 7 days appear here." headingLevel={3} /> : (
                <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="tk-dash-inspections">
                  {k.due_inspections.map((i) => (
                    <li key={`${i.code}-${i.kind}-${i.round}`} className="flex flex-wrap justify-between gap-2 text-ods-table">
                      <A href={`/admin/turnkey/projects/${i.code}`}>{i.code} · {inspectionLabel(i.kind, i.round)}</A>
                      <span className="text-ods-slate">{formatDate(i.scheduled_on)}{i.status === 'in_progress' ? ' · in progress' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="China visits coming up">
              {k.next_trips.length === 0 ? <EmptyState title="No visits booked" description="Confirmed China visits appear here." headingLevel={3} /> : (
                <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="tk-dash-trips">
                  {k.next_trips.map((t) => (
                    <li key={`${t.code}-${t.start_on}`} className="flex flex-wrap justify-between gap-2 text-ods-table">
                      <A href={`/admin/turnkey/projects/${t.code}`}>{t.code} · {t.title}</A>
                      <span className="text-ods-slate">{formatDate(t.start_on)} to {formatDate(t.end_on)} · {t.travellers} traveller{t.travellers === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <Note>You see the projects you manage. Company-wide Turnkey numbers are for the Turnkey team.</Note>
      )}
      <Panel title="My projects">
        <SimpleTable
          caption="My projects"
          head={['Project', 'Client', 'Phase', 'Status', 'To pay', 'Updated']}
          empty={<EmptyState title="No projects assigned to you" description="Projects where you are the account manager (or the cover while someone is away) appear here." headingLevel={3} />}
          rows={d.my_projects.map((pr) => {
            const st = tkStatus(pr.status);
            return {
              key: pr.code,
              testId: `tk-my-${pr.code}`,
              cells: [
                <span key="p" className="flex flex-col"><A href={`/admin/turnkey/projects/${pr.code}`}>{pr.title}</A><span className="font-mono text-ods-small text-ods-slate">{pr.code}{pr.on_cover ? ' · you are the cover' : ''}</span></span>,
                pr.client ?? <span key="c" className="text-ods-warning">Not linked yet</span>,
                phaseLabel(pr.stage),
                <TkPill key="s" label={st.label} tone={st.tone} />,
                pr.unpaid ? `${pr.unpaid} unpaid` : '—',
                <span key="u" className="text-ods-slate">{formatDate(pr.updated_at)}</span>,
              ],
            };
          })}
        />
      </Panel>
    </>
  );
}

function Catalogue({ rows, edit, sample }: { rows: CatalogueRow[] | null; edit: boolean; sample?: boolean }) {
  return (
    <>
      {edit && !sample ? <div data-testid="tk-import-wrap"><ImportClient /></div> : null}
      {edit && sample ? <Note>Import the project sheet (CSV): today&apos;s import tool shows here for Turnkey editors (preview → tick → import).</Note> : null}
      <Panel title="Projects" description="Clients see every project that isn’t archived." error={rows === null ? <LoadError what="the catalogue" /> : undefined}>
        {rows ? (
          <SimpleTable
            caption="Catalogue projects"
            head={['Project', 'Category', 'Photo', 'Space', 'From', 'Status']}
            empty={<EmptyState title="No catalogue projects yet" description="Import the project sheet above to fill the catalogue." headingLevel={3} />}
            rows={rows.map((c) => ({
              key: c.project_id,
              cells: [
                <span key="t" className="flex flex-col"><b className="text-ods-navy">{c.title}</b><span className="font-mono text-ods-small text-ods-slate">{c.project_id}</span></span>,
                categoryLabel(c.category),
                c.hero_image_path ? 'Yes' : <span key="m" className="text-ods-warning">Missing</span>,
                c.floor_area_m2 != null ? `${Number(c.floor_area_m2)} m²` : '—',
                c.starting_budget_usd != null ? `From $${c.starting_budget_usd.toLocaleString('en-US')}` : '—',
                <StatusPill key="s" tone={c.status === 'archived' ? 'neutral' : 'success'}>{c.status === 'archived' ? 'Archived' : 'Live'}</StatusPill>,
              ],
            }))}
          />
        ) : null}
      </Panel>
    </>
  );
}

function Services({ services, depositPct, isAdmin }: { services: TkService[] | null; depositPct: number | null; isAdmin: boolean }) {
  return (
    <>
      <Panel title="Quote deposit" testId="tk-deposit-card" description="The share of an accepted quote the client pays as a deposit before production. It is fixed on each quote when it is sent. Not part of the 2× fee rule.">
        {isAdmin ? <DepositSetting current={depositPct} /> : <p className="m-0 text-ods-body">{depositPct ? `${depositPct}%` : 'Not set yet. An admin sets it.'}</p>}
      </Panel>
      <Panel title="Services and starting fees" description="Shown as “From $X”. Staff set the exact fee per client on the project page; a fee above 2× the starting fee needs an admin’s approval (not the person who set it)." error={services === null ? <LoadError what="the services" /> : undefined}>
        {services ? (
          <SimpleTable caption="Services and starting fees" head={['Service', 'Starting fee', 'Rule']} rows={services.map((x) => ({ key: x.code, cells: [<b key="n" className="text-ods-navy">{x.name}</b>, servicePrice({ ...x, from_cents: Number(x.from_cents) }), x.rule_text ?? '—'] }))} />
        ) : null}
      </Panel>
    </>
  );
}

function Leads({ rows, movedTo }: { rows: LeadRow[] | null; movedTo: Record<string, string | null> }) {
  return (
    <Panel title="Old leads (read-only)" description="From the retired lead form. Nothing is deleted; each lead was moved into a client project at “Enquiry”." error={rows === null ? <LoadError what="the old leads" /> : undefined}>
      {rows ? (
        <SimpleTable
          caption="Old leads"
          head={['Reference', 'Company', 'Project', 'Type', 'Status', 'Sent', 'Client project']}
          empty={<EmptyState title="No old leads" description="Leads from the retired form would be listed here." headingLevel={3} />}
          rows={rows.map((l) => ({
            key: l.lead_id,
            cells: [
              <span key="r" className="font-mono">{l.reference}</span>,
              <span key="c" className="flex flex-col">{l.company_name}<span className="text-ods-small text-ods-slate">{l.country}</span></span>,
              l.turnkey_projects?.title ?? '—',
              l.kind === 'interest' ? 'Interest' : 'Quote request',
              <StatusPill key="s" tone="neutral">{l.status}</StatusPill>,
              formatDate(l.created_at),
              movedTo[l.lead_id] ? <A key="m" href={`/admin/turnkey/projects/${movedTo[l.lead_id]}`}>{movedTo[l.lead_id] as ReactNode}</A> : '—',
            ],
          }))}
        />
      ) : null}
    </Panel>
  );
}
