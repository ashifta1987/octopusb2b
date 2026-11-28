import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { Card, EmptyState, Notice, PageHeader, Stat, StatusBadge, Table } from '@/components/ui';
import { Field, Tabs } from '@/components/admin/ui';
import { OfficeFrameFixture } from './_fixture';
import { OFFICE_FIXTURE_STATES, type OfficeFixtureState } from './sample-data';

export const metadata: Metadata = { title: 'Back Office frame · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-frame';

/**
 * Staging-only fixture (T8): the ODS Back Office frame (Part 7.1, compact) with SAMPLE staff data, and — inside it —
 * TODAY's staff UI pieces (components/ui PageHeader / Stat / Card / Table / StatusBadge / Notice / EmptyState,
 * components/admin/ui Tabs / Field, legacy .btn / .input / .label / .th / .td classes) with sample props, to check the
 * bridge (packages/ui/src/bridge-office.css): compact sizes, ODS colours, contrast and focus.
 * `?state=default | collapsed | palette | many-tabs | unsaved | shortcuts | alerts | phone`.
 */
export default function OfficeFrameFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

const ROWS = [
  { code: 'ORD-1042', customer: 'Gulf Home Trading LLC', status: 'balance_pending', total: 'US$ 12,480.00' },
  { code: 'ORD-1039', customer: 'Nordic Living AB', status: 'in_production', total: 'US$ 4,915.50' },
  { code: 'ORD-1031', customer: 'Casa Verde SA', status: 'shipped', total: 'US$ 8,020.00' },
];

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (OFFICE_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'default') as OfficeFixtureState;
  return (
    <OfficeFrameFixture state={state}>
      <nav aria-label="Fixture states (sample data)" className="mb-4">
        <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
          {OFFICE_FIXTURE_STATES.map(([id, label]) => (
            <li key={id}>
              <a
                href={`${BASE}?state=${id}`}
                aria-current={state === id ? 'page' : undefined}
                className={`inline-flex min-h-8 items-center rounded-ods-control border px-3 text-ods-small font-semibold no-underline ${state === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {/* today's staff page pieces, unchanged components, sample props */}
      <PageHeader title="Orders" subtitle="Sample: today's Orders page header, table and actions inside the ODS frame." actions={<><a className="btn btn-ghost" href="#sample">Export CSV</a><button type="button" className="btn btn-primary">New order</button></>} />
      <Tabs tabs={[{ key: 'active', label: 'Active', count: 18 }, { key: 'pending', label: 'Awaiting payment', count: 4 }, { key: 'closed', label: 'Closed' }]} active="active" base={BASE} param="tab" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open orders" value="18" hint="4 awaiting payment" hintTone="warn" />
        <Stat label="Paid this month" value="US$ 48,210.00" hint="Sample figure" />
        <Stat label="Held (Payment protection)" value="US$ 6,300.00" />
      </div>
      <div className="mt-4">
        <Card title="Orders" action={<a className="btn btn-ghost btn-sm" href="#sample">See all</a>}>
          <Table head={['Order', 'Customer', 'Status', 'Total', '']}>
            {ROWS.map((r) => (
              <tr key={r.code}>
                <td className="td mono">{r.code}</td>
                <td className="td">{r.customer}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right tabular-nums">{r.total}</td>
                <td className="td text-right"><a href="#sample" className="btn btn-ghost btn-sm">Open<span className="sr-only"> {r.code}</span></a></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Record payment (sample form)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (US$)" htmlFor="fx-amount"><input id="fx-amount" className="input" inputMode="decimal" defaultValue="2,500.00" /></Field>
            <Field label="Bank reference" htmlFor="fx-ref" hint="Must match the bank statement line"><input id="fx-ref" className="input" defaultValue="FT2611270042" /></Field>
          </div>
          <div className="mt-4 flex gap-3"><button type="button" className="btn btn-primary">Save payment</button><button type="button" className="btn btn-ghost">Cancel</button></div>
        </section>
        <div className="grid gap-4">
          <Notice tone="amber">Payments over US$ 2,500 need a second approver (sample notice).</Notice>
          <div className="card"><EmptyState title="No held payments" body="Sample empty state from today's components." /></div>
        </div>
      </div>
    </OfficeFrameFixture>
  );
}
