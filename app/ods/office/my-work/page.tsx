// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireStaffOrManager } from '@/lib/auth';
import { loadMyWork, settle } from '../_lib/dashboard-data';
import { MyWorkGridPage } from '../_components/my-work-grid';

/**
 * ODS T9 · /office/my-work (Part 3.5 / 7.1 "My work"): today's work queue as a full grid page. SAME guard and data as
 * today's /admin Work queue: requireStaffOrManager(['dashboard','view'], ['approvals','view'], ['wallet','approve']) +
 * getWorkQueue(s, division scope) — RLS scopes it (owner: everything; account manager: own customers; finance: the
 * transfers to confirm). /admin keeps today's page.
 */
export const metadata: Metadata = { title: 'My work' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function OdsMyWorkPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<MyWorkGridPage items={[]} stats={null} loading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaffOrManager('/office/my-work', ['dashboard', 'view'], ['approvals', 'view'], ['wallet', 'approve']);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const r = await settle(() => loadMyWork(s));
  return (
    <MyWorkGridPage
      items={r.ok ? r.data.items : []}
      stats={r.ok ? r.data.stats : null}
      initialService={one(sp.s) ?? 'all'}
      initialOwner={one(sp.owner) === '1'}
      error={!r.ok}
    />
  );
}
