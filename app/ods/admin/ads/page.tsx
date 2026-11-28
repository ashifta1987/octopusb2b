// ODS T9 · Website › Advertising (replaces the T8 re-export of app/admin/ads/page). Same guard (requireStaff('ads','view')),
// same permissions (ads:edit moderates and edits slots; Admin switches ads on/off), same reads and actions.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs } from '@/components/admin/server';
import { AdsScreen } from './_components/ads-screen';
import { loadAds } from './_lib/data';

export const metadata = { title: 'Advertising' };

async function Content() {
  const s = await requireStaff('ads', 'view', '/admin/ads');
  const data = await loadAds(nowMs());
  return <AdsScreen data={data} perms={{ isAdmin: s.isAdmin, edit: can(s, 'ads', 'edit') }} />;
}

export default function AdsAdminPage() {
  return (
    <Suspense fallback={<AdsScreen data={null} perms={{ isAdmin: false, edit: false }} loading />}>
      <Content />
    </Suspense>
  );
}
