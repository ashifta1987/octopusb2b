import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { Logo, OdsThemeRoot } from '@octopus/ui';
import { DevNav } from './dev-nav';

/** ODS 1.0 · T2 component gallery. Staging and local only (404 on live), like /dev/ui. Rendered under data-theme="ods". */
export default function DevComponentsLayout({ children }: { children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:text-ods-navy"
      >
        Skip to content
      </a>
      <header className="border-b border-ods-line bg-ods-surface">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center gap-x-6 gap-y-2 px-ods-pad-page py-3">
          <Logo variant="mark" area="public" priority />
          <DevNav />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-ods-content px-ods-pad-page pt-8 pb-24">
        {children}
      </main>
    </OdsThemeRoot>
  );
}
