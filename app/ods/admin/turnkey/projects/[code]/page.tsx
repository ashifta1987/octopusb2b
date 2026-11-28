// ODS T9 · /admin/turnkey/projects/[code] (Turnkey project record). Replaces the T8 re-export of today's 629-line page.
// Same guard (requireStaff('turnkey','view') + TKP- code check), same data (getTkClientProject: RLS decides visibility; staff
// rows, fees, services, old lead, the five staff RPCs), same gates (turnkey-logic recordGates = today's lines 83–140) and
// every control is today's client component / server action. Fee and phase gates stay DB-enforced (migration 231).
import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { Skeleton } from '@octopus/ui';
import { isProjectTab, type ProjectTab } from '../../_lib/turnkey-logic';
import { Panel } from '../../_components/tk-ui';
import { loadRecordBase, loadRecordSources } from './_lib/record-data';
import { RecordView } from './_components/record-view';
import { DrawingsTab, FeesTab, HandoverTab, OverviewTab, QcTab, QuotesTab, ShipmentTab, VisitsTab, gatesFor, type RecordProps } from './_components/record-panels';
import type { RecordBase, Viewer } from './_components/record-types';

export const metadata = { title: 'Turnkey client project' };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string }> };

export default function TurnkeyProjectRecordPage(props: Props) {
  return (
    <Suspense fallback={<Skeleton lines={10} label="Loading project" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Props) {
  const { code } = await params;
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/projects/${code}`);
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  const b = await loadRecordBase(code);
  if (!b) notFound();
  const raw = (await searchParams).tab;
  const tab: ProjectTab = isProjectTab(raw) ? raw : 'overview';
  const v: Viewer = { userId: s.userId, isAdmin: s.isAdmin, edit: can(s, 'turnkey', 'edit') };
  const slot = (title: string, Panel_: (p: RecordProps) => ReactNode) => (
    <Suspense fallback={<Panel title={title}><Skeleton lines={4} label={`Loading ${title.toLowerCase()}`} /></Panel>}>
      <Slot b={b} v={v} render={Panel_} />
    </Suspense>
  );
  return (
    <RecordView
      b={b}
      tab={tab}
      counts={{ fees: b.fees?.length }}
      panels={{
        overview: slot('Overview', OverviewTab),
        fees: slot('Fees', FeesTab),
        drawings: slot('Layout drawings', DrawingsTab),
        quotes: slot('Quotes', QuotesTab),
        qc: slot('Production and QC', QcTab),
        shipment: slot('Balance and shipment', ShipmentTab),
        visits: slot('China visits', VisitsTab),
        handover: slot('Handover', HandoverTab),
      }}
    />
  );
}

async function Slot({ b, v, render }: { b: RecordBase; v: Viewer; render: (p: RecordProps) => ReactNode }) {
  const src = await loadRecordSources(b.p.id);
  return <>{render({ b, src, v, g: gatesFor(b, src, v) })}</>;
}
