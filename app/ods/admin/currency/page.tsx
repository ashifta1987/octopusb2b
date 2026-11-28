// ODS T9 · Website › Currency (replaces the T8 re-export of app/admin/currency/page). Same guard (requireStaff('finance',
// 'view')), same rules (Admin sets rates / requests a switch; finance:approve approves — never the requester), same RPCs.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs } from '@/components/admin/server';
import { CurrencyScreen } from './_components/currency-screen';
import { loadCurrency } from './_lib/data';

export const metadata = { title: 'Currency' };

async function Content() {
  const s = await requireStaff('finance', 'view', '/admin/currency');
  const data = await loadCurrency(nowMs());
  return <CurrencyScreen data={data} perms={{ userId: s.userId, isAdmin: s.isAdmin, canApprove: can(s, 'finance', 'approve') }} />;
}

export default function CurrencyPage() {
  return (
    <Suspense fallback={<CurrencyScreen data={null} perms={{ userId: '', isAdmin: false, canApprove: false }} loading />}>
      <Content />
    </Suspense>
  );
}
