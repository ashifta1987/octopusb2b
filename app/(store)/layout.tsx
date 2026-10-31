import { Suspense } from 'react';
import { StoreHeader, StoreFooter } from '@/components/store-shell';

/** Storefront layout (SPEC §8.2): top bar + header + mega-menu, CMS footer. */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 btn btn-primary">Skip to content</a>
      {/* Header reads the session cookie → streamed; fixed-height fallback avoids layout shift. */}
      <Suspense fallback={<div className="h-[150px] bg-white border-b border-line" aria-hidden />}>
        <StoreHeader />
      </Suspense>
      <main id="main" className="flex-1">{children}</main>
      <Suspense fallback={<div className="h-[320px] bg-navy mt-16" aria-hidden />}>
        <StoreFooter />
      </Suspense>
    </div>
  );
}
