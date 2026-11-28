// ODS T9 · Catalogue › HS codes. Replaces the T8 re-export of app/admin/hs-codes/page.tsx inside the ODS Back Office frame.
// Same guard (requireStaff('products','approve')), the same reads as today (hs_product_types, portal_products() HS columns,
// hs_backfill_proposals + hidden skus), today's actions unchanged (confirmHsType / changeHsHeading / runBackfillPreview /
// applyBackfill — Admin only); the change preview is today's hs_type_change_preview read.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { hiddenColumnsByIds, portalProducts } from '@/components/backoffice/hidden-columns';
import { confirmHsType, changeHsHeading, runBackfillPreview, applyBackfill } from '@/app/admin/hs-codes/actions';
import { hsUsage } from '../_catalogue/core';
import { previewHsChangeAction } from './actions';
import { HsCodesScreen, type HsProposal, type HsType } from './_components/hs-codes-screen';

export const metadata = { title: 'HS codes' };

const ACTIONS = { confirm: confirmHsType, change: changeHsHeading, preview: previewHsChangeAction, backfillPreview: runBackfillPreview, backfillApply: applyBackfill };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function HsContent() {
  const s = await requireStaff('products', 'approve', '/admin/hs-codes');
  const sb = await createClient();
  const [{ data: types, error }, { data: prods }, { data: props }] = await Promise.all([
    sb.from('hs_product_types').select('id, name, type_key, heading, confirmed, source, confidence, reason, keywords').order('name'),
    portalProducts(sb).select('hs_product_type_id, hs_code_status, hs_code_source').is('archived_at', null).limit(10000),
    sb.from('hs_backfill_proposals').select('product_id, heading, source, status, confidence, note, products(title), hs_product_types(name)').order('status'),
  ]);
  const skus = await hiddenColumnsByIds<{ id: string; sku: string | null }>('products', (props ?? []).map((p) => p.product_id as string), 'sku');
  const u = hsUsage((prods ?? []) as { hs_product_type_id: string | null; hs_code_status: string | null }[]);
  const rows: HsType[] | null = error
    ? null
    : ((types ?? []) as Record<string, unknown>[]).map((t) => {
        const x = u.use.get(String(t.id)) ?? { total: 0, suggested: 0 };
        return { id: String(t.id), name: String(t.name), type_key: String(t.type_key), heading: (t.heading as string | null) ?? null, confirmed: !!t.confirmed, source: String(t.source ?? ''), confidence: t.confidence == null ? null : Number(t.confidence), reason: (t.reason as string | null) ?? null, total: x.total, suggested: x.suggested };
      });
  const proposals: HsProposal[] = ((props ?? []) as Record<string, unknown>[]).map((p) => ({
    product_id: String(p.product_id),
    sku: skus.get(String(p.product_id))?.sku ?? null,
    title: one(p.products as { title: string } | null)?.title ?? null,
    heading: (p.heading as string | null) ?? null,
    type_name: one(p.hs_product_types as { name: string } | null)?.name ?? null,
    source: (p.source as string | null) ?? null,
    confidence: p.confidence == null ? null : Number(p.confidence),
    status: String(p.status),
    note: (p.note as string | null) ?? null,
  }));
  return <HsCodesScreen state="ok" types={rows} proposals={proposals} counts={{ confirmed: u.confirmed, suggested: u.suggested, missing: u.missing }} canEdit={can(s, 'products', 'approve')} isAdmin={s.isAdmin} actions={ACTIONS} />;
}

export default function HsCodesPage() {
  return (
    <Suspense fallback={<HsCodesScreen state="loading" types={[]} proposals={[]} counts={{ confirmed: 0, suggested: 0, missing: 0 }} canEdit={false} isAdmin={false} actions={ACTIONS} />}>
      <HsContent />
    </Suspense>
  );
}
