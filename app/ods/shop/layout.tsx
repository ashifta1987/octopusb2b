import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { AuthBroadcastListener } from '@octopus/ui';
import { getSiteContent } from '@/lib/content';
import { getShopFrameData } from './_lib/loaders';
import { SHOP_PATHS } from './_lib/sections';
import { ShopBottomNav, ShopTop, ShopTopSkeleton } from './_components/shop-frame';
import { ShopFooter } from './_components/shop-footer';

/**
 * ODS T4 · Shop frame (Part 5.1) for every /shop/* page (proxy rewrites /shop/* here when the Shop switch + ODS theme are
 * on). Skip link, ShopHeader + SectionBar (session data inside <Suspense> with a same-size skeleton), <main id="main">,
 * footer, the phone BottomNav, and AuthBroadcastListener mode="overlay" (Part 4.6: a sign-out in another tab shows
 * "You signed out" here). Hidden from search engines like today's shop layout.
 * `--shop-header-h` = the sticky header height (phones: logo row + search row; ≥ 768 px: 68 px) — the main page's sticky
 * JumpBar sits under it.
 */
export const metadata: Metadata = {
  title: { default: 'Shop', template: '%s · Octopus B2B Shop' },
  robots: { index: false, follow: false, nocache: true },
};

export default function OdsShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ods-canvas [--shop-header-h:124px] ods-tablet:[--shop-header-h:68px] [--ods-shop-sticky-top:var(--shop-header-h)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy focus:shadow-ods-pop"
      >
        Skip to content
      </a>
      <Suspense fallback={<ShopTopSkeleton />}>
        <FrameTop />
      </Suspense>
      <main id="main" tabIndex={-1} className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] focus:outline-none ods-tablet:pb-0">
        {children}
      </main>
      <Footer />
      <Suspense fallback={null}>
        <FrameBottomNav />
      </Suspense>
      <AuthBroadcastListener mode="overlay" />
    </div>
  );
}

async function FrameTop() {
  const f = await getShopFrameData();
  return (
    <ShopTop
      cartCount={f.viewer.cartCount}
      unread={f.viewer.unread}
      walletAvailable={f.viewer.walletAvailable}
      categories={f.categories}
      poolsOn={f.poolsOn}
      turnkeyOn={f.turnkeyOn}
      suggestUrl={SHOP_PATHS.suggest}
    />
  );
}

async function FrameBottomNav() {
  const f = await getShopFrameData();
  return <ShopBottomNav cartCount={f.viewer.cartCount} categories={f.categories} poolsOn={f.poolsOn} />;
}

/** Company profile is cached site content (no session), so the footer is part of the static shell. */
async function Footer() {
  const { company } = await getSiteContent();
  return <ShopFooter legalName={company?.legal_name} />;
}
