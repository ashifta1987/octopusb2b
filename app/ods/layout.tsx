import type { ReactNode } from 'react';
import { OdsThemeRoot } from '@octopus/ui';

/**
 * ODS 1.0 (T3+) route tree for the introduction site and sign-in. Never requested directly: proxy.ts rewrites the public
 * URLs (/, /services/*, /login, /welcome/setup …) here only when the ods_theme_v1 switch (or the staging preview cookie)
 * is on for the visitor, and answers 404 for /ods/* itself. Switch off → these pages are never used.
 * Each area layout mounts its own AuthBroadcastListener (Part 4.6): introduction/sign-in = refresh, Shop = overlay.
 */
export default function OdsLayout({ children }: { children: ReactNode }) {
  return (
    <OdsThemeRoot density="comfortable" className="flex min-h-screen flex-col">
      {children}
    </OdsThemeRoot>
  );
}
