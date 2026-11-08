import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import { Loading } from '@/components/admin/ui';
import { fmtDate } from '@/lib/format';
import { markNotificationsRead } from '@/app/account/notifications/actions';
import { NotificationItem } from '@/components/account/notification-item';

export const metadata = { title: 'Notifications' };

/**
 * Admin › Notifications (bug 2, 8 Nov 2026): the staff inbox. Same rules as the customer bell (bug 1): one source
 * (my_notifications(): rows addressed to me), unread = read_at empty, opening one marks it read and goes to its item.
 */
async function StaffNotifications() {
  // staff and admin only, on a 2FA (aal2) session — like every staff page
  const s = await getSession();
  if (!s) redirect('/staff/login?next=/admin/notifications');
  if (!s.isStaff) redirect('/login');
  if (s.aal !== 'aal2') redirect('/staff/verify?next=/admin/notifications');
  const sb = await createClient();
  const { data: rows } = await sb.rpc('my_notifications').select('id, title, body, link, read_at, created_at').order('created_at', { ascending: false }).limit(100);
  type N = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
  const data = (rows ?? []) as unknown as N[];
  const unread = data.filter((n) => !n.read_at).length;
  return (
    <div className="max-w-[860px]">
      <PageHeader title="Notifications" subtitle="New brand projects, assignments and system alerts addressed to you."
        actions={unread > 0 ? <form action={markNotificationsRead}><input type="hidden" name="seen" value={String(data[0].created_at)} /><button type="submit" className="btn btn-ghost min-h-11">Mark all as read</button></form> : undefined} />
      <Card>
        {data.length === 0 ? <EmptyState title="No notifications" body="Alerts addressed to you appear here." /> : (
          <ul>
            {data.map((n) => (
              <NotificationItem key={`${n.id}:${n.read_at ? 'r' : 'u'}`} id={n.id} title={n.title} body={n.body}
                link={n.link} read={!!n.read_at} when={fmtDate(n.created_at, true)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading />}><StaffNotifications /></Suspense>;
}
