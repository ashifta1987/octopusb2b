import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { isCustomerTab, type CustomerTab } from '@/app/ods/admin/customers/_lib/customer-logic';
import { CustomerActionsMenu } from '@/app/ods/admin/customers/[id]/_components/customer-actions';
import { CustomerRecordView } from '@/app/ods/admin/customers/[id]/_components/customer-record';
import { DocumentsGrid, InvoicesGrid, OrdersGrid, RfqsGrid } from '@/app/ods/admin/customers/[id]/_components/grids';
import {
  ActivityTabPanel, CustomerHeader, KycSubmissionsPanel, LoadError, NotesPanel, OverviewPanel, PanelLoading, TeamPanel, WalletPanel, supplierNote,
} from '@/app/ods/admin/customers/[id]/_components/panels';
import { CustomerFixtureFrame } from './_frame';
import { ROLES, STATES, buildSample, sampleSession, type SampleRole, type SampleState } from './sample-data';

export const metadata: Metadata = { title: 'Customer record · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-customer';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Staging-only fixture (T9): the ODS Customer record (Part 7.5) inside the real Back Office frame, SAMPLE data.
 * `?tab=overview|orders|invoices|wallet|rfqs|documents|team|activity|notes`, `?role=finance|sales|account-manager|admin`,
 * `?state=default|loading|error|empty|second-approver`. Visibility per role comes from the real customerPerms/panelVisibility.
 */
export default function OfficeCustomerFixturePage({ searchParams }: { searchParams: SP }) {
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
  const role = (ROLES.find(([r]) => r === one(sp.role))?.[0] ?? 'finance') as SampleRole;
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default') as SampleState;
  const rawTab = one(sp.tab);
  const tab: CustomerTab = isCustomerTab(rawTab) ? rawTab : 'overview';
  const x = buildSample(role, state);
  const session = sampleSession(role);
  const loading = state === 'loading';
  const link = (p: Record<string, string>) => {
    const u = new URLSearchParams({ role, state, tab, ...p });
    return `${BASE}?${u.toString()}`;
  };
  const panels = loading
    ? {
        overview: <div className="grid gap-4 ods-desktop:grid-cols-3"><PanelLoading title="Company" /><PanelLoading title="Money" testId="money-panel" /><PanelLoading title="Open items" testId="open-items" /></div>,
        orders: <OrdersGrid rows={[]} loading />,
        invoices: x.vis.invoices ? <InvoicesGrid rows={[]} loading /> : undefined,
        wallet: <PanelLoading title="Wallet" />,
        rfqs: <RfqsGrid rows={[]} loading />,
        documents: <DocumentsGrid rows={[]} loading />,
        team: <PanelLoading title="Members" />,
        activity: <PanelLoading title="Activity" />,
        notes: <NotesPanel />,
      }
    : {
        overview: <OverviewPanel o={x.overview} ordersTotal={x.header.counts.orders} ordersHref={link({ tab: 'orders' })} />,
        orders: x.orders === null ? <LoadError what="the orders" /> : <OrdersGrid rows={x.orders} />,
        invoices: x.invoices === 'restricted' ? undefined : x.invoices === null ? <LoadError what="the invoices" /> : <InvoicesGrid rows={x.invoices} />,
        wallet: <WalletPanel w={x.wallet} />,
        rfqs: x.rfqs === null ? <LoadError what="the requests" /> : <RfqsGrid rows={x.rfqs} />,
        documents: (
          <div className="grid gap-4" data-testid="customer-documents">
            <KycSubmissionsPanel d={x.documents} />
            {x.documents.documents === null ? <LoadError what="the documents" /> : <DocumentsGrid rows={x.documents.documents} />}
            {supplierNote(x.documents.supplierHidden)}
          </div>
        ),
        team: <TeamPanel t={x.team} />,
        activity: <ActivityTabPanel a={x.activity} />,
        notes: <NotesPanel />,
      };
  return (
    <CustomerFixtureFrame roles={[...session.roles]} permissions={[...(session.permissions as readonly string[])]} isAdmin={session.isAdmin} active="s-customer">
      <nav aria-label="Fixture states (sample data)" className="mb-3 grid gap-1.5">
        <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
        {[
          ['Role', ROLES, 'role', role],
          ['State', STATES, 'state', state],
        ].map(([label, list, key, cur]) => (
          <ul key={key as string} aria-label={label as string} className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            <li className="text-ods-small font-semibold text-ods-slate">{label as string}:</li>
            {(list as readonly (readonly [string, string])[]).map(([id, l]) => (
              <li key={id}>
                <a
                  href={link({ [key as string]: id })}
                  aria-current={cur === id ? 'page' : undefined}
                  className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${cur === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
                >
                  {l}
                </a>
              </li>
            ))}
          </ul>
        ))}
      </nav>
      <CustomerRecordView
        h={x.header}
        tab={tab}
        header={<CustomerHeader h={x.header} actions={<CustomerActionsMenu vm={x.actions} sample />} />}
        panels={panels}
      />
    </CustomerFixtureFrame>
  );
}
