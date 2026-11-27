import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OdsThemeRoot, ServiceSectionBoundary } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { orderSections, seeAllHref, SHOP_SECTIONS } from '@/app/ods/shop/_lib/sections';
import { ShopBottomNav, ShopTop } from '@/app/ods/shop/_components/shop-frame';
import { ShopFooter } from '@/app/ods/shop/_components/shop-footer';
import { WelcomeBar } from '@/app/ods/shop/_components/welcome-bar';
import { UnverifiedBanner } from '@/app/ods/shop/_components/unverified-banner';
import { CategoryChips } from '@/app/ods/shop/_components/category-chips';
import { ShopServiceSection } from '@/app/ods/shop/_components/service-section';
import { RecentlyViewed } from '@/app/ods/shop/_components/recently-viewed';
import { JumpBarSlot, SectionSlot, ShopMainShell } from '@/app/ods/shop/_components/shop-main';
import { SAMPLE_CATEGORIES, SAMPLE_RECENT, SAMPLE_TILES, sampleSection } from './sample-data';

export const metadata: Metadata = { title: 'Shop main · ODS screens (staging)', robots: { index: false, follow: false } };

const STATES = [
  ['normal', 'Normal'],
  ['nothing-waiting', 'Nothing waiting'],
  ['loading', 'One section loading'],
  ['failed', 'One section failed'],
  ['empty', 'Empty category'],
  ['unverified', 'Not verified'],
  ['no-dropship', 'No Dropship access'],
] as const;
type State = (typeof STATES)[number][0];

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Staging-only fixture (CONVENTIONS "Signed-in pages and testing"): the full Shop frame + /shop main page with SAMPLE
 * props, rendered by the same presentational components as the real page. `?state=` picks a state (see STATES),
 * `?category=<slug>` filters every section (the chips set it), `?interest=<service>` moves that section to the top (setup
 * choice). The search box uses the sample suggestions route ./suggest.
 */
export default function ShopMainFixture({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <div className="flex min-h-screen flex-col bg-ods-canvas [--shop-header-h:124px] ods-tablet:[--shop-header-h:68px]">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy">
          Skip to content
        </a>
        <ShopTop cartCount={8} unread={3} walletAvailable={4250} categories={SAMPLE_CATEGORIES} poolsOn turnkeyOn suggestUrl="/dev/ui/screens/shop-main/suggest" path="/shop" />
        <main id="main" tabIndex={-1} className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] focus:outline-none ods-tablet:pb-0">
          <Suspense fallback={null}>
            <Content searchParams={searchParams} />
          </Suspense>
        </main>
        <ShopFooter legalName="Shenzhen Octopus Trading Co., Ltd. (sample)" />
        <ShopBottomNav cartCount={8} categories={SAMPLE_CATEGORIES} poolsOn path="/shop" />
      </div>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const state: State = STATES.some(([k]) => k === sp.state) ? (sp.state as State) : 'normal';
  const catSlug = typeof sp.category === 'string' ? sp.category : state === 'empty' ? 'toys' : null;
  const found = SAMPLE_CATEGORIES.find((c) => c.slug === catSlug);
  const cat = found ? { slug: found.slug, name: found.name } : null;
  const order = orderSections(typeof sp.interest === 'string' ? [sp.interest] : null);
  const access = state !== 'no-dropship';
  const verified = state !== 'unverified';
  const qs = (k: string) => {
    const p = new URLSearchParams();
    if (k !== 'normal') p.set('state', k);
    if (typeof sp.interest === 'string') p.set('interest', sp.interest);
    return `/dev/ui/screens/shop-main${p.size ? `?${p}` : ''}`;
  };
  const data = Object.fromEntries(order.map((k) => [k, sampleSection(k, cat?.slug ?? null, access)])) as Record<(typeof order)[number], ReturnType<typeof sampleSection>>;

  return (
    <>
      <nav aria-label="Fixture states" data-testid="fixture-states" className="border-b border-ods-line bg-ods-warning-tint">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center gap-x-4 gap-y-1 px-ods-pad-page py-2 text-ods-small">
          <span className="font-semibold text-ods-navy">Sample data for design review only · State:</span>
          {STATES.map(([k, label]) => (
            <Link key={k} href={qs(k)} aria-current={k === state ? 'page' : undefined} className={k === state ? 'inline-flex min-h-8 items-center font-bold text-ods-navy underline underline-offset-4' : 'inline-flex min-h-8 items-center text-ods-blue underline underline-offset-4'}>
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <ShopMainShell
        welcome={<WelcomeBar firstName="Anna" orgName="Anna Home Trading" walletAvailable={4250} tiles={state === 'nothing-waiting' ? [] : SAMPLE_TILES} fixedHour={14} />}
        banner={verified ? null : <UnverifiedBanner kycStatus="not_started" />}
        chips={<CategoryChips key={cat?.slug ?? 'all'} categories={SAMPLE_CATEGORIES} value={cat?.slug ?? null} />}
        jump={<JumpBarSlot order={order} counts={Object.fromEntries(order.filter((k) => !(k === 'pools' && (state === 'loading' || state === 'failed'))).map((k) => [k, data[k].total]))} />}
        sections={order.map((k, i) => {
          const status = k === 'pools' && state === 'loading' ? 'loading' : k === 'pools' && state === 'failed' ? 'error' : 'ready';
          return (
            <SectionSlot key={`${k}-${cat?.slug ?? 'all'}`} service={k} order={i + 1} category={cat?.slug ?? null}>
              <ServiceSectionBoundary service={k} id={SHOP_SECTIONS[k].anchor} title={SHOP_SECTIONS[k].title} explainer={SHOP_SECTIONS[k].explainer} seeAllHref={seeAllHref(k, cat?.slug)} seeAllLabel={SHOP_SECTIONS[k].seeAllLabel}>
                <ShopServiceSection service={k} status={status} items={data[k].items} total={data[k].total} category={cat} dropshipAccess={access} dropshipRequestHref="/account/dropship" canAct demo />
              </ServiceSectionBoundary>
            </SectionSlot>
          );
        })}
        recent={<RecentlyViewed items={SAMPLE_RECENT} canAct demo />}
      />
    </>
  );
}
