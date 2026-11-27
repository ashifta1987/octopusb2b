'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ServiceSection } from '@octopus/ui';
import type { ShopCardModel } from '../_lib/cards';
import { seeAllHref, SHOP_SECTIONS, type ShopSectionKey } from '../_lib/sections';
import { ShopCard } from './shop-card';

export type ShopServiceSectionProps = {
  service: ShopSectionKey;
  status: 'ready' | 'loading' | 'error';
  items?: ShopCardModel[];
  total?: number;
  /** The chosen category (slug + name) or null for all. */
  category: { slug: string; name: string } | null;
  dropshipAccess: boolean;
  dropshipRequestHref: string;
  canAct: boolean;
  /** Fixtures: no server actions; Try again does nothing harmful. */
  demo?: boolean;
};

const EMPTY_ALL: Record<ShopSectionKey, string> = {
  sourcing: 'No products listed yet',
  pools: 'No open MOQ pools right now',
  dropship: 'No dropshipping products listed yet',
  '3pl': 'No warehouse services listed yet',
  turnkey: 'No turnkey projects listed yet',
  brand: 'No branding options listed yet',
};

/**
 * ODS T4 · one service band on /shop (Part 5.2 §4) = @octopus/ui ServiceSection with the Shop's notes and cards:
 *  - Dropshipping without access: note "Prices and landed cost show after Dropship access is approved." + Request access;
 *    the cards carry no prices (mapper guarantee).
 *  - Warehouse: note "Rates are confirmed in your quote. Your stock and fees show in My account › Warehouse."
 *  - Sections that don't belong to product categories say "Shown for every category." while a category is chosen.
 *  - loading = skeleton cards; error = "We couldn’t load MOQ pools. · Try again" (router.refresh re-runs only the server
 *    render; the other sections keep showing); empty = "No MOQ pools in this category yet" (+ Show all categories).
 */
export function ShopServiceSection({ service, status, items = [], total, category, dropshipAccess, dropshipRequestHref, canAct, demo }: ShopServiceSectionProps) {
  const router = useRouter();
  const m = SHOP_SECTIONS[service];
  const filtered = m.byCategory && category;
  const notes: React.ReactNode[] = [];
  if (service === 'dropship' && !dropshipAccess) {
    notes.push(
      <span key="ds">
        Prices and landed cost show after Dropship access is approved.{' '}
        <Link href={dropshipRequestHref} className="font-semibold underline underline-offset-4" data-testid="dropship-request-access">
          Request access
        </Link>
      </span>,
    );
  }
  if (service === '3pl') notes.push(<span key="wh">Rates are confirmed in your quote. Your stock and fees show in My account › Warehouse.</span>);
  if (category && !m.byCategory) notes.push(<span key="cat"> Shown for every category.</span>);

  return (
    <ServiceSection
      service={service}
      id={m.anchor}
      className="scroll-mt-[calc(var(--shop-header-h,68px)+72px)]"
      title={m.title}
      explainer={m.explainer}
      count={status === 'ready' ? (total ?? items.length) : undefined}
      countLabel={status === 'ready' ? m.countLabel(total ?? items.length) : undefined}
      seeAllHref={seeAllHref(service, category?.slug)}
      seeAllLabel={m.seeAllLabel}
      note={notes.length ? <>{notes}</> : undefined}
      loading={status === 'loading'}
      error={status === 'error'}
      onRetry={() => {
        if (!demo) router.refresh();
      }}
      empty={status === 'ready' && items.length === 0}
      emptyTitle={filtered ? undefined : EMPTY_ALL[service]}
      emptyAction={
        filtered ? (
          <Link href="/shop" scroll={false} className="font-semibold text-ods-blue underline underline-offset-4">
            Show all categories
          </Link>
        ) : undefined
      }
    >
      {items.map((it) => (
        <ShopCard key={it.id} model={it} canAct={canAct} demo={demo} />
      ))}
    </ServiceSection>
  );
}
