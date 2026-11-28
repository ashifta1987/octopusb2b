'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button, Drawer, EmptyState, ErrorState, Skeleton, formatDate } from '@octopus/ui';
import { markStaffNotificationsReadAction, staffNotificationsAction } from '../_actions/notifications';
import type { StaffNotification } from '@/lib/office/workspace-core';

/**
 * ODS T8 · the bell panel (Part 7.1 notifications). Two sources, both read with the staff member's session:
 *  - the new staff alerts channel (T8-DATA staff_notifications: approvals, money actions …), listed here;
 *  - today's staff inbox (/admin/notifications, my_notifications), linked with its unread count.
 * When the staff_notifications migration isn't applied (`unavailable`), only the inbox link shows.
 * `sample` = staging fixtures (no server calls).
 */
export function NotificationsDrawer({
  open,
  onClose,
  inboxUnread,
  onOpenHref,
  onUnreadChange,
  sample,
}: {
  open: boolean;
  onClose: () => void;
  inboxUnread: number;
  onOpenHref: (href: string) => void;
  onUnreadChange?: (n: number) => void;
  sample?: StaffNotification[];
}) {
  const [items, setItems] = useState<StaffNotification[] | null>(sample ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'unavailable'>('idle');

  const load = useCallback(async () => {
    if (sample) return;
    setState('loading');
    try {
      const r = await staffNotificationsAction({ limit: 20 });
      if (r.ok) {
        setItems(r.data);
        setState('idle');
        onUnreadChange?.(r.data.filter((n) => !n.readAt).length);
      } else setState(r.unavailable ? 'unavailable' : 'error');
    } catch {
      setState('error');
    }
  }, [sample, onUnreadChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the list when the panel opens
    if (open) void load();
  }, [open, load]);

  const markAll = async () => {
    if (sample) return;
    const r = await markStaffNotificationsReadAction(null);
    if (r.ok) void load();
  };

  const unread = (items ?? []).filter((n) => !n.readAt).length;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notifications"
      width={380}
      data-testid="notifications-panel"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenHref('/admin/notifications')}>
            Staff inbox{inboxUnread ? ` (${inboxUnread} unread)` : ''}
          </Button>
          {unread ? (
            <Button variant="ghost" size="sm" onClick={markAll}>
              Mark all as read
            </Button>
          ) : null}
        </div>
      }
    >
      {state === 'loading' && !items ? <Skeleton lines={4} label="Loading notifications" /> : null}
      {state === 'error' ? <ErrorState onRetry={() => void load()} headingLevel={3} /> : null}
      {state === 'unavailable' ? (
        <p className="m-0 text-ods-body text-ods-slate">Alerts for approvals and money actions arrive here once they are switched on. Your staff inbox is below.</p>
      ) : null}
      {items && state !== 'unavailable' ? (
        items.length ? (
          <ul className="m-0 grid list-none gap-1 p-0">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  disabled={!n.link}
                  onClick={() => n.link && onOpenHref(n.link)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-ods-control px-2 py-2 text-start hover:bg-ods-canvas disabled:cursor-default"
                >
                  <span className="flex w-full items-center gap-2">
                    {!n.readAt ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-ods-blue" /> : null}
                    <span className={`min-w-0 flex-1 truncate text-ods-body ${n.readAt ? 'text-ods-text' : 'font-semibold text-ods-navy'}`}>{n.title}</span>
                    <span className="shrink-0 text-ods-small text-ods-slate">{formatDate(n.createdAt, { short: true })}</span>
                  </span>
                  {n.body ? <span className="line-clamp-2 text-ods-small text-ods-slate">{n.body}</span> : null}
                  {!n.readAt ? <span className="sr-only">Unread.</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Bell} title="No alerts" description="Approvals and money actions that need you show up here." headingLevel={3} />
        )
      ) : null}
    </Drawer>
  );
}
