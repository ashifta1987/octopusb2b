import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot, Skeleton } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { PROJECT_TABS, PROJECT_TAB_LABEL, type ProjectTab } from '@/app/ods/admin/turnkey/_lib/turnkey-logic';
import { Panel } from '@/app/ods/admin/turnkey/_components/tk-ui';
import { RecordView } from '@/app/ods/admin/turnkey/projects/[code]/_components/record-view';
import { DrawingsTab, FeesTab, HandoverTab, OverviewTab, QcTab, QuotesTab, ShipmentTab, VisitsTab, gatesFor } from '@/app/ods/admin/turnkey/projects/[code]/_components/record-panels';
import { TurnkeyFixtureFrame } from '../_office-turnkey-frame';
import { FixtureNav, pick } from '../_office-turnkey-fixture-nav';
import { ME, ROLES, recordBase, recordSources, roleSession } from '../_office-turnkey-sample';

export const metadata: Metadata = { title: 'Turnkey project record · ODS screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [['default', 'Default'], ['loading', 'Loading'], ['error', 'Error per panel'], ['second-approver', 'Second approver needed'], ['on-hold', 'On hold']] as const;
const TABS = PROJECT_TABS.map((t) => [t, PROJECT_TAB_LABEL[t]] as const);

/** Staging-only fixture (T9): /admin/turnkey/projects/[code]. ?tab= ?role=admin|editor|viewer ?state=… — the real panels and gates on SAMPLE data. */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const role = pick(sp.role, ROLES, 'admin');
  const state = pick(sp.state, STATES, 'default');
  const tab = pick(sp.tab, TABS, 'overview') as ProjectTab;
  const r = roleSession(role);
  const v = { userId: ME, isAdmin: r.isAdmin, edit: r.edit };
  const b = recordBase(state);
  const src = recordSources(state);
  const props = { b, src, v, g: gatesFor(b, src, v) };
  const load = (t: string) => <Panel title={t}><Skeleton lines={4} label={`Loading ${t.toLowerCase()}`} /></Panel>;
  const L = state === 'loading';
  return (
    <TurnkeyFixtureFrame pathname="/admin/turnkey/projects/TKP-00012" activeId="tk-project" isAdmin={r.isAdmin} roles={r.roles} permissions={r.permissions}>
      <FixtureNav base="/dev/ui/screens/office-turnkey-project" current={{ tab, role, state }} groups={[{ key: 'role', label: 'Role', options: ROLES }, { key: 'state', label: 'State', options: STATES }]} />
      <RecordView
        b={b}
        tab={tab}
        counts={{ fees: b.fees?.length }}
        panels={{
          overview: L ? load('Overview') : <OverviewTab {...props} />,
          fees: L ? load('Fees') : <FeesTab {...props} />,
          drawings: L ? load('Layout drawings') : <DrawingsTab {...props} />,
          quotes: L ? load('Quotes') : <QuotesTab {...props} />,
          qc: L ? load('Production and QC') : <QcTab {...props} />,
          shipment: L ? load('Balance and shipment') : <ShipmentTab {...props} />,
          visits: L ? load('China visits') : <VisitsTab {...props} />,
          handover: L ? load('Handover') : <HandoverTab {...props} />,
        }}
      />
    </TurnkeyFixtureFrame>
  );
}
