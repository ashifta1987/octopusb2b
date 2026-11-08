'use client';
import { useEffect, useState } from 'react';

/**
 * Unread notification count on the client (bug 1, 8 Nov 2026). The server count (my_notifications(), read_at empty) is
 * the source; opening a notification lowers every badge at once (side menu, header bell) before the server re-renders.
 */
const EVT = 'octopus:notifications-unread';
type Detail = { delta: number };

export function bumpUnread(delta: number) {
  window.dispatchEvent(new CustomEvent<Detail>(EVT, { detail: { delta } }));
}

export function useUnread(server: number) {
  const [st, setSt] = useState({ server, n: server });
  // a fresh server render (router.refresh / revalidatePath) is the truth again
  if (st.server !== server) setSt({ server, n: server });
  useEffect(() => {
    const h = (e: Event) => setSt((v) => ({ ...v, n: Math.max(0, v.n + (e as CustomEvent<Detail>).detail.delta) }));
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return st.n;
}

/** Count bubble for the "Notifications" item in the side menu (same look as the other menu badges). */
export function UnreadMenuBadge({ count }: { count: number }) {
  const n = useUnread(count);
  if (n <= 0) return null;
  return <span data-testid="nav-badge" data-unread={n} aria-label={`${n} new`} className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-coral text-white text-[12px] font-bold leading-[22px] text-center">{n}</span>;
}

/** Header bell dot + accessible label (shown on desktop and phone). */
export function UnreadBellDot({ count }: { count: number }) {
  const n = useUnread(count);
  return (
    <>
      <span className="sr-only" data-testid="bell-unread" data-unread={n}>{n ? `, ${n} unread` : ''}</span>
      {n > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-bad" aria-hidden />}
    </>
  );
}
