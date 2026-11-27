import type { ReactNode } from 'react';
import { Send } from 'lucide-react';
import { buttonClass, Icon } from '@octopus/ui';
import Link from 'next/link';
import { SHOP_SECTIONS, type ShopSectionKey } from '../_lib/sections';
import { ShopJumpBar } from './shop-jump-bar';

/**
 * ODS T4 · /shop main page layout (Part 5.2, Shop_Main / M_Shop_Main), presentational slots so the real page (each slot
 * streams in its own <Suspense>) and the staging fixture render the same markup:
 * welcome bar → (not-verified banner) → category chips → sticky JumpBar → six service sections → Recently viewed →
 * "Can't find what you need?".
 */
export function ShopMainShell({ welcome, banner, chips, jump, sections, recent }: { welcome: ReactNode; banner?: ReactNode; chips: ReactNode; jump: ReactNode; sections: ReactNode; recent: ReactNode }) {
  return (
    <div data-testid="shop-main" className="mx-auto flex w-full max-w-ods-content min-w-0 flex-col gap-6 px-ods-pad-page py-6">
      {welcome}
      {banner}
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="sr-only">Categories</h2>
        {chips}
      </div>
      {jump}
      <div className="flex min-w-0 flex-col gap-6">{sections}</div>
      {recent}
      <RequestProductPanel />
    </div>
  );
}

/** Wrapper of one service section: e2e hooks (order, service, category) that stay put while the section loads or fails. */
export function SectionSlot({ service, order, category, children }: { service: ShopSectionKey; order: number; category: string | null; children: ReactNode }) {
  return (
    <div data-testid="service-section" data-service={service} data-order={order} data-category={category ?? 'all'} className="min-w-0">
      {children}
    </div>
  );
}

/** The sticky JumpBar under the Shop header (top = --shop-header-h, set by the Shop layout / fixture frame). */
export function JumpBarSlot({ order, counts }: { order: ShopSectionKey[]; counts?: Partial<Record<ShopSectionKey, number>> }) {
  return (
    <div className="sticky top-(--shop-header-h) z-(--z-sticky) min-w-0 rounded-ods-control border border-ods-line bg-ods-surface px-3" data-testid="jump-bar">
      <ShopJumpBar sections={order.map((k) => ({ service: k, targetId: SHOP_SECTIONS[k].anchor, count: counts?.[k], label: SHOP_SECTIONS[k].title }))} />
    </div>
  );
}

export function RequestProductPanel() {
  return (
    <section aria-labelledby="request-heading" data-testid="request-product" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
      <div className="min-w-0">
        <h2 id="request-heading" className="m-0 text-ods-body font-bold text-ods-navy">
          Can’t find what you need?
        </h2>
        <p className="m-0 mt-1 text-ods-small text-ods-slate">Tell us the product, quantity and target price. Our sourcing team finds it and sends you quotes.</p>
      </div>
      <Link href="/request/sourcing" className={`${buttonClass('primary', 'md')} shrink-0 self-start ods-tablet:self-center`}>
        <Icon icon={Send} />
        Request a product
      </Link>
    </section>
  );
}
