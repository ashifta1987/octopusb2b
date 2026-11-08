'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { openNotification } from '@/app/account/notifications/actions';
import { bumpUnread } from '@/components/account/unread-count';

/**
 * One row on My account › Notifications (bug 1, 8 Nov 2026). Opening it — "Open →" or a click on the row — marks this
 * notification read on the server, lowers the badges at once, then goes to its link. Without a link it just marks it read.
 */
export function NotificationItem({ id, title, body, link, read, when }: {
  id: string; title: string; body: string | null; link: string | null; read: boolean; when: string;
}) {
  const router = useRouter();
  const [isRead, setRead] = useState(read);
  const [, start] = useTransition();
  const open = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (!isRead) { setRead(true); bumpUnread(-1); }
    start(async () => {
      const r = await openNotification(id);
      if (r.link) router.push(r.link);
      else router.refresh();
    });
  };
  return (
    <li data-testid="notification" data-read={isRead ? '1' : '0'} onClick={() => open()}
      className={`px-5 py-4 border-b border-line last:border-0 cursor-pointer ${isRead ? '' : 'bg-tint-2'}`}>
      <div className="flex justify-between gap-3">
        <div className="font-semibold">{!isRead && <span className="inline-block w-2 h-2 rounded-full bg-coral mr-2 align-middle" aria-label="Unread" data-testid="unread-dot" />}{title}</div>
        <div className="text-[13px] text-muted whitespace-nowrap">{when}</div>
      </div>
      {body && <p className="text-[14px] text-muted mt-0.5">{body}</p>}
      {link && <a href={link} onClick={(e) => { e.stopPropagation(); open(e); }} className="text-[14px] font-semibold text-coral-text">Open →</a>}
    </li>
  );
}

