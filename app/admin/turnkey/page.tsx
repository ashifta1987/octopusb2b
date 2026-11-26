import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, StatusBadge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { categoryLabel, servicePrice, type TkService } from '@/lib/turnkey/format';
import { getDivisionScope } from '@/lib/divisions/scope';
import { ImportClient } from './import-client';

export const metadata = { title: 'Turnkey projects' };

type Project = { project_id: string; title: string; category: string; status: string; starting_budget_usd: number | null; hero_image_path: string | null; floor_area_m2: number | null; sort_rank: number };
type Lead = { lead_id: string; reference: string; kind: string; status: string; company_name: string; country: string; created_at: string; turnkey_projects: { title: string } | null };

/**
 * Admin › Turnkey (T0–T2, design docs/design/turnkey-v2): catalogue + CSV import of the project sheet, the services
 * price list, the old leads (read-only; T2 moved each one into a client project at "Enquiry") and a link to the client
 * projects (/admin/turnkey/projects). The ADDON-31 editors are retired.
 */
export default async function TurnkeyAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey');
  const scope = await getDivisionScope(s);
  const sp = await searchParams;
  const tab = sp.tab === 'services' || sp.tab === 'leads' ? sp.tab : 'catalogue';
  const edit = can(s, 'turnkey', 'edit');
  const sb = await createClient();
  const PROJECT_COLS = 'project_id, title, category, status, starting_budget_usd, hero_image_path, floor_area_m2, sort_rank';
  const LEAD_COLS = 'lead_id, reference, kind, status, company_name, country, created_at, turnkey_projects(title)';
  const [{ data: projects }, { data: services }, { data: leads }, { data: moved }] = await Promise.all([
    (scope.all ? sb.from('turnkey_projects').select(PROJECT_COLS) : sb.from('turnkey_projects').select(PROJECT_COLS).eq('division_id', scope.division.id)).order('sort_rank').order('title'),
    sb.from('tk_services').select('code, name, from_cents, unit, approx, rule_text, group_code, photo_path, sort').order('sort'),
    (scope.all ? sb.from('turnkey_leads').select(LEAD_COLS) : sb.from('turnkey_leads').select(LEAD_COLS).eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(300),
    tab === 'leads' ? sb.from('tk_client_project_staff').select('legacy_lead_id, tk_client_projects(code)').not('legacy_lead_id', 'is', null).limit(1000) : Promise.resolve({ data: [] }),
  ]);
  const movedTo = new Map(((moved ?? []) as unknown as { legacy_lead_id: string; tk_client_projects: { code: string } | null }[]).map((m) => [m.legacy_lead_id, m.tk_client_projects?.code ?? null]));
  const P = (projects ?? []) as Project[];
  const L = (leads ?? []) as unknown as Lead[];
  const tabs: [string, string][] = [['catalogue', `Catalogue (${P.length})`], ['services', 'Services and fees'], ['leads', `Old leads (${L.length})`]];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Turnkey projects" subtitle="The public catalogue, the services price list and the old lead list. Every price is shown to clients as a starting price." />
      <nav aria-label="Turnkey sections" className="flex gap-2 flex-wrap">
        {tabs.map(([k, label]) => (
          <a key={k} href={`/admin/turnkey?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
            className={`min-h-11 px-4 inline-flex items-center rounded-[10px] border ${tab === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-ink'}`}>{label}</a>
        ))}
        <Link href="/admin/turnkey/projects" className="min-h-11 px-4 inline-flex items-center rounded-[10px] border bg-white border-line text-ink hover:border-ink font-semibold" data-testid="tk-admin-client-projects">Client projects →</Link>
      </nav>

      {tab === 'catalogue' && (
        <>
          {edit && <ImportClient />}
          <Card title="Projects">
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Clients see every project that isn’t archived.</p>
            <Table head={['Project', 'Category', 'Photo', 'Space', 'From', 'Status']}>
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
        <Card title="Services and starting fees">
            <p className="text-[13.5px] text-muted -mt-1 mb-3">Shown as “From $X”. Staff set the exact fee per client; a fee above 2× the starting fee needs admin approval (with the project screens).</p>
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
          <Table head={['Reference', 'Company', 'Project', 'Type', 'Status', 'Sent', 'Client project']}>
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
