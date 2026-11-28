import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { companyStatusName, isKycFilter, KYC_FILTERS } from '@/app/ods/admin/customers/_lib/customer-logic';
import { CustomersList, type CustomerListRow } from '@/app/ods/admin/customers/_components/customers-list';
import { CustomerFixtureFrame } from '../office-customer/_frame';
import { sampleSession } from '../office-customer/sample-data';

export const metadata: Metadata = { title: 'Customers list · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-customers';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = [
  ['default', 'Default'],
  ['loading', 'Loading'],
  ['empty', 'No customers yet'],
  ['no-results', 'No results for filters'],
  ['error', 'Error'],
  ['account-manager', 'Account manager (own customers only)'],
] as const;

/** SAMPLE customers (invented for design review). */
const RAW: [string, string, string | null, string, string, string | null, boolean, string][] = [
  ['Anna Home Trading', 'Dubai', 'CUS-00418', 'AE', 'verified', 'Ravi Menon', true, '2026-03-02'],
  ['Nordic Living AB', 'Stockholm', 'CUS-00402', 'SE', 'verified', 'Lena Fischer', false, '2026-02-14'],
  ['Casa Verde SA', 'Madrid', 'CUS-00433', 'ES', 'in_review', null, false, '2026-11-20'],
  ['Gulf Home Trading LLC', 'Sharjah', 'CUS-00377', 'AE', 'verified', 'Ravi Menon', false, '2025-12-01'],
  ['Pacific Pets Co.', 'Sydney', 'CUS-00441', 'AU', 'submitted', null, false, '2026-11-25'],
  ['Maison Lumière SARL', 'Lyon', 'CUS-00390', 'FR', 'more_info', 'Omar Khalid', false, '2026-01-09'],
  ['Kiwi Kitchenware Ltd', 'Auckland', 'CUS-00412', 'NZ', 'rejected', null, false, '2026-04-30'],
  ['Desert Bloom Retail', 'Riyadh', 'CUS-00425', 'SA', 'verified', 'Ravi Menon', true, '2026-06-18'],
  ['Baltic Craft OÜ', 'Tallinn', null, 'EE', 'not_started', null, false, '2026-11-26'],
];
const COUNTRY: Record<string, string> = { AE: 'United Arab Emirates', SE: 'Sweden', ES: 'Spain', AU: 'Australia', FR: 'France', NZ: 'New Zealand', SA: 'Saudi Arabia', EE: 'Estonia' };

export default function OfficeCustomersFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default') as (typeof STATES)[number][0];
  const kycRaw = one(sp.kyc);
  const kyc = state === 'no-results' ? 'rejected' : isKycFilter(kycRaw) ? kycRaw : 'all';
  const vip = state === 'no-results' || one(sp.vip) === '1';
  const q = one(sp.q) ?? '';
  const session = sampleSession(state === 'account-manager' ? 'account-manager' : 'sales');
  let rows: CustomerListRow[] = RAW.map(([name, city, code, country, k, am, v, since], i) => ({
    id: `sample-${i}`,
    name,
    city,
    buyerCode: code,
    country,
    countryName: COUNTRY[country] ?? null,
    status: companyStatusName({ kycStatus: k }),
    kycLabel: KYC_FILTERS.find(([x]) => x === k)?.[1] ?? k,
    manager: am ? { name: am, team: am === 'Omar Khalid' ? 'Turnkey' : 'Sourcing', outOfOffice: am === 'Omar Khalid' } : null,
    vip: v,
    since: `${since}T00:00:00Z`,
  }));
  if (state === 'account-manager') rows = rows.filter((r) => r.manager?.name === 'Ravi Menon'); // RLS: own customers only
  if (kyc !== 'all') rows = rows.filter((r) => RAW[Number(r.id.split('-')[1])][4] === kyc);
  if (vip) rows = rows.filter((r) => r.vip);
  if (q) rows = rows.filter((r) => `${r.name} ${r.buyerCode} ${r.country}`.toLowerCase().includes(q.toLowerCase()));
  if (state === 'empty' || state === 'error') rows = [];
  return (
    <CustomerFixtureFrame roles={[...session.roles]} permissions={[...(session.permissions as readonly string[])]} isAdmin={session.isAdmin} active="s-customers">
      <nav aria-label="Fixture states (sample data)" className="mb-3 grid gap-1.5">
        <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {STATES.map(([id, l]) => (
            <li key={id}>
              <a href={`${BASE}?state=${id}`} aria-current={state === id ? 'page' : undefined} className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${state === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}>{l}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-3">
        <Breadcrumbs items={[{ label: 'Sales' }, { label: 'Customers' }]} />
        <div>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Customers</h1>
          <p className="m-0 text-ods-small text-ods-slate">Customer organisations, KYC status and their dedicated account manager.</p>
        </div>
        <CustomersList rows={rows} q={q} kyc={kyc} vip={vip} base={`${BASE}?state=${state}`} loading={state === 'loading'} error={state === 'error'} limit={300} sample />
      </div>
    </CustomerFixtureFrame>
  );
}
