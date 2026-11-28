// ODS T9 · Customer record (Part 7.5, Match ERP_Customer + staff/Staff_CustomerFinance). Replaces the T8 re-export of
// app/admin/customers/[id]/page.tsx inside the ODS Back Office frame. Same guard as today: requireStaffOrManager(…, ['customers','view'])
// — account managers get in and RLS shows only their own customers. Same data as today plus per-tab reads of the customer's own rows
// (permission-gated, see _lib/loaders.ts). Every action is today's server action (customer-actions.tsx). Switch off → today's page.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaffOrManager } from '@/lib/auth';
import { isCustomerTab, type CustomerTab } from '../_lib/customer-logic';
import { CustomerActionsMenu } from './_components/customer-actions';
import { CustomerRecordView } from './_components/customer-record';
import { DocumentsGrid, InvoicesGrid, OrdersGrid, RfqsGrid } from './_components/grids';
import {
  ActivityTabPanel, CustomerHeader, KycSubmissionsPanel, LoadError, NotesPanel, OverviewPanel, PanelLoading, TeamPanel, WalletPanel, supplierNote,
} from './_components/panels';
import { RecordSkeleton } from './_components/skeletons';
import {
  loadActivityTab, loadCustomerCtx, loadDocumentsTab, loadHeaderAndActions, loadInvoicesTab, loadOrdersTab, loadOverview, loadRfqsTab, loadTeamTab, loadWalletTab, type CustomerCtx,
} from './_lib/loaders';
import type { AccountManagerVM, CompanyVM } from '../_lib/types';

export const metadata = { title: 'Customer' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function CustomerRecordPage(props: Props) {
  return (
    <Suspense fallback={<RecordSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const s = await requireStaffOrManager(`/admin/customers/${id}`, ['customers', 'view']); // managers: RLS shows only their own customers
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await loadCustomerCtx(s, id);
  if (!ctx) notFound();
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: CustomerTab = isCustomerTab(raw) ? raw : 'overview';
  const { header, actions, company } = await loadHeaderAndActions(ctx);
  const grid = (title: string) => <PanelLoading title={title} />;
  return (
    <CustomerRecordView
      h={header}
      tab={tab}
      header={<CustomerHeader h={header} actions={<CustomerActionsMenu vm={actions} />} />}
      panels={{
        overview: <Suspense fallback={grid('Overview')}><OverviewSlot ctx={ctx} company={company} ordersTotal={header.counts.orders} /></Suspense>,
        orders: <Suspense fallback={<OrdersGrid rows={[]} loading />}><OrdersSlot ctx={ctx} /></Suspense>,
        invoices: ctx.vis.invoices ? <Suspense fallback={<InvoicesGrid rows={[]} loading />}><InvoicesSlot ctx={ctx} /></Suspense> : undefined,
        wallet: <Suspense fallback={grid('Wallet')}><WalletSlot ctx={ctx} /></Suspense>,
        rfqs: <Suspense fallback={<RfqsGrid rows={[]} loading />}><RfqsSlot ctx={ctx} /></Suspense>,
        documents: <Suspense fallback={<DocumentsGrid rows={[]} loading />}><DocumentsSlot ctx={ctx} /></Suspense>,
        team: <Suspense fallback={grid('Members')}><TeamSlot ctx={ctx} am={actions.accountManager} /></Suspense>,
        activity: <Suspense fallback={grid('Activity')}><ActivitySlot ctx={ctx} /></Suspense>,
        notes: <NotesPanel />,
      }}
    />
  );
}

async function OverviewSlot({ ctx, company, ordersTotal }: { ctx: CustomerCtx; company: CompanyVM; ordersTotal: number | null }) {
  return <OverviewPanel o={await loadOverview(ctx, company)} ordersTotal={ordersTotal} ordersHref="?tab=orders" />;
}
async function OrdersSlot({ ctx }: { ctx: CustomerCtx }) {
  const rows = await loadOrdersTab(ctx);
  return rows === null ? <LoadError what="the orders" /> : <OrdersGrid rows={rows} />;
}
async function InvoicesSlot({ ctx }: { ctx: CustomerCtx }) {
  const rows = await loadInvoicesTab(ctx);
  return rows === null || rows === 'restricted' ? <LoadError what="the invoices" /> : <InvoicesGrid rows={rows} />;
}
async function RfqsSlot({ ctx }: { ctx: CustomerCtx }) {
  const rows = await loadRfqsTab(ctx);
  return rows === null ? <LoadError what="the requests" /> : <RfqsGrid rows={rows} />;
}
async function WalletSlot({ ctx }: { ctx: CustomerCtx }) {
  return <WalletPanel w={await loadWalletTab(ctx)} />;
}
async function DocumentsSlot({ ctx }: { ctx: CustomerCtx }) {
  const d = await loadDocumentsTab(ctx);
  return (
    <div className="grid gap-4" data-testid="customer-documents">
      <KycSubmissionsPanel d={d} />
      {d.documents === null ? <LoadError what="the documents" /> : <DocumentsGrid rows={d.documents} />}
      {supplierNote(d.supplierHidden)}
    </div>
  );
}
async function TeamSlot({ ctx, am }: { ctx: CustomerCtx; am: AccountManagerVM }) {
  return <TeamPanel t={await loadTeamTab(ctx, am)} />;
}
async function ActivitySlot({ ctx }: { ctx: CustomerCtx }) {
  return <ActivityTabPanel a={await loadActivityTab(ctx)} />;
}
