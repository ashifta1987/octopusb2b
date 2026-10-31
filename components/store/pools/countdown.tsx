'use client';
import { useSyncExternalStore } from 'react';
import { timeLeft } from './shared';

const TICK = 30_000;
const subscribe = (cb: () => void) => { const t = setInterval(cb, TICK); return () => clearInterval(t); };
const snapshot = () => Math.floor(Date.now() / TICK) * TICK;
const serverSnapshot = () => null;

/** Live countdown to `to` (ISO). Server render shows the closing date; the client takes over with "2d 14h" etc. */
export function Countdown({ to, withMinutes = false, prefix = '', suffix = '', className }: {
  to: string; withMinutes?: boolean; prefix?: string; suffix?: string; className?: string;
}) {
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const date = new Date(to);
  const fallback = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const text = now == null ? fallback : timeLeft(to, now, withMinutes);
  return (
    <time dateTime={to} className={className} title={date.toUTCString()} suppressHydrationWarning>
      {text === 'Closed' ? 'Closed' : `${prefix}${text}${suffix}`}
    </time>
  );
}
