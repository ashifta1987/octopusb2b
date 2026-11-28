import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ALL_ON, EARLY_ACCESS_DEFAULTS } from '@/lib/dropship-features-shared';
import { DsBadge, DsButton, DsCard, DsChip, DsNotice, DsOrderStatusBadge, DsPageHeader, DsPriceBreakdown, DsTableCard, type DsOrderStatus } from '@/components/dropship-ui';
import { AccountBottomBar, AccountSidebarNav, AccountTop } from '@/app/ods/account/_components/account-frame';
import { AccountFrameShell } from '@/app/ods/account/_components/frame-shell';
import { buildDropshipChildren } from '@/app/ods/account/_lib/dropship-nav';
import type { AccountFrameData } from '@/app/ods/account/_lib/types';
import OdsDropshipLayout from '@/app/ods/account/dropship/layout';
import { FixtureStates } from '../account-frame/_fixture-frame';
import { SAMPLE_FRAME } from '../account-frame/sample-data';

export const metadata: Metadata = { title: 'Dropshipping · ODS screens (staging)', robots: { index: false, follow: false } };

const STATES = [
  ['active', 'Active merchant'],
  ['early', 'Early access'],
  ['locked', 'Not activated'],
  ['import', 'Import list current'],
] as const;
type State = (typeof STATES)[number][0];
type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/account-dropship';

/** SAMPLE frame data per state: the Dropshipping group built with the real rules (buildDropshipChildren). */
function frameFor(state: State): { data: AccountFrameData; path: string; search?: string } {
  const started = { ...SAMPLE_FRAME.started, dropship: state !== 'locked' };
  const features = state === 'early' ? EARLY_ACCESS_DEFAULTS : ALL_ON;
  const data: AccountFrameData = { ...SAMPLE_FRAME, started, dropshipChildren: buildDropshipChildren({ v2: true, enabled: state !== 'locked', features }) };
  if (state === 'import') return { data, path: '/account/dropship/catalogue', search: 'list=1' };
  if (state === 'active') return { data, path: '/account/dropship/orders' };
  return { data, path: '/account/dropship' };
}

type SampleOrder = { id: string; customer: string; country: string; status: DsOrderStatus; total: string };
const SAMPLE_ORDERS: SampleOrder[] = [
  { id: '#1046', customer: 'J. Smith', country: 'United States', status: 'awaiting_payment', total: 'US$ 42.80' },
  { id: '#1045', customer: 'M. Rossi', country: 'Italy', status: 'processing', total: 'US$ 31.20' },
  { id: '#1044', customer: 'A. Khan', country: 'United Kingdom', status: 'shipped', total: 'US$ 58.10' },
  { id: '#1043', customer: 'L. Martin', country: 'France', status: 'on_hold', total: 'US$ 27.90' },
];

/**
 * Staging-only fixture (ODS T7, Part 6.6): the ODS My account frame with Dropshipping expanded into its sub-items
 * (`?state=` active | early | locked | import; `?more=1` opens the phone More sheet) and one representative Dropship
 * content block — the real `components/dropship-ui` kit with SAMPLE props, inside the same `.ds-v2` wrapper as
 * /account/dropship/* (app/ods/account/dropship/layout.tsx), so the ODS bridge (packages/ui/src/bridge-dropship.css)
 * restyles it exactly as on the real pages. Sample data only.
 */
export default function AccountDropshipFixture({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state: State = STATES.find(([s]) => s === raw)?.[0] ?? 'active';
  const moreOpen = (Array.isArray(sp.more) ? sp.more[0] : sp.more) === '1';
  const { data, path, search } = frameFor(state);
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <AccountFrameShell
        sticky={false}
        sidebar={<AccountSidebarNav data={data} path={path} search={search} collapsed={false} />}
        topbar={<AccountTop data={data} />}
        bottomNav={<AccountBottomBar data={data} path={path} search={search} defaultOpen={moreOpen} />}
      >
        <FixtureStates base={BASE} states={STATES} current={state} />
        <OdsDropshipLayout>
          <DsPageHeader
            title="Orders"
            icon="cart"
            subtitle="Store orders we fulfil for you. Sample data for design review."
            actions={<DsButton variant="secondary" icon="download">Export CSV</DsButton>}
            testId="fixture-ds-header"
          />
          <DsNotice tone="warn" title="1 order waiting for payment" testId="fixture-ds-notice">
            Add funds to your wallet, or pay it from the order. Orders are paid oldest first.
          </DsNotice>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders (sample)">
            <DsChip pressed>All 4</DsChip>
            <DsChip pressed={false}>Waiting 1</DsChip>
            <DsChip pressed={false}>Shipped 1</DsChip>
          </div>
          <DsTableCard title="Recent orders" icon="cart" headers={['Order', 'Customer', 'Ships to', 'Status', 'Total']} testId="fixture-ds-table">
            {SAMPLE_ORDERS.map((o) => (
              <tr key={o.id}>
                <td className="font-semibold text-ink">{o.id}</td>
                <td>{o.customer}</td>
                <td className="text-muted">{o.country}</td>
                <td>
                  <DsOrderStatusBadge status={o.status} />
                </td>
                <td className="num">{o.total}</td>
              </tr>
            ))}
          </DsTableCard>
          <div className="grid gap-5 ods-desktop:grid-cols-2">
            <DsCard title="Landed cost for #1046" icon="tag" subtitle="Ships from China · DDP to the United States" testId="fixture-ds-landed">
              <DsPriceBreakdown product="US$ 18.40" processing="US$ 1.20" shipping="US$ 9.60" duties="US$ 4.10" dutiesMode="DDP" landed="US$ 33.30" caption="US: no de minimis; duties are set on Packing and shipping." />
            </DsCard>
            <DsCard title="Store" icon="store" testId="fixture-ds-store">
              <p className="m-0 text-muted">Sample Store (Shopify)</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <DsBadge tone="ok">Connected</DsBadge>
                <DsBadge tone="info">Sync every 15 min</DsBadge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <DsButton>Push products</DsButton>
                <DsButton variant="secondary">Open store settings</DsButton>
              </div>
            </DsCard>
          </div>
        </OdsDropshipLayout>
      </AccountFrameShell>
    </OdsThemeRoot>
  );
}
