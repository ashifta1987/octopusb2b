import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { Card, PageHeader, Stat, Table, StatusBadge, EmptyState } from '@/components/ui';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { LEAD_STATUSES, kUsd } from '@/lib/turnkey/format';
import { LeadControls, RegionSelect, StatusSwitch } from './controls';

export const metadata = { title: 'Turnkey projects' };

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

type Lead = {
  lead_id: string; reference: string; kind: string; project_id: string; status: string; company_name: string; contact_name: string; email: string; phone: string | null;
  country: string; region: string | null; preferred_delivery_term: string | null; delivery_place: string | null; target_open_date: string | null; message: string | null;
  floor_plan_storage_path: string | null; assigned_to: string | null; created_at: string; turnkey_projects: { title: string } | null; turnkey_packages: { tier_name: string } | null;
};

/** Admin → Turnkey (ADDON-31 §5): leads kanban with assignment, projects table, demand signals, sourcing team regions. */
export default async function TurnkeyAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; lead?: string }> }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey');
  const sp = await searchParams;
  const tab = sp.tab === 'projects' || sp.tab === 'signals' ? sp.tab : 'leads';
  const edit = can(s, 'turnkey', 'edit');
  const sb = await createClient();
  const admin = createAdminClient();
  const since = daysAgo(30);
  const [{ data: leads }, { data: projects }, { data: pkgs }, { data: agentRoles }, { data: signals }, { data: settingRow }] = await Promise.all([
    sb.from('turnkey_leads').select('*, turnkey_projects(title), turnkey_packages(tier_name)').order('created_at', { ascending: false }).limit(300),
    sb.from('turnkey_projects').select('project_id, title, status, category, is_starter_pick, starter_rank, starting_budget_usd, sort_rank').order('sort_rank'),
    sb.from('turnkey_packages').select('project_id, is_active'),
    admin.from('user_roles').select('user_id').eq('role_code', 'sourcing_agent'),
    sb.from('turnkey_atlas_signals').select('project_id, hub_id, event, country_from').gte('ts', since).limit(20000),
    sb.from('site_settings').select('value').eq('key', 'turnkey.interest_threshold').maybeSingle(),
  ]);
  const threshold = Number(settingRow?.value ?? 10) || 10;
  const agentIds = (agentRoles ?? []).map((r) => r.user_id as string);
  const { data: agentProfiles } = agentIds.length ? await admin.from('profiles').select('id, full_name, email, region, out_of_office').in('id', agentIds) : { data: [] };
  const agents = ((agentProfiles ?? []) as { id: string; full_name: string | null; email: string | null; region: string | null; out_of_office: boolean | null }[])
    .map((p) => ({ id: p.id, name: p.full_name || p.email || 'Sourcing agent', email: p.email, region: p.region, ooo: !!p.out_of_office }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  const L = (leads ?? []) as unknown as Lead[];
  const interestBy = new Map<string, number>(); const quoteBy = new Map<string, number>();
  L.forEach((l) => (l.kind === 'interest' ? interestBy : quoteBy).set(l.project_id, ((l.kind === 'interest' ? interestBy : quoteBy).get(l.project_id) ?? 0) + 1));
  const pkgBy = new Map<string, number>(); (pkgs ?? []).forEach((k) => { if (k.is_active) pkgBy.set(k.project_id as string, (pkgBy.get(k.project_id as string) ?? 0) + 1); });
  // floor plans: short-lived signed links (private bucket)
  const plans = new Map<string, string>();
  await Promise.all(L.filter((l) => l.floor_plan_storage_path).slice(0, 60).map(async (l) => {
    const { data } = await admin.storage.from('turnkey-floorplans').createSignedUrl(l.floor_plan_storage_path!, 3600);
    if (data?.signedUrl) plans.set(l.lead_id, data.signedUrl);
  }));
  const open = L.filter((l) => !['won', 'lost'].includes(l.status)).length;
  const unassigned = L.filter((l) => !l.assigned_to && !['won', 'lost'].includes(l.status)).length;
  const tabLink = (t: string, label: string) => (
    <Link href={`/admin/turnkey${t === 'leads' ? '' : `?tab=${t}`}`} aria-current={tab === t ? 'page' : undefined}
      className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === t ? 'bg-navy text-white' : 'bg-white border border-line text-navy hover:border-navy'}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="Turnkey projects" subtitle="Quote and interest leads, project catalogue and packages, demand signals. Leads auto-assign by country → region → round-robin among sourcing agents."
        actions={<Link href="/turnkey" className="btn btn-ghost" target="_blank">View /turnkey ↗</Link>} />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Open leads" value={open} hint={`${unassigned} in the triage pool`} hintTone={unassigned ? 'warn' : undefined} />
        <Stat label="Live projects" value={(projects ?? []).filter((p) => p.status === 'live').length} hint={`${(projects ?? []).filter((p) => p.status === 'register-interest').length} register-interest`} />
        <Stat label="Interest signals" value={L.filter((l) => l.kind === 'interest').length} hint={`go-live prompt at ${threshold} per project`} />
        <Stat label="Views (30 days)" value={(signals ?? []).filter((x) => x.event === 'view').length} hint={`${(signals ?? []).filter((x) => x.event === 'tap_hub').length} hub taps`} />
      </div>
      <nav className="flex flex-wrap gap-2 mb-5" aria-label="Turnkey sections">{tabLink('leads', 'Leads')}{tabLink('projects', 'Projects & packages')}{tabLink('signals', 'Signals')}</nav>

      {tab === 'leads' && (
        <>
          <div className="flex gap-4 overflow-x-auto pb-4 mb-6" data-testid="leads-kanban">
            {LEAD_STATUSES.map((st) => {
              const col = L.filter((l) => l.status === st);
              return (
                <section key={st} className="shrink-0 w-[300px] bg-surface rounded-[12px] p-3" aria-label={`${st} leads`}>
                  <h2 className="font-semibold text-sm capitalize mb-2 flex justify-between">{st}<span className="mono text-muted">{col.length}</span></h2>
                  <ul className="space-y-2.5">
                    {col.map((l) => (
                      <li key={l.lead_id} id={`lead-${l.lead_id}`} data-testid="lead-card" data-reference={l.reference}
                        className={`bg-white rounded-[10px] border p-3 text-[13px] ${sp.lead === l.lead_id ? 'border-blue ring-2 ring-blue/30' : 'border-line'}`}>
                        <div className="flex justify-between gap-2"><span className="mono font-semibold">{l.reference}</span><StatusBadge status={l.kind === 'quote' ? 'quote' : 'interest'} label={l.kind} /></div>
                        <div className="font-semibold mt-1">{l.turnkey_projects?.title}{l.turnkey_packages ? ` · ${l.turnkey_packages.tier_name}` : ''}</div>
                        <div>{l.company_name} · {l.contact_name}</div>
                        <div className="text-muted break-all"><a href={`mailto:${l.email}`} className="text-blue">{l.email}</a>{l.phone ? ` · ${l.phone}` : ''}</div>
                        <div className="text-muted">{COUNTRY_NAMES[l.country] ?? l.country}{l.region ? ` · ${l.region}` : ''}{l.preferred_delivery_term ? ` · ${l.preferred_delivery_term}${l.delivery_place ? ` ${l.delivery_place}` : ''}` : ''}{l.target_open_date ? ` · open ${fmtDate(l.target_open_date)}` : ''}</div>
                        {l.message && <p className="mt-1 text-[12.5px] whitespace-pre-wrap line-clamp-4">{l.message}</p>}
                        {plans.get(l.lead_id) && <a href={plans.get(l.lead_id)} target="_blank" rel="noopener noreferrer" className="text-blue font-semibold text-[12.5px]">Floor plan ↗</a>}
                        <div className="text-[11.5px] text-muted mt-1">{fmtDate(l.created_at, true)} · {l.assigned_to ? `assigned to ${nameOf.get(l.assigned_to) ?? 'staff'}` : <b className="text-warn">triage pool</b>}</div>
                        {edit && <LeadControls leadId={l.lead_id} status={l.status} assignedTo={l.assigned_to} agents={agents} />}
                      </li>
                    ))}
                    {!col.length && <li className="text-[12.5px] text-muted px-1">None</li>}
                  </ul>
                </section>
              );
            })}
          </div>
          <Card title="Sourcing team · lead regions">
            <div className="px-6 pb-6 text-sm">
              <p className="text-muted mb-3">New leads go to a sourcing agent whose region matches the buyer&apos;s country (round-robin). With no match the lead waits in the triage pool and every Admin is notified.</p>
              {agents.length ? (
                <Table head={['Agent', 'Email', 'Region', 'Status']}>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td className="td font-semibold">{a.name}</td><td className="td text-muted">{a.email}</td>
                      <td className="td">{edit ? <RegionSelect userId={a.id} region={a.region} /> : a.region ?? '—'}</td>
                      <td className="td">{a.ooo ? <StatusBadge status="away" label="Out of office" /> : <StatusBadge status="active" label="Taking leads" />}</td>
                    </tr>
                  ))}
                </Table>
              ) : <EmptyState title="No sourcing agents yet" body="Add staff with the Sourcing agent role in Staff & roles, then give each a region here." />}
            </div>
          </Card>
        </>
      )}

      {tab === 'projects' && (
        <Card title="Projects" action={edit ? <Link href="/admin/turnkey/new" className="btn btn-primary btn-sm">Add project</Link> : undefined}>
          <Table head={['Project', 'Status', 'Starter pick', 'From', 'Interest', 'Quote leads', 'Packages', '']}>
            {(projects ?? []).map((p) => {
              const interest = interestBy.get(p.project_id as string) ?? 0;
              return (
                <tr key={p.project_id as string} data-testid="project-row" data-project={p.project_id as string}>
                  <td className="td"><Link href={`/admin/turnkey/${p.project_id}`} className="font-semibold text-blue hover:underline">{p.title as string}</Link><div className="mono text-xs text-muted">{p.project_id as string}</div></td>
                  <td className="td">{edit ? <StatusSwitch projectId={p.project_id as string} status={p.status as string} /> : <StatusBadge status={p.status as string} />}</td>
                  <td className="td mono">{p.is_starter_pick ? `#${p.starter_rank}` : '—'}</td>
                  <td className="td mono text-sm">{kUsd(p.starting_budget_usd as number | null) ?? '—'}</td>
                  <td className="td mono">{interest}{p.status === 'register-interest' && interest >= threshold && <div className="text-xs text-ok font-semibold">Ready to build packages</div>}</td>
                  <td className="td mono">{quoteBy.get(p.project_id as string) ?? 0}</td>
                  <td className="td mono">{pkgBy.get(p.project_id as string) ?? 0}</td>
                  <td className="td"><Link href={`/turnkey/${p.project_id}`} target="_blank" className="text-sm text-blue">View ↗</Link></td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {tab === 'signals' && <Signals signals={(signals ?? []) as { project_id: string | null; hub_id: string | null; event: string; country_from: string | null }[]} projects={(projects ?? []) as { project_id: string; title: string }[]} leads={L} />}
    </>
  );
}

function Signals({ signals, projects, leads }: { signals: { project_id: string | null; hub_id: string | null; event: string; country_from: string | null }[]; projects: { project_id: string; title: string }[]; leads: Lead[] }) {
  const title = new Map(projects.map((p) => [p.project_id, p.title]));
  const tally = (xs: (string | null)[]) => { const m = new Map<string, number>(); xs.forEach((x) => x && m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const views = tally(signals.filter((s) => s.event === 'view').map((s) => s.project_id));
  const taps = tally(signals.filter((s) => s.event === 'tap_hub').map((s) => s.hub_id));
  const countries = tally([...signals.map((s) => s.country_from), ...leads.map((l) => l.country)]);
  const interest = tally(leads.filter((l) => l.kind === 'interest').map((l) => l.project_id));
  const list = (rows: [string, number][], label: (k: string) => string) => rows.length
    ? <ol className="px-6 pb-6 space-y-1.5 text-sm">{rows.slice(0, 15).map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span>{label(k)}</span><span className="mono font-semibold">{n}</span></li>)}</ol>
    : <p className="px-6 pb-6 text-sm text-muted">No data in the last 30 days.</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Most viewed projects (30 days)">{list(views, (k) => title.get(k) ?? k)}</Card>
      <Card title="Interest by project (all time)">{list(interest, (k) => title.get(k) ?? k)}</Card>
      <Card title="Hub taps on the Atlas (30 days)">{list(taps, (k) => k)}</Card>
      <Card title="Buyer countries (signals + leads)">{list(countries, (k) => COUNTRY_NAMES[k] ?? k)}</Card>
    </div>
  );
}
