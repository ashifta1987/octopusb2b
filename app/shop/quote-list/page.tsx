import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getCardsByIds, getServices } from '@/components/store/data';
import { money } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { getShopViewer, getQuoteList } from '@/lib/shop/data';
import { shopCan, ROLE_REASON } from '@/lib/shop/shared';
import { fromPrice } from '@/components/shop/shop-card';
import { QuoteListClient, type QuoteLine } from '@/components/shop/quote-list-client';

export const metadata: Metadata = { title: 'Quote list' };

/** CH-1 Quote list (new): several products → ONE request (one RFQ code, one sourcing fee from settings). */
export default function QuoteListPage() {
  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-6">
      <h1 className="m-0 text-[28px] sm:text-[34px] font-bold">Quote list</h1>
      <p className="m-0 mt-1 text-[15px] text-black">Add several products, then send them to our sourcing team as one request.</p>
      <Suspense fallback={<div className="mt-6 card h-[320px]" aria-busy="true" aria-label="Loading your quote list" />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  const v = await getShopViewer();
  const [rows, services] = await Promise.all([getQuoteList(v.org.id), getServices()]);
  const cards = await getCardsByIds(rows.map((r) => r.product_id));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const lines: QuoteLine[] = rows.map((r) => {
    const c = byId.get(r.product_id);
    return {
      id: r.id, productId: r.product_id, quantity: r.quantity, notes: r.notes ?? '',
      title: c?.title ?? 'No longer available', slug: c?.slug ?? null, image: c?.image_url ?? null, unit: c?.unit ?? 'pcs',
      moq: c?.moq ?? 1, available: !!c, price: c ? fromPrice(c) : null, currency: c?.currency ?? 'USD',
    };
  });
  const fee = services.rfq;
  const feeLabel = fee ? (fee.priceCents > 0 ? `${money(fee.priceCents, fee.currency)} for the whole request` : 'free') : 'not set';
  if (!lines.length) {
    return (
      <div className="mt-6 card" data-testid="quote-list-empty">
        <EmptyState title="Your quote list is empty" body="Add products from the shop with “Add to quote list”, then send them as one request."
          action={<Link href="/shop/products" className="btn btn-primary">Browse products</Link>} />
      </div>
    );
  }
  return <QuoteListClient lines={lines} canAct={shopCan(v.role)} roleReason={ROLE_REASON} defaultCountry={v.org.country} feeLabel={feeLabel} />;
}
