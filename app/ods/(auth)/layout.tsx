import type { ReactNode } from 'react';
import { AuthBroadcastListener } from '@octopus/ui/components/auth-broadcast';

/**
 * ODS sign-in pages (/login, /welcome/setup, /invite/<token>): no PublicHeader — each page draws the board's own frame
 * (sign-in side panel, setup header). OdsThemeRoot comes from app/ods/layout.tsx; the sign-out listener refreshes this tab.
 */
export default function OdsAuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:text-ods-navy"
      >
        Skip to content
      </a>
      {children}
      <AuthBroadcastListener mode="refresh" />
    </>
  );
}
