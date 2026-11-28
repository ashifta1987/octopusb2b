/**
 * ODS T9 · Customer record frame (Part 7.5, Match ERP_Customer): header + underline tabs (?tab=) with one panel per tab.
 * Server-safe: panels are ReactNodes (the real page passes Suspense-wrapped loaders, fixtures pass sample panels), so every
 * tab loads and fails on its own. Tabs the staff member may not see are left out (Invoices without finance/orders).
 */
import type { ReactNode } from 'react';
import { Tabs, type TabItem } from '@octopus/ui';
import type { CustomerTab } from '../../_lib/customer-logic';
import type { CustomerHeaderVM } from '../../_lib/types';

const LABEL: Record<CustomerTab, string> = {
  overview: 'Overview', orders: 'Orders', invoices: 'Invoices', wallet: 'Wallet', rfqs: 'RFQs', documents: 'Documents', team: 'Team', activity: 'Activity', notes: 'Notes',
};

export function customerTabItems(h: CustomerHeaderVM, panels: Partial<Record<CustomerTab, ReactNode>>): TabItem[] {
  const count: Partial<Record<CustomerTab, number | null>> = { orders: h.counts.orders, invoices: h.counts.invoices, rfqs: h.counts.rfqs, documents: h.counts.documents, team: h.counts.team };
  return (Object.keys(LABEL) as CustomerTab[])
    .filter((id) => panels[id] !== undefined)
    .map((id) => ({ id, label: LABEL[id], count: count[id] ?? undefined, panel: panels[id], testId: `customer-tab-${id}` }));
}

export function CustomerRecordView({ header, h, tab, panels }: { header: ReactNode; h: CustomerHeaderVM; tab: CustomerTab; panels: Partial<Record<CustomerTab, ReactNode>> }) {
  const items = customerTabItems(h, panels);
  const value = items.some((i) => i.id === tab) ? tab : 'overview';
  return (
    <div data-testid="customer-record" className="grid min-w-0 gap-3">
      {header}
      <Tabs key={value} label="Customer record" items={items} defaultValue={value} param="tab" data-testid="customer-tabs" panelClassName="pt-3" />
    </div>
  );
}
