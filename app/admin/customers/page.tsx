import Link from 'next/link';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EmptyState, PageHeader, StatusBadge, Table } from '@/components/ui';
import { CountryTag } from '@/components/admin/ui';
import { loadAssistantSettings } from '@/components/admin/assistant/data';
import { COUNTRY_NAMES, fmtDate, humanize } from '@/lib/format';

export const metadata = { title: 'Customers' };

const KYC = ['all', 'verified', 'in_review', 'submitted', 'more_info', 'rejected', 'not_started'] as const;

/** Customers (orgs) with buyer code, country, KYC, dedicated account manager and VIP flag (SPEC §20.3). */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string; vip?: string }> }) {
  await requireStaffOrManager('/admin/customers', ['customers', 'view']); // managers see only their own customers (RLS)
  const { q = '', kyc = 'all', vip } = await searchParams;
  const sb = await createClient();
  let query = sb.from('organizations').select('id, name, buyer_code, country, city, kyc_status, created_at').is('archived_at', null).order('created_at', { ascending: false }).limit(300);
  const term = q.trim().replace(/[%,()*]/g, ' ').slice(0, 60);
  if (term) query = query.or(`name.ilike.%${term}%,buyer_code.ilike.%${term}%,country.ilike.%${term}%`);
  if (kyc !== 'all' && (KYC as readonly string[]).includes(kyc)) query = query.eq('kyc_status', kyc);
  const [{ data: orgs }, { data: ams }, settings] = await Promise.all([
    query,
    sb.from('account_managers').select('org_id, staff_user_id, team, assigned_at'),
    loadAssistantSettings(sb),
  ]);
  const staffIds = [...new Set((ams ?? []).map((a) => a.staff_user_id as string))];
  const { data: ppl } = staffIds.length ? await sb.from('profiles').select('id, full_name, out_of_office').in('id', staffIds) : { data: [] };
  const amBy = new Map((ams ?? []).map((a) => [a.org_id as string, a]));
  const person = new Map((ppl ?? []).map((p) => [p.id as string, p]));
  const vipSet = new Set(settings.vip);
  const rows = (orgs ?? []).filter((o) => (vip === '1' ? vipSet.has(o.id as string) : true));
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: q || undefined, kyc: kyc !== 'all' ? kyc : undefined, vip, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/customers?${s}` : '/admin/customers';
  };

  return (
    <>
      <PageHeader title="Customers" subtitle="Customer organisations, KYC status and their dedicated account manager." />
      <form className="card p-4 mb-6 flex flex-wrap items-end gap-3" action="/admin/customers" role="search">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="c-q" className="label">Search</label>
          <input id="c-q" name="q" defaultValue={q} className="input" placeholder="Name, buyer code or country" />
        </div>
        <div>
          <label htmlFor="c-kyc" className="label">KYC</label>
          <select id="c-kyc" name="kyc" defaultValue={kyc} className="input">
            {KYC.map((k) => <option key={k} value={k}>{k === 'all' ? 'All' : humanize(k)}</option>)}
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-semibold h-11">
          <input type="checkbox" name="vip" value="1" defaultChecked={vip === '1'} /> VIP only
        </label>
        <button type="submit" className="btn btn-dark">Filter</button>
        {(q || kyc !== 'all' || vip) && <Link href="/admin/customers" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="card overflow-hidden">
      <Table
        head={['Customer', 'Buyer code', 'Country', 'KYC', 'Account manager', 'VIP', 'Since']}
        empty={<EmptyState title="No customers found" body={q ? 'Try a different search.' : 'Customers appear here after onboarding.'} />}
      >
        {rows.map((o) => {
          const am = amBy.get(o.id as string);
          const p = am ? person.get(am.staff_user_id as string) : undefined;
          return (
            <tr key={o.id as string} className="border-t border-line">
              <td className="td"><Link href={`/admin/customers/${o.id}`} className="font-semibold text-blue">{o.name as string}</Link>{o.city ? <div className="text-xs text-muted">{o.city as string}</div> : null}</td>
              <td className="td mono text-sm">{(o.buyer_code as string | null) ?? '—'}</td>
              <td className="td"><span className="inline-flex items-center gap-1.5"><CountryTag code={o.country as string | null} /><span className="text-sm">{COUNTRY_NAMES[o.country as string] ?? ''}</span></span></td>
              <td className="td"><StatusBadge status={o.kyc_status as string} /></td>
              <td className="td text-sm">
                {am ? <>{(p?.full_name as string | undefined) ?? 'Staff'}{p?.out_of_office ? <span className="ml-1"><StatusBadge status="ooo" label="Out of office" tone="amber" /></span> : null}<div className="text-xs text-muted">{(am.team as string | null) ?? ''}</div></> : <span className="text-muted">Unassigned</span>}
              </td>
              <td className="td">{vipSet.has(o.id as string) ? <StatusBadge status="vip" label="VIP" tone="blue" /> : <span className="text-muted text-sm">—</span>}</td>
              <td className="td text-sm text-muted">{fmtDate(o.created_at as string)}</td>
            </tr>
          );
        })}
      </Table>
      </div>
      <p className="text-xs text-muted mt-3">{rows.length} shown{rows.length >= 300 ? ' (first 300 — refine the search)' : ''}. <Link className="text-blue" href={qs({ vip: vip === '1' ? undefined : '1' })}>{vip === '1' ? 'Show all' : 'Show VIP only'}</Link></p>
    </>
  );
}
