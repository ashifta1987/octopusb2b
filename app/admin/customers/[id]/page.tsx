import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { ToggleSetting } from '@/components/admin/client';
import { loadAssistantSettings, loadWorkload } from '@/components/admin/assistant/data';
import { ReassignButton } from '@/components/admin/assistant/reassign-form';
import { COUNTRY_NAMES, fmtDate, humanize } from '@/lib/format';
import { setVip } from '../actions';

export const metadata = { title: 'Customer' };

/** Customer detail with the dedicated account-manager card (reassign with reason) and the VIP flag (SPEC §20.3). */
export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('customers', 'view', `/admin/customers/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const { data: org } = await sb.from('organizations').select('id, name, buyer_code, country, city, business_type, registration_no, website, kyc_status, created_at').eq('id', id).maybeSingle();
  if (!org) notFound();
  const canReassign = s.isAdmin || can(s, 'assistant', 'reassign');
  const path = `/admin/customers/${id}`;

  const [{ data: members }, { data: am }, settings, { count: orders }, { count: rfqs }, { count: tickets }, { data: sessions }, { data: history }, workload] = await Promise.all([
    sb.from('org_members').select('user_id, member_role, created_at').eq('org_id', id).order('created_at'),
    sb.from('account_managers').select('staff_user_id, team, assigned_at, assigned_by, reason').eq('org_id', id).maybeSingle(),
    loadAssistantSettings(sb),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', id),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', id),
    sb.from('tickets').select('id', { count: 'exact', head: true }).eq('org_id', id),
    sb.from('assistant_sessions').select('id, title, status, last_message_at, escalation_id').eq('org_id', id).order('last_message_at', { ascending: false }).limit(5),
    sb.from('audit_log').select('id, actor_id, action, details, created_at').eq('entity', 'organizations').eq('entity_id', id).like('action', 'assistant.%').order('created_at', { ascending: false }).limit(10),
    canReassign ? loadWorkload(sb) : Promise.resolve([]),
  ]);
  const ids = [...new Set([...(members ?? []).map((m) => m.user_id as string), am?.staff_user_id, am?.assigned_by, ...(history ?? []).map((h) => h.actor_id), ...(history ?? []).map((h) => (h.details as { staff?: string } | null)?.staff)].filter(Boolean))] as string[];
  const { data: ppl } = ids.length ? await sb.from('profiles').select('id, full_name, email, phone, title, team, office, out_of_office').in('id', ids) : { data: [] };
  const P = new Map((ppl ?? []).map((p) => [p.id as string, p]));
  const name = (uid: string | null | undefined) => (uid ? ((P.get(uid)?.full_name as string | undefined) ?? 'Staff') : 'System');
  const mgr = am ? P.get(am.staff_user_id as string) : undefined;
  const isVip = settings.vip.includes(id);
  const mgrLoad = am ? workload.find((w) => w.id === am.staff_user_id)?.customers : undefined;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/customers" className="text-blue">← Customers</Link>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{org.name as string}{isVip && <StatusBadge status="vip" label="VIP" tone="blue" />}</span>}
        subtitle={<span className="mono">{(org.buyer_code as string | null) ?? '—'} · {COUNTRY_NAMES[org.country as string] ?? org.country ?? '—'}{org.city ? ` · ${org.city}` : ''}</span>}
      />
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Stat label="Orders" value={orders ?? 0} />
        <Stat label="RFQs" value={rfqs ?? 0} />
        <Stat label="Support tickets" value={tickets ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6 min-w-0">
          <Card title="Company">
            <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Legal name</dt><dd className="font-semibold">{org.name as string}</dd>
              <dt className="text-muted">Buyer code</dt><dd className="mono">{(org.buyer_code as string | null) ?? '—'}</dd>
              <dt className="text-muted">Country</dt><dd>{COUNTRY_NAMES[org.country as string] ?? org.country ?? '—'} {org.country ? `(${org.country})` : ''}</dd>
              <dt className="text-muted">City</dt><dd>{(org.city as string | null) ?? '—'}</dd>
              <dt className="text-muted">Business type</dt><dd>{humanize(org.business_type as string | null) || '—'}</dd>
              <dt className="text-muted">Registration no.</dt><dd className="mono">{(org.registration_no as string | null) ?? '—'}</dd>
              <dt className="text-muted">Website</dt><dd className="break-all">{(org.website as string | null) ?? '—'}</dd>
              <dt className="text-muted">KYC</dt><dd><StatusBadge status={org.kyc_status as string} /> {can(s, 'customers', 'view') && <Link href="/office/kyc" className="text-blue text-xs ml-2">KYC review</Link>}</dd>
              <dt className="text-muted">Customer since</dt><dd>{fmtDate(org.created_at as string)}</dd>
            </dl>
          </Card>

          <Card title="Members">
            {(members ?? []).length === 0 ? <EmptyState title="No members" /> : (
              <ul className="divide-y divide-line">
                {(members ?? []).map((m) => {
                  const p = P.get(m.user_id as string);
                  return (
                    <li key={m.user_id as string} className="py-2.5 flex flex-wrap justify-between gap-2 text-sm">
                      <span><span className="font-semibold">{(p?.full_name as string | undefined) ?? 'User'}</span>{p?.email ? <span className="text-muted"> · {p.email as string}</span> : null}</span>
                      <span className="text-muted">{humanize(m.member_role as string)} · joined {fmtDate(m.created_at as string)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Assistant conversations" action={can(s, 'assistant', 'view') ? <Link href="/office/assistant" className="text-sm text-blue">Assistant queue</Link> : undefined}>
            {(sessions ?? []).length === 0 ? <EmptyState title="No conversations visible" body="Only the account manager, the team queue and supervisors can read a customer's assistant history." /> : (
              <ul className="divide-y divide-line">
                {(sessions ?? []).map((x) => (
                  <li key={x.id as string} className="py-2.5 flex flex-wrap justify-between gap-2 text-sm">
                    {can(s, 'assistant', 'view') ? <Link className="font-semibold text-blue" href={`/office/assistant?session=${x.id}`}>{(x.title as string | null) ?? 'Conversation'}</Link> : <span className="font-semibold">{(x.title as string | null) ?? 'Conversation'}</span>}
                    <span className="flex items-center gap-2"><StatusBadge status={x.status as string} label={humanize(x.status as string)} tone={x.status === 'escalated' ? 'amber' : x.status === 'human' ? 'green' : x.status === 'closed' ? 'gray' : 'blue'} /><span className="text-muted">{fmtDate(x.last_message_at as string, true)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 min-w-0">
          <Card title="Account manager" action={canReassign ? (
            <ReassignButton orgId={id} orgName={org.name as string} currentStaffId={(am?.staff_user_id as string | undefined) ?? null} candidates={workload} cap={settings.cap} path={path}
              label={am ? 'Reassign' : 'Assign'} />
          ) : undefined}>
            {am ? (
              <div className="text-sm space-y-1.5">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="w-10 h-10 rounded-full bg-ok text-white grid place-items-center font-bold">{((mgr?.full_name as string | undefined) ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <div>
                    <div className="font-semibold">{name(am.staff_user_id as string)}</div>
                    <div className="text-muted text-xs">{(mgr?.title as string | undefined) ?? 'Dedicated account manager'}{am.team ? ` · ${am.team} team` : ''}{mgr?.office ? ` · ${mgr.office}` : ''}</div>
                  </div>
                </div>
                {mgr?.out_of_office && <div><StatusBadge status="ooo" label="Out of office — team queue covers" tone="amber" /></div>}
                {mgr?.email && <div><span className="text-muted">Email</span> {mgr.email as string}</div>}
                <div><span className="text-muted">Assigned</span> {fmtDate(am.assigned_at as string, true)} by {name(am.assigned_by as string | null)}</div>
                {am.reason && <div><span className="text-muted">Reason</span> {humanize(am.reason as string)}</div>}
                {mgrLoad != null && <div><span className="text-muted">Load</span> {mgrLoad}/{settings.cap} customers</div>}
              </div>
            ) : <EmptyState title="No account manager yet" body="Assigned automatically on KYC verification, or assign one now." />}
            {!canReassign && <p className="text-xs text-muted mt-3">Only an Admin or a supervisor with Assistant · reassign can change this.</p>}
          </Card>

          <Card title="VIP">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">VIP customers are always routed to their human account manager.</p>
              {s.isAdmin ? <ToggleSetting checked={isVip} label="VIP customer" onToggle={setVip.bind(null, id)} showText /> : <span className="text-sm font-semibold">{isVip ? 'VIP' : 'Not VIP'}</span>}
            </div>
            {!s.isAdmin && <p className="text-xs text-muted mt-2">Admin only.</p>}
          </Card>

          <Card title="Assignment history">
            {(history ?? []).length === 0 ? <p className="text-sm text-muted">{can(s, 'audit', 'view') ? 'No changes logged yet.' : 'Audit log is visible to Admins.'}</p> : (
              <ol className="space-y-2 text-sm">
                {(history ?? []).map((h) => {
                  const d = (h.details ?? {}) as { staff?: string; reason?: string; team?: string };
                  return (
                    <li key={h.id as string}>
                      <div className="font-semibold">{h.action === 'assistant.reassigned' ? 'Reassigned' : 'Assigned'} to {name(d.staff)}</div>
                      <div className="text-xs text-muted">{fmtDate(h.created_at as string, true)} · by {name(h.actor_id as string | null)}{d.reason ? ` · ${humanize(d.reason)}` : ''}</div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
