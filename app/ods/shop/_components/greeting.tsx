'use client';

import { useSyncExternalStore } from 'react';
import { greetingFor } from '../_lib/sections';

const noop = () => () => {};

/**
 * "Good morning / afternoon / evening" by the VISITOR's local time (Part 5.2). The server can't know the visitor's time
 * zone, so it renders the neutral "Welcome back" and the browser swaps in the greeting right after hydration
 * (useSyncExternalStore server snapshot → no hydration mismatch). `fixedHour` pins the hour (fixtures, screenshots).
 */
export function Greeting({ name, fixedHour }: { name?: string | null; fixedHour?: number }) {
  const text = useSyncExternalStore(
    noop,
    () => greetingFor(fixedHour ?? new Date().getHours()),
    () => (fixedHour !== undefined ? greetingFor(fixedHour) : 'Welcome back'),
  );
  return (
    <>
      {text}
      {name ? `, ${name}` : ''}
    </>
  );
}
