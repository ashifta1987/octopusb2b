'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button, Card, EmptyState, Segmented, cx, formatDate, formatTime } from '@octopus/ui';
import { markNotificationsRead, openNotification } from '@/app/account/notifications/actions';
import { bumpUnread } from '@/components/account/unread-count';
import { WebsiteHead } from '../../_website/ods-form';
import { seenStamp, unreadCount, type StaffNote } from '../../_website/website-core';

/** TODAY's actions (app/account/notifications/actions): openNotification marks one read + returns its link; markNotificationsRead(seen). */
export const NOTIFICATION_ACTIONS = { markNotificationsRead, openNotification };
export type NotificationActions = typeof NOTIFICATION_ACTIONS;

export type NotificationsScreenProps = { rows: StaffNote[] | null; divisionName?: string | null; actions?: NotificationActions; loading?: boolean };

/** ODS T9 · Notifications (the staff inbox; same source my_notifications(), same read rules as today). */
export function NotificationsScreen({ rows, divisionName, actions = NOTIFICATION_ACTIONS, loading }: NotificationsScreenProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [read, setRead] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const list = rows ?? [];
  const isRead = (n: StaffNote) => !!n.read_at || read.has(n.id);
  const unread = unreadCount(list) - list.filter((n) => !n.read_at && read.has(n.id)).length;
  const shown = filter === 'unread' ? list.filter((n) => !isRead(n)) : list;
  const seen = seenStamp(list);
  const open = (n: StaffNote) => {
    if (!isRead(n)) {
      setRead((s) => new Set(s).add(n.id));
      bumpUnread(-1);
    }
    start(async () => {
      const r = await actions.openNotification(n.id);
      if (r.link) router.push(r.link);
      else router.refresh();
    });
  };
  return (
    <div data-testid="notifications-page" className="flex min-w-0 max-w-[880px] flex-col gap-4">
      <WebsiteHead
        crumb="Back Office"
        title="Notifications"
        subtitle={`New brand projects, assignments and system alerts addressed to you.${divisionName ? ` Division: ${divisionName} (company-wide alerts under All divisions).` : ''}`}
        actions={
          unread > 0 && seen ? (
            <form action={actions.markNotificationsRead}>
              <input type="hidden" name="seen" value={seen} />
              <Button type="submit" variant="secondary" size="sm" data-testid="mark-all-read">
                Mark all as read
              </Button>
            </form>
          ) : undefined
        }
      />
      <Segmented
        label="Show"
        value={filter}
        onChange={(v) => setFilter(v as 'all' | 'unread')}
        options={[
          { value: 'all', label: `All (${list.length})` },
          { value: 'unread', label: `Unread (${Math.max(0, unread)})` },
        ]}
      />
      <Card
        loading={loading || !rows}
        empty={rows && !shown.length ? <EmptyState icon={Bell} headingLevel={2} title={filter === 'unread' ? 'No unread notifications' : 'No notifications'} description="Alerts addressed to you appear here." /> : undefined}
        bodyClassName="p-0"
      >
        <ul className="m-0 list-none p-0" aria-label="Notifications">
          {shown.map((n) => {
            const r = isRead(n);
            return (
              <li key={n.id} data-testid="notification" data-read={r ? '1' : '0'} className={cx('border-b border-ods-line last:border-b-0', !r && 'bg-ods-blue-tint')}>
                <button type="button" onClick={() => open(n)} className="flex w-full flex-col gap-0.5 px-4 py-3 text-start hover:bg-ods-canvas">
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="font-semibold text-ods-navy">
                      {!r ? <span className="me-2 inline-block size-2 rounded-full bg-ods-blue align-middle" role="img" aria-label="Unread" data-testid="unread-dot" /> : null}
                      {n.title}
                    </span>
                    <span className="whitespace-nowrap text-ods-small text-ods-slate">
                      {formatDate(n.created_at)} {formatTime(n.created_at)}
                    </span>
                  </span>
                  {n.body ? <span className="text-ods-small text-ods-slate">{n.body}</span> : null}
                  {n.link ? <span className="text-ods-small font-semibold text-ods-info">Open →</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
