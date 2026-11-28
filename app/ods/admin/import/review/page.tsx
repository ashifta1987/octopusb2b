// ODS T9 · Catalogue › Import review queue. Replaces the T8 re-export of app/admin/import/review/page.tsx inside the ODS Back
// Office frame. Same guard (requireStaff('products','view')), the same reads as today (import_review_items, default markup,
// portal_products() for the hidden pricing columns + supplier costs), today's decideReview / setProductPricing unchanged;
// decisions and pricing only with products:edit, as today.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { portalProducts } from '@/components/backoffice/hidden-columns';
import { decideReview, setProductPricing } from '@/app/admin/import/actions';
import { isReviewTab } from '../../_catalogue/core';
import { ImportReviewScreen, type ReviewItem, type ReviewProduct } from '../_components/import-review';

export const metadata = { title: 'Import review' };

const ACTIONS = { decide: decideReview, setPricing: setProductPricing };
type SP = Promise<{ tab?: string; run?: string }>;

async function ReviewContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('products', 'view', '/admin/import/review');
  const sp = await searchParams;
  const tab = isReviewTab(sp.tab) ? sp.tab : 'open';
  const sb = await createClient();
  let q = sb.from('import_review_items').select('*').order('external_id').order('created_at').limit(500);
  if (sp.run) q = q.eq('run_id', sp.run);
  const [{ data: all, error }, { data: markup }] = await Promise.all([q, sb.from('site_settings').select('value').eq('key', 'pricing.default_markup_pct').maybeSingle()]);
  const items = error ? null : ((all ?? []) as ReviewItem[]);
  const pids = [...new Set((items ?? []).map((i) => i.product_id).filter(Boolean))] as string[];
  const { data: prods } = pids.length
    ? await portalProducts(sb).select('id, external_id, title, status, listing_status, markup_pct, sell_price_mode, min_price_cents, currency, moq, price_tiers(min_qty, unit_price_cents), product_costs(supplier_cost_cents)').in('id', pids).order('external_id')
    : { data: [] };
  const products: ReviewProduct[] = ((prods ?? []) as Record<string, unknown>[]).map((p) => {
    const cost = (Array.isArray(p.product_costs) ? p.product_costs[0] : p.product_costs) as { supplier_cost_cents: number } | null;
    return {
      id: String(p.id), external_id: String(p.external_id ?? ''), title: String(p.title ?? ''), status: String(p.status), listing_status: String(p.listing_status ?? ''),
      markup_pct: p.markup_pct == null ? null : Number(p.markup_pct), sell_price_mode: String(p.sell_price_mode ?? 'markup'), currency: String(p.currency ?? 'USD'),
      tiers: ((p.price_tiers ?? []) as { min_qty: number; unit_price_cents: number }[]), cost_cents: cost ? Number(cost.supplier_cost_cents) : null,
    };
  });
  return <ImportReviewScreen state="ok" items={items} products={products} tab={tab} run={sp.run ?? null} canEdit={can(s, 'products', 'edit')} defaultMarkup={Number(markup?.value ?? 25)} actions={ACTIONS} />;
}

export default function ImportReviewPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ImportReviewScreen state="loading" items={[]} products={[]} tab="open" run={null} canEdit={false} defaultMarkup={25} actions={ACTIONS} />}>
      <ReviewContent searchParams={searchParams} />
    </Suspense>
  );
}
