// ODS T9 · Back Office › Services › MOQ pools (Part 7.6 list + drawer pattern). Replaces the T8 re-export of
// app/admin/pools/page.tsx inside the ODS Back Office frame. Same guard as today (requireStaff('orders','view')), same
// division scope, same reads and filters (?status= / ?closing=1 / ?pool=); every action is today's server action from
// app/admin/pools/actions.ts with today's visibility rules. Supplier codes as today (RLS). Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { getDivisionScope } from '@/lib/divisions/scope';
import { nowMs as getNowMs } from '@/components/admin/server';
import { getCurrencyContext } from '@/lib/currency';
import { PoolsScreen } from './_components/pools-screen';
import { POOLS_PATH, parsePoolQuery, poolPerms } from './_lib/pools-core';
import { loadPools } from './_lib/pools-data';

export const metadata = { title: 'Group buying' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('orders', 'view', POOLS_PATH);
  const scope = await getDivisionScope(s); // divisions step 4: header switcher (as today)
  const query = parsePoolQuery(await searchParams);
  const perms = poolPerms(s.isAdmin, (a, act) => can(s, a, act));
  const now = getNowMs();
  const [r, cx] = await Promise.all([loadPools(scope, query, perms, now), getCurrencyContext()]);
  return <PoolsScreen query={query} perms={perms} now={now} fx={{ currency: cx.currency, rate: cx.rate, rounding: cx.rounding }} result={r.ok ? { kind: 'ok', rows: r.rows, kpis: r.kpis, rules: r.rules } : { kind: 'error', error: r.error, rules: r.rules }} />;
}

export default function OdsAdminPoolsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PoolsScreen query={{ tab: 'open', pool: null }} perms={{ isAdmin: false, approve: false, edit: false, finance: false, readSuppliers: true }} now={0} fx={null} result={{ kind: 'loading' }} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
