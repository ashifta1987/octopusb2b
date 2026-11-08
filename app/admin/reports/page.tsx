import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table } from '@/components/ui';
import { Bar, CountryTag } from '@/components/admin/ui';
import { ToggleSetting } from '@/components/admin/client';
import { money, humanize, fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { CurrencyTotals, sumByCurrency, rateLabel } from '@/components/admin/currency';
import { setSetting } from '../actions';
import { MailDeliverabilityAlert } from '@/components/admin/mail-deliverability';

export const metadata = { title: 'Reports' };

const SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: 'wallet_enabled', label: 'Wallet', hint: 'Customers top up and pay services from the wallet' },
  { key: 'supplier_portal_enabled', label: 'Supplier portal', hint: 'Suppliers log in and manage their own products' },
  { key: 'ads_enabled', label: 'Advertising', hint: 'Pay-per-click ads on the storefront' },
  { key: 'supplier_sees_contacts_after_paid', label: 'Supplier sees buyer contacts after payment', hint: 'Contacts visibility rule' },
];

const OPEN_RFQ = ['submitted', 'assigned', 'quoting', 'quoted'];
const OPEN_TICKET = ['new', 'open', 'waiting_customer', 'waiting_internal', 'reopened'];

/** Admin → Reports & control (Admin.png). */
export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  const s = await requireStaff('dashboard', 'view', '/admin/reports');
  const { months: m } = await searchParams;
  const months = m === '12' ? 12 : m === '3' ? 3 : 6;
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0); since.setUTCMonth(since.getUTCMonth() - (months - 1));
  const sb = await createClient();

  const [orders, revenue, orgs, liveProducts, openRfqs, openTickets, srs, settings, audit, history, staffRoles, suppliers, ctx] = await Promise.all([
    sb.from('orders').select('id, total_cents, currency, status, created_at, supplier_id, org_id').neq('status', 'cancelled').eq('is_seed', false).limit(5000),
    sb.rpc('admin_revenue_by_stream', { p_from: since.toISOString() }),
    sb.from('organizations').select('id, kyc_status, country').is('archived_at', null).eq('is_seed', false).limit(10000),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live').eq('is_seed', false),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).in('status', OPEN_RFQ).eq('is_seed', false),
    sb.from('tickets').select('id', { count: 'exact', head: true }).in('status', OPEN_TICKET).eq('is_seed', false),
    sb.from('service_requests').select('service_code').eq('is_seed', false).limit(5000),
    sb.from('site_settings').select('key, value').in('key', SWITCHES.map((x) => x.key)),
    can(s, 'audit', 'view') ? sb.from('audit_log').select('id, actor_id, action, entity, entity_id, created_at').order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as never[] }),
    sb.from('status_history').select('id, entity, entity_id, from_status, to_status, actor_id, reason, created_at').order('created_at', { ascending: false }).limit(8),
    can(s, 'staff', 'view') ? sb.from('user_roles').select('user_id, role_code, roles!inner(is_staff)').eq('roles.is_staff', true) : Promise.resolve({ data: [] as never[] }),
    sb.from('suppliers').select('id, code, legal_name, country, is_seed'),
    getCurrencyContext(),
  ]);
  // ADDON-24: one-time banner after the demo wipe, until the first real supplier exists
  const { data: wipeRow } = await sb.from('site_settings').select('value').eq('key', 'demo_wipe').maybeSingle();
  const wipe = wipeRow?.value as { at?: string; by_name?: string | null } | undefined;
  const realSuppliers = (suppliers.data ?? []).filter((x) => !x.is_seed).length;
  const showFirstSupplier = !!wipe?.at && realSuppliers === 0;

  const allOrders = orders.data ?? [];
  const periodOrders = allOrders.filter((o) => new Date(o.created_at) >= since);
  // Amounts are converted into the platform currency at the approved rate for charts; Stat cards also show each currency.
  const conv = (minor: number, currency: string | null) => toPlatform(ctx, minor, currency) ?? 0;
  const gmv = periodOrders.reduce((a, o) => a + conv(Number(o.total_cents), o.currency), 0);
  const gmvBy = sumByCurrency(periodOrders, (o) => o.total_cents, (o) => o.currency);
  const revRows = (revenue.data ?? []) as { month: string; stream: string; net_cents: number; currency: string; net_converted_minor: number }[];
  const byStream = new Map<string, number>();
  revRows.forEach((r) => byStream.set(r.stream, (byStream.get(r.stream) ?? 0) + Number(r.net_converted_minor ?? r.net_cents)));
  const streamBy = new Map<string, Map<string, number>>();
  revRows.forEach((r) => { const m = streamBy.get(r.stream) ?? new Map<string, number>(); m.set(r.currency, (m.get(r.currency) ?? 0) + Number(r.net_cents)); streamBy.set(r.stream, m); });
  const nonOrderBy = sumByCurrency(revRows.filter((r) => r.stream !== 'orders'), (r) => r.net_cents, (r) => r.currency);
  const mixed = [...gmvBy.keys(), ...revRows.map((r) => r.currency)].some((c) => c !== ctx.currency);
  const orgList = orgs.data ?? [];
  const verified = orgList.filter((o) => o.kyc_status === 'verified').length;
  const kycPct = orgList.length ? Math.round((verified / orgList.length) * 100) : 0;
  const setting = new Map((settings.data ?? []).map((r) => [r.key, r.value === true || r.value === 'true']));

  // GMV by month
  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) { const d = new Date(since); d.setUTCMonth(since.getUTCMonth() + i); monthKeys.push(d.toISOString().slice(0, 7)); }
  const gmvByMonth = new Map(monthKeys.map((k) => [k, 0]));
  periodOrders.forEach((o) => { const k = o.created_at.slice(0, 7); if (gmvByMonth.has(k)) gmvByMonth.set(k, (gmvByMonth.get(k) ?? 0) + conv(Number(o.total_cents), o.currency)); });
  const maxMonth = Math.max(1, ...gmvByMonth.values());

  // Service requests by type
  const srCount = new Map<string, number>();
  (srs.data ?? []).forEach((r) => srCount.set(r.service_code, (srCount.get(r.service_code) ?? 0) + 1));
  const srMax = Math.max(1, ...srCount.values());

  // Top destination countries (customers by country)
  const byCountry = new Map<string, number>();
  orgList.forEach((o) => o.country && byCountry.set(o.country, (byCountry.get(o.country) ?? 0) + 1));
  const topCountries = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => COUNTRY_NAMES[c] ?? c);

  // Top suppliers by GMV
  const supMap = new Map((suppliers.data ?? []).map((x) => [x.id, x]));
  const supAgg = new Map<string, { gmv: number; n: number }>();
  periodOrders.forEach((o) => { if (!o.supplier_id) return; const a = supAgg.get(o.supplier_id) ?? { gmv: 0, n: 0 }; a.gmv += conv(Number(o.total_cents), o.currency); a.n++; supAgg.set(o.supplier_id, a); });
  const topSuppliers = [...supAgg.entries()].sort((a, b) => b[1].gmv - a[1].gmv).slice(0, 5);

  // Activity: audit_log + status_history
  const actorIds = new Set<string>();
  (audit.data ?? []).forEach((a: { actor_id: string | null }) => a.actor_id && actorIds.add(a.actor_id));
  (history.data ?? []).forEach((h) => h.actor_id && actorIds.add(h.actor_id));
  const staffIds = new Set(((staffRoles.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const peopleIds = [...new Set([...actorIds, ...staffIds])];
  const { data: people } = peopleIds.length ? await sb.from('profiles').select('id, full_name, email, active').in('id', peopleIds) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const activity = [
    ...((audit.data ?? []) as { id: number; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; created_at: string }[])
      .map((a) => ({ key: `a${a.id}`, at: a.created_at, who: a.actor_id ? name.get(a.actor_id) ?? 'Staff' : 'System', what: `${humanize(a.action.replace('.', ' · '))}${a.entity_id ? ` — ${a.entity_id.slice(0, 40)}` : ''}` })),
    ...(history.data ?? []).map((h) => ({ key: `h${h.id}`, at: h.created_at, who: h.actor_id ? name.get(h.actor_id) ?? 'User' : 'System', what: `${humanize(h.entity)} ${h.from_status ? humanize(h.from_status) + ' → ' : ''}${humanize(h.to_status)}${h.reason ? ` (${h.reason})` : ''}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  const staffList = ((staffRoles.data ?? []) as { user_id: string; role_code: string }[]);
  const staffByUser = new Map<string, string[]>();
  staffList.forEach((r) => staffByUser.set(r.user_id, [...(staffByUser.get(r.user_id) ?? []), r.role_code]));

  return (
    <>
      <MailDeliverabilityAlert />
      {showFirstSupplier && (
        <section className="mb-6 rounded-[14px] border border-coral-text/30 bg-tint px-5 py-4 flex flex-wrap items-center justify-between gap-4" aria-label="Get started">
          <p className="text-[15px] text-coral-text">
            Demo data cleared on <strong>{fmtDate(wipe!.at!)}</strong>{wipe!.by_name ? <> by <strong>{wipe!.by_name}</strong></> : null}. Add your first supplier to get started.
          </p>
          {can(s, 'suppliers', 'create') && <Link href="/admin/suppliers?new=1" className="btn btn-primary">Create first supplier</Link>}
        </section>
      )}
      <PageHeader
        title="Platform overview"
        subtitle={`Figures come from orders, the ledger and live queues. Charts are in ${ctx.currency}${mixed ? `; amounts in other currencies are converted at the approved rate (${rateLabel(ctx)})` : ''}.`}
        actions={
          <form className="flex flex-wrap items-center gap-3" action="/admin/reports">
            <label htmlFor="months" className="text-sm text-muted">Period</label>
            <select id="months" name="months" defaultValue={String(months)} className="input w-auto">
              <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option>
            </select>
            <button className="btn btn-ghost" type="submit">Apply</button>
            {can(s, 'finance', 'export') && <a className="btn btn-ghost" href="/admin/finance/export?type=revenue">Export CSV</a>}
          </form>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 mb-6">
        <Stat label="GMV" value={<CurrencyTotals totals={gmvBy} ctx={ctx} />} hint={`${periodOrders.length} orders`} />
        <Stat label="Platform revenue (non-order)" value={<CurrencyTotals totals={nonOrderBy} ctx={ctx} />} hint="fees, services, ads" />
        <Stat label="Customers" value={orgList.length.toLocaleString()} hint={`${kycPct}% KYC verified`} hintTone={kycPct >= 50 ? 'ok' : 'warn'} />
        <Stat label="KYC verified" value={`${kycPct}%`} hint={`${verified} of ${orgList.length}`} />
        <Stat label="Live products" value={(liveProducts.count ?? 0).toLocaleString()} />
        <Stat label="Open RFQs" value={(openRfqs.count ?? 0).toLocaleString()} hint={<Link className="text-coral-text" href="/office/rfqs">Open queue →</Link>} />
        <Stat label="Tickets open" value={(openTickets.count ?? 0).toLocaleString()} hint={<Link className="text-coral-text" href="/office/support">Support desk →</Link>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] mb-6">
        <Card title="Gross merchandise value by month" action={<span className="text-sm text-muted">{ctx.currency}{mixed ? ' (converted)' : ''}, non-cancelled orders</span>}>
          <div className="px-6 pb-6">
            {gmv === 0 ? <EmptyState title="No orders in this period" /> : (
              <div className="flex items-end gap-3 h-[240px] border-b border-line" role="img" aria-label="GMV by month bar chart">
                {[...gmvByMonth.entries()].map(([k, v], i, arr) => (
                  <div key={k} className="flex-1 flex flex-col items-center justify-end h-full">
                    <div className="text-xs font-semibold mono mb-1">{money(v, ctx.currency, { compact: true })}</div>
                    <div className={`w-full max-w-[56px] rounded-t-md ${i === arr.length - 1 ? 'bg-coral' : 'bg-ink'}`} style={{ height: `${Math.max(2, (v / maxMonth) * 190)}px` }} />
                  </div>
                ))}
              </div>
            )}
            {gmv > 0 && (
              <div className="flex gap-3 mt-2">
                {monthKeys.map((k) => <div key={k} className="flex-1 text-center text-sm text-muted">{new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</div>)}
              </div>
            )}
          </div>
        </Card>
        <Card title="Revenue by stream">
          <div className="px-6 pb-6">
            {byStream.size === 0 ? <EmptyState title="No revenue posted yet" /> : (
              [...byStream.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <Bar key={k} label={humanize(k)} value={v} max={Math.max(...byStream.values())}
                  display={[...(streamBy.get(k) ?? new Map<string, number>())].map(([c, x]) => money(x, c)).join(' · ')} />
              ))
            )}
            <p className="text-xs text-muted mt-3">From ledger revenue accounts grouped by journal stream. Wallet top-ups are customer money, not revenue. Bar length uses the total converted into {ctx.currency}.</p>
            {can(s, 'finance', 'view') && <Link href="/admin/finance" className="text-sm text-coral-text font-semibold mt-2 inline-block">Finance & revenue →</Link>}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Master switches" action={!s.isAdmin && <span className="text-xs text-muted">Admin only</span>}>
          <ul className="px-6 pb-5">
            {SWITCHES.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-4 py-3 border-b border-line last:border-0">
                <div>
                  <div className="font-semibold">{x.label}</div>
                  <div className="text-sm text-muted">{x.hint}</div>
                </div>
                <ToggleSetting checked={setting.get(x.key) ?? false} label={x.label} disabled={!s.isAdmin} showText onToggle={setSetting.bind(null, x.key)} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Service requests by type">
          <div className="px-6 pb-6">
            {srCount.size === 0 ? <EmptyState title="No service requests yet" /> :
              [...srCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <Bar key={k} label={humanize(k)} value={v} max={srMax} display={v} />)}
            <div className="border-t border-line mt-4 pt-4">
              <div className="font-semibold text-sm">Top customer countries</div>
              <div className="text-muted text-sm mt-1">{topCountries.length ? topCountries.join(' · ') : '—'}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Top suppliers" action={can(s, 'suppliers', 'view') && <Link href="/admin/suppliers" className="text-sm text-coral-text font-semibold">Manage →</Link>}>
          <Table head={['Supplier', 'GMV', 'Orders']} empty={<EmptyState title="No supplier orders in this period" />}>
            {topSuppliers.map(([id, a]) => {
              const sp = supMap.get(id);
              return (
                <tr key={id}>
                  <td className="td font-semibold">{sp?.legal_name ?? sp?.code ?? '—'} <CountryTag code={sp?.country} /> <span className="mono text-xs text-muted">{sp?.code}</span></td>
                  <td className="td mono font-semibold">{money(a.gmv, ctx.currency, { compact: true })}{mixed && <span className="block text-[10px] uppercase text-muted font-normal">converted</span>}</td>
                  <td className="td">{a.n}</td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <Card title="Staff and roles" action={can(s, 'staff', 'create') && <Link href="/admin/staff" className="btn btn-primary btn-sm">Add staff</Link>}>
          <Table head={['Name', 'Role', '']} empty={<EmptyState title={can(s, 'staff', 'view') ? 'No staff yet' : 'Staff list needs the Staff & roles permission'} />}>
            {[...staffByUser.entries()].slice(0, 6).map(([uid, roles]) => (
              <tr key={uid}>
                <td className="td font-semibold">{name.get(uid) ?? '—'}</td>
                <td className="td"><span className="flex flex-wrap gap-1">{roles.map((r) => <StatusBadge key={r} status={r} tone="blue" />)}</span></td>
                <td className="td text-right"><Link href={`/admin/staff?user=${uid}`} className="btn btn-ghost btn-sm">Edit</Link></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Recent activity" action={can(s, 'audit', 'view') ? <span className="text-xs text-muted">Audit log + status changes</span> : <span className="text-xs text-muted">Status changes (audit log needs permission)</span>}>
        {activity.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ul className="px-6 pb-5">
            {activity.map((a) => (
              <li key={a.key} className="grid grid-cols-1 sm:grid-cols-[130px_160px_1fr] gap-x-4 gap-y-1 py-3 border-b border-line last:border-0 text-[15px] [overflow-wrap:anywhere]">
                <span className="mono text-xs text-muted pt-0.5">{fmtDate(a.at, true)}</span>
                <span className="font-semibold truncate">{a.who}</span>
                <span className="text-muted">{a.what}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
