import type { ReactNode } from 'react';
import { Skeleton } from '@octopus/ui';

/**
 * ODS T6 · My account frame layout (server-safe; no data). Used by app/ods/account/layout.tsx (slots wrapped in
 * <Suspense> with the skeletons below) and by the staging fixtures (slots rendered with sample props).
 *  - ≥ 768 px: [sidebar (sticky, full height)] [topbar + main]
 *  - phones: topbar (navy header) + main + the fixed BottomNav; the sidebar is not rendered.
 * `main#main` is the skip-link target; the bottom padding keeps content clear of the 60 px BottomNav on phones.
 * `sticky={false}` renders the sidebar inline (fixtures).
 */
export function AccountFrameShell({ sidebar, topbar, bottomNav, children, sticky = true }: { sidebar: ReactNode; topbar: ReactNode; bottomNav?: ReactNode; children: ReactNode; sticky?: boolean }) {
  return (
    <div className="flex min-h-screen bg-ods-canvas" data-testid="account-frame">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy focus:shadow-ods-pop"
      >
        Skip to content
      </a>
      <div className={sticky ? 'sticky top-0 hidden h-screen shrink-0 ods-tablet:block' : 'hidden min-h-screen shrink-0 ods-tablet:flex'}>{sidebar}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        <main id="main" tabIndex={-1} className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] focus:outline-none ods-tablet:pb-0">
          {children}
        </main>
      </div>
      {bottomNav}
    </div>
  );
}

/** Sidebar placeholder while the session loads (same widths: 72 px under 1200 px, 248 px from 1200 px). */
export function AccountSidebarSkeleton() {
  return (
    <div aria-hidden className="flex h-full w-[72px] flex-col gap-3 bg-ods-navy px-3 pt-4 ods-desktop:w-[248px]">
      <div className="h-10 rounded-ods-control bg-white/10" />
      <div className="mt-2 h-ods-control rounded-ods-control bg-white/10" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-[calc(var(--ods-control-h)-8px)] rounded-ods-control bg-white/5" />
      ))}
    </div>
  );
}

/** Topbar placeholder (same height; navy on phones like the real phone header). */
export function AccountTopbarSkeleton() {
  return (
    <div aria-hidden className="@container">
      <div className="flex min-h-[calc(var(--ods-control-h)+20px)] items-center gap-3 border-b border-ods-line bg-ods-navy px-ods-pad-page @min-[768px]:bg-ods-surface">
        <div className="hidden h-ods-control max-w-[520px] flex-1 rounded-ods-control bg-ods-canvas @min-[768px]:block" />
        <div className="ms-auto size-8 rounded-ods-pill bg-ods-line" />
      </div>
    </div>
  );
}

/** Page-level placeholder used by My account pages while their content streams. */
export function AccountPageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page">
      <Skeleton className="h-8 w-72" label={label} />
      <div className="mt-6 grid gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton silent className="h-56" />
        <Skeleton silent className="h-56" />
      </div>
    </div>
  );
}
