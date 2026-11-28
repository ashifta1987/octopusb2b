// ODS T9 · Customers list (Part 7.6 list pattern: filter bar + OctopusDataGrid). Replaces the T8 re-export of
// app/admin/customers/page.tsx. Same guard (requireStaffOrManager(…, ['customers','view']) — account managers see only their
// own customers through RLS), same query, same filters (?q, ?kyc, ?vip=1), same 300-row cap. Switch off → today's page.
import { Suspense } from 'react';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadAssistantSettings } from '@/components/admin/assistant/data';
import { COUNTRY_NAMES } from '@/lib/format';
import { Breadcrumbs } from '@octopus/ui';
import { KYC_FILTERS, companyStatusName, isKycFilter } from './_lib/customer-logic';
import { CustomersList, type CustomerListRow } from './_components/customers-list';

export const metadata = { title: 'Customers' };

const LIMIT = 300;
type SP = Promise<{ q?: string; kyc?: string; vip?: string }>;

export default function CustomersPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="grid gap-3">
      <Breadcrumbs items={[{ label: 'Sales' }, { label: 'Customers' }]} />
      <div>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Customers</h1>
        <p className="m-0 text-ods-small text-ods-slate">Customer organisations, KYC status and their dedicated account manager.</p>
      </div>
      <Suspense fallback={<CustomersList rows={[]} q="" kyc="all" vip={false} base="/admin/customers" loading limit={LIMIT} sample />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  await requireStaffOrManager('/admin/customers', ['customers', 'view']); // managers see only their own customers (RLS)
  const { q = '', kyc: rawKyc = 'all', vip } = await searchParams;
  const kyc = isKycFilter(rawKyc) ? rawKyc : 'all';
  const sb = await createClient();
  let query = sb.from('organizations').select('id, name, buyer_code, country, city, kyc_status, created_at').is('archived_at', null).order('created_at', { ascending: false }).limit(LIMIT);
  const term = q.trim().replace(/[%,()*]/g, ' ').slice(0, 60);
  if (term) query = query.or(`name.ilike.%${term}%,buyer_code.ilike.%${term}%,country.ilike.%${term}%`);
  if (kyc !== 'all') query = query.eq('kyc_status', kyc);
  const [{ data: orgs, error }, { data: ams }, settings] = await Promise.all([
    query,
    sb.from('account_managers').select('org_id, staff_user_id, team, assigned_at'),
    loadAssistantSettings(sb),
  ]);
  const staffIds = [...new Set((ams ?? []).map((a) => a.staff_user_id as string))];
  const { data: ppl } = staffIds.length ? await sb.from('profiles').select('id, full_name, out_of_office').in('id', staffIds) : { data: [] };
  const amBy = new Map((ams ?? []).map((a) => [a.org_id as string, a]));
  const person = new Map((ppl ?? []).map((p) => [p.id as string, p]));
  const vipSet = new Set(settings.vip);
  const rows: CustomerListRow[] = (orgs ?? [])
    .filter((o) => (vip === '1' ? vipSet.has(o.id as string) : true))
    .map((o) => {
      const am = amBy.get(o.id as string);
      const p = am ? person.get(am.staff_user_id as string) : undefined;
      return {
        id: o.id as string,
        name: o.name as string,
        city: (o.city as string | null) ?? null,
        buyerCode: (o.buyer_code as string | null) ?? null,
        country: (o.country as string | null) ?? null,
        countryName: o.country ? (COUNTRY_NAMES[o.country as string] ?? null) : null,
        status: companyStatusName({ kycStatus: o.kyc_status as string }),
        kycLabel: KYC_FILTERS.find(([k]) => k === o.kyc_status)?.[1] ?? String(o.kyc_status),
        manager: am ? { name: (p?.full_name as string | undefined) ?? 'Staff', team: (am.team as string | null) ?? null, outOfOffice: !!p?.out_of_office } : null,
        vip: vipSet.has(o.id as string),
        since: o.created_at as string,
      };
    });
  return <CustomersList rows={rows} q={q} kyc={kyc} vip={vip === '1'} base="/admin/customers" error={!!error} limit={LIMIT} />;
}
