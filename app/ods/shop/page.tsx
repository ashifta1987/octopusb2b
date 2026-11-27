import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ServiceSectionBoundary } from '@octopus/ui';
import {
  getCompanyInterests, getRecentlyViewedCards, getShopFrameData, getWaitingTiles, loadSectionItems, resolveCategory,
  type ShopFrameData,
} from './_lib/loaders';
import { orderSections, seeAllHref, SHOP_SECTIONS, type ShopSectionKey } from './_lib/sections';
import { CategoryChips } from './_components/category-chips';
import { RecentlyViewed } from './_components/recently-viewed';
import { ShopServiceSection } from './_components/service-section';
import { JumpBarSlot, SectionSlot, ShopMainShell } from './_components/shop-main';
import { UnverifiedBanner } from './_components/unverified-banner';
import { WelcomeBar } from './_components/welcome-bar';

/**
 * ODS T4 · /shop — main page after login (Part 5.2; Match Shop_Main, M_Shop_Main, States-Shop). Public URL /shop is
 * rewritten here by proxy.ts. Everything that reads the session or the URL is inside <Suspense> (Cache Components);
 * every service section loads and fails on its own (Suspense + ServiceSectionBoundary + a caught error state), so one
 * failing section never blanks the page.
 * Data: getShopFrameData (company, wallet my_wallet_summary, kyc_status, role, dropship access), listWaiting (top 3, same
 * rules as My account), company_interests (first pick → first section; skipped while the table is missing),
 * loadSectionItems per section (top 4 by the list's default sort, filtered by ?category=), product_views (recently viewed).
 * Not done here: the "ships-to" filter (no per-product ships-to data yet) — the sections show everything we list.
 */
export const metadata: Metadata = { title: { absolute: 'Shop · Octopus B2B' } };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function ShopMainPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<MainFallback />}>
      <Main searchParams={searchParams} />
    </Suspense>
  );
}

function MainFallback() {
  const order = orderSections(null);
  return (
    <ShopMainShell
      welcome={<WelcomeBar firstName={null} orgName="Your company" walletAvailable={null} tiles="loading" />}
      chips={<div className="h-[calc(var(--ods-control-h)-4px)]" aria-hidden />}
      jump={<JumpBarSlot order={order} />}
      sections={order.map((k, i) => (
        <SectionSlot key={k} service={k} order={i + 1} category={null}>
          <ShopServiceSection service={k} status="loading" category={null} dropshipAccess={false} dropshipRequestHref="/account/dropship" canAct={false} />
        </SectionSlot>
      ))}
      recent={<RecentlyViewed items="loading" canAct={false} />}
    />
  );
}

async function Main({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const slug = typeof sp.category === 'string' ? sp.category : null;
  const [frame, interests, category] = await Promise.all([getShopFrameData(), getCompanyInterests().catch(() => []), resolveCategory(slug)]);
  const order = orderSections(interests);
  const cat = category ? { slug: category.slug, name: category.name } : null;
  const v = frame.viewer;
  return (
    <ShopMainShell
      welcome={
        <Suspense fallback={<WelcomeBar firstName={v.firstName} orgName={v.orgName} walletAvailable={v.walletAvailable} tiles="loading" />}>
          <Welcome frame={frame} />
        </Suspense>
      }
      banner={v.verified ? null : <UnverifiedBanner kycStatus={v.kycStatus} />}
      chips={<CategoryChips key={cat?.slug ?? 'all'} categories={frame.categories.map((c) => ({ slug: c.slug, name: c.name }))} value={cat?.slug ?? null} />}
      jump={
        <Suspense fallback={<JumpBarSlot order={order} />}>
          <Jump order={order} category={cat?.slug ?? null} />
        </Suspense>
      }
      sections={order.map((k, i) => (
        <SectionSlot key={`${k}-${cat?.slug ?? 'all'}`} service={k} order={i + 1} category={cat?.slug ?? null}>
          <ServiceSectionBoundary service={k} id={SHOP_SECTIONS[k].anchor} title={SHOP_SECTIONS[k].title} explainer={SHOP_SECTIONS[k].explainer} seeAllHref={seeAllHref(k, cat?.slug)} seeAllLabel={SHOP_SECTIONS[k].seeAllLabel}>
            <Suspense fallback={<ShopServiceSection service={k} status="loading" category={cat} dropshipAccess={v.dropshipAccess} dropshipRequestHref={v.dropshipRequestHref} canAct={v.canAct} />}>
              <Section service={k} category={cat} frame={frame} />
            </Suspense>
          </ServiceSectionBoundary>
        </SectionSlot>
      ))}
      recent={
        <Suspense fallback={<RecentlyViewed items="loading" canAct={v.canAct} />}>
          <Recent canAct={v.canAct} />
        </Suspense>
      }
    />
  );
}

async function Welcome({ frame }: { frame: ShopFrameData }) {
  const v = frame.viewer;
  const tiles = await getWaitingTiles(3).catch(() => null);
  return <WelcomeBar firstName={v.firstName} orgName={v.orgName} walletAvailable={v.walletAvailable} tiles={tiles} />;
}

async function Jump({ order, category }: { order: ShopSectionKey[]; category: string | null }) {
  const results = await Promise.allSettled(order.map((k) => loadSectionItems(k, { category })));
  const counts: Partial<Record<ShopSectionKey, number>> = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') counts[order[i]] = r.value.total;
  });
  return <JumpBarSlot order={order} counts={counts} />;
}

async function Section({ service, category, frame }: { service: ShopSectionKey; category: { slug: string; name: string } | null; frame: ShopFrameData }) {
  const v = frame.viewer;
  const common = { service, category, dropshipAccess: v.dropshipAccess, dropshipRequestHref: v.dropshipRequestHref, canAct: v.canAct };
  const r = await loadSectionItems(service, { category: category?.slug ?? null }).catch(() => null);
  if (!r) return <ShopServiceSection {...common} status="error" />;
  return <ShopServiceSection {...common} status="ready" items={r.items} total={r.total} />;
}

async function Recent({ canAct }: { canAct: boolean }) {
  const items = await getRecentlyViewedCards(4).catch(() => null);
  return <RecentlyViewed items={items} canAct={canAct} />;
}
