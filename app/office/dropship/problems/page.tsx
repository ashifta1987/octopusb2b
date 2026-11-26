import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { getStaffBoard } from '@/lib/dropship-problems';
import { ProblemsClient } from './problems-client';

export const metadata = { title: 'Order problems · Back office' };

/**
 * Release 4 · Step 10 — staff Order problems (staff/StaffQueue.html "Exceptions" + states/States-Staff.html): lost / damaged
 * claims and returns with their steps, the merchant's choice and the actions (carrier claim, reship now, refund to wallet —
 * over US$1,000 a second Finance approver —, reject), returns waiting for the parcel / the warehouse check, re-weighs over
 * tolerance (Create adjustment / Absorb) and re-weigh disputes. Ticket SLA and owner come from the shared support desk.
 */
async function Board({ searchParams }: { searchParams: Promise<{ c?: string; tab?: string }> }) {
  const { c, tab } = await searchParams;
  await requireDropshipV2Staff(false, '/office/dropship/problems');
  const board = await getStaffBoard();
  return <ProblemsClient board={board} selected={c ?? null} tab={tab === 'reweigh' || tab === 'done' ? tab : 'open'} />;
}

export default function Page(props: { searchParams: Promise<{ c?: string; tab?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="problems-loading"><DsSkeleton /></div>}>
      <Board {...props} />
    </Suspense>
  );
}
