'use client';

import { useSyncExternalStore } from 'react';
import { formatClosing } from '../_lib/pool-logic';


const subscribe = () => () => {};
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Closing time in the CUSTOMER's time zone (the browser's), e.g. "2 Dec, 18:00 (Dubai time)". The server renders UTC
 * ("(UTC)") and the browser swaps in its own zone right after hydration (useSyncExternalStore), so no mismatch.
 */
export function ClosingTime({ iso, now, className }: { iso: string; /** Request time (ms) from the server, for the year rule. */ now: number; className?: string }) {
  const zone = useSyncExternalStore(subscribe, browserZone, () => 'UTC');
  return (
    <time dateTime={iso} className={className} data-testid="pool-closes">
      {formatClosing(iso, zone, new Date(now))}
    </time>
  );
}
