import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '../../_services/ui';
import { notFound } from 'next/navigation';
import crypto from 'node:crypto';
import { Skeleton } from '@octopus/ui';
import { requireAccount } from '../../_lib/loaders';
import { tripPricesFrom } from '@/lib/turnkey/format';
import { getTkClientFees, getTkClientProject } from '@/lib/turnkey/projects';
import { getTkClientDrawings, getTkClientQuotes } from '@/lib/turnkey/work';
import { getTkClientInspections } from '@/lib/turnkey/qc';
import { getTkClientShipping, getTkClientTrips, getTkTripPrices } from '@/lib/turnkey/shipping';
import { TURNKEY_TABS, pickTab } from '../../_services/logic';
import { TurnkeyDetailView } from '../_components/turnkey-detail-view';

export const metadata: Metadata = { title: 'Turnkey project' };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string; tab?: string }> };

/**
 * ODS /account/turnkey/TKP-n. Same readers as today's app/account/turnkey/[code]/page.tsx (lib/turnkey/*: customer-safe
 * views and RPCs, RLS decides visibility) and the same actions (app/account/turnkey/actions.ts). `?tab=` keeps the section.
 */
export default function TurnkeyProjectPage(props: Props) {
  return (
    <PageWrap>
      <Suspense fallback={<div className="flex flex-col gap-6"><Skeleton lines={2} label="Loading the project" /><Skeleton className="h-24" silent /><Skeleton lines={6} silent /></div>}>
      <Detail {...props} />
      </Suspense>
    </PageWrap>
  );
}

async function Detail({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  await requireAccount(`/account/turnkey/${code}`);
  const d = await getTkClientProject(code);
  if (!d) notFound();
  const [fees, drawings, quotes, inspections, shipping, trips, svc] = await Promise.all([
    getTkClientFees(d.project.id), getTkClientDrawings(d.project.id), getTkClientQuotes(d.project.id), getTkClientInspections(d.project.id),
    getTkClientShipping(d.project.id), getTkClientTrips(d.project.id), getTkTripPrices(),
  ]);
  return (
    <TurnkeyDetailView tab={pickTab(sp.tab, TURNKEY_TABS)}
      d={{ ...d, fees, drawings, quotes, inspections, shipping, trips, tripPrices: tripPricesFrom(svc), keySeed: crypto.randomUUID(), created: !!sp.created }} />
  );
}
