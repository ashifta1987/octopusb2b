import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { markNotificationsRead } from './actions';

export const metadata = { title: 'Notifications' };

/** ADDON-41 — in-app notifications for the company (bell in the header). */
async function NotificationsPageContent() {
  const s = await requireCustomer('/account/notifications');
  const sb = await createClient();
  const { data } = await sb.from('notifications').select('id, title, body, link, read_at, created_at, service').eq('org_id', s.org!.id).order('created_at', { ascending: false }).limit(100);
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="max-w-[860px]">
      <PageHeader title="Notifications" subtitle="Quotes, payments, shipments and messages from your account manager."
        actions={unread > 0 ? <form action={markNotificationsRead}><button type="submit" className="btn btn-ghost min-h-11">Mark all as read</button></form> : undefined} />
      <Card>
        {(data ?? []).length === 0 ? <EmptyState title="No notifications yet" body="We let you know here when something needs you." /> : (
          <ul>
            {(data ?? []).map((n) => (
              <li key={n.id} className={`px-5 py-4 border-b border-line last:border-0 ${n.read_at ? '' : 'bg-[#F5F8FF]'}`}>
                <div className="flex justify-between gap-3">
                  <div className="font-semibold">{!n.read_at && <span className="inline-block w-2 h-2 rounded-full bg-blue-fill mr-2 align-middle" aria-label="Unread" />}{n.title}</div>
                  <div className="text-[13px] text-[#5A6475] whitespace-nowrap">{fmtDate(n.created_at as string, true)}</div>
                </div>
                {n.body && <p className="text-[14px] text-[#5A6475] mt-0.5">{n.body}</p>}
                {n.link && <Link href={n.link as string} className="text-[14px] font-semibold text-blue">Open →</Link>}
              </li>
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
