import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { markNotificationsRead } from './actions';
import { NotificationItem } from '@/components/account/notification-item';

export const metadata = { title: 'Notifications' };

/** ADDON-41 — in-app notifications for the company (bell in the header). */
async function NotificationsPageContent() {
  await requireCustomer('/account/notifications');
  const sb = await createClient();
  // bug 1 (8 Nov 2026): my_notifications() is the one source for this list and the count bubble (own + company rows)
  const { data: rows } = await sb.rpc('my_notifications').select('id, title, body, link, read_at, created_at, service').order('created_at', { ascending: false }).limit(100);
  type N = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; service: string | null };
  const data = (rows ?? []) as unknown as N[];
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="max-w-[860px]">
      <PageHeader title="Notifications" subtitle="Quotes, payments, shipments and messages from your account manager."
        actions={unread > 0 ? <form action={markNotificationsRead}><input type="hidden" name="seen" value={String(data![0].created_at)} /><button type="submit" className="btn btn-ghost min-h-11">Mark all as read</button></form> : undefined} />
      <Card>
        {(data ?? []).length === 0 ? <EmptyState title="No notifications yet" body="We let you know here when something needs you." /> : (
          <ul>
            {(data ?? []).map((n) => (
              <NotificationItem key={`${n.id}:${n.read_at ? 'r' : 'u'}`} id={n.id as string} title={n.title as string} body={(n.body as string | null) ?? null}
                link={(n.link as string | null) ?? null} read={!!n.read_at} when={fmtDate(n.created_at as string, true)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotificationsPageContent />
    </Suspense>
  );
}
