'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Tiny client store for "is the visitor signed in?" on the introduction site. The header resolves the session inside
 * <Suspense> (Cache Components: the page itself stays static) and reports it here; every Continue with Google button
 * reads it and switches to "/shop" when signed in. Signed out (or not known yet) = the sign-in link.
 */
export type SiteUser = { name: string } | null;

let current: SiteUser = null;
const listeners = new Set<() => void>();

function set(u: SiteUser) {
  if (current?.name === u?.name) return;
  current = u;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSiteUser(): SiteUser {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Rendered by the header once the session is known. */
export function ReportSiteUser({ user }: { user: SiteUser }) {
  useEffect(() => {
    set(user);
  }, [user]);
  return null;
}
