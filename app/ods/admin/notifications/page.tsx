// ODS T9 · Notifications (replaces the T8 re-export of app/admin/notifications/page). Same guard as today (staff on a
// 2-step session; redirects as today), same source (my_notifications(), division scope), same read actions.
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import { NotificationsScreen } from './_components/notifications-screen';
import type { StaffNote } from '../_website/website-core';

export const metadata = { title: 'Notifications' };

async function StaffNotifications() {
  const s = await getSession();
  if (!s) redirect('/staff/login?next=/admin/notifications');
  if (!s.isStaff) redirect('/login');
  if (s.aal !== 'aal2') redirect('/staff/verify?next=/admin/notifications');
  const sb = await createClient();
  const scope = await getDivisionScope(s);
  const base = sb.rpc('my_notifications').select('id, title, body, link, read_at, created_at');
  const { data: rows } = await (scope.all ? base : base.eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(100);
  return <NotificationsScreen rows={(rows ?? []) as unknown as StaffNote[]} divisionName={scope.all ? null : scope.division.name} />;
}

export default function Page() {
  return (
    <Suspense fallback={<NotificationsScreen rows={null} loading />}>
      <StaffNotifications />
    </Suspense>
  );
}
