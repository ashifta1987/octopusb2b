'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guard, fail, ok, type Result } from '@/components/admin/server';
import { previewHsBackfill, applyHsBackfill } from '@/lib/hs/server';

/** Admin → HS codes. Confirm / change are RPCs that re-check permissions and write the audit log per product. */

const done = (m: string) => { revalidatePath('/admin/hs-codes'); revalidatePath('/office/products'); revalidateTag('products', 'max'); return ok(m); };

export async function confirmHsType(typeId: string): Promise<Result> {
  const g = await guard('products', 'approve'); if ('error' in g) return g.error;
  const { data, error } = await g.sb.rpc('confirm_hs_type', { p_type: typeId });
  if (error) return fail(error.message.replace(/^HS_NO_HEADING:\s*/, ''));
  const r = data as { type: string; heading: string; products_confirmed: number };
  return done(`${r.type}: heading ${r.heading} confirmed · ${r.products_confirmed} product${r.products_confirmed === 1 ? '' : 's'} updated`);
}

export async function changeHsHeading(typeId: string, heading: string): Promise<Result> {
  const g = await guard('products', 'approve'); if ('error' in g) return g.error;
  if (!/^[0-9]{4}$/.test(heading.trim())) return fail('The heading must be exactly 4 digits (e.g. 8414).');
  const { data, error } = await g.sb.rpc('change_hs_type_heading', { p_type: typeId, p_heading: heading.trim() });
  if (error) return fail(error.message.replace(/^HS_BAD_HEADING:\s*/, ''));
  const r = data as { type: string; heading: string; products_updated: number };
  return done(`${r.type}: heading changed to ${r.heading} · ${r.products_updated} product${r.products_updated === 1 ? '' : 's'} updated`);
}

export async function runBackfillPreview(): Promise<Result> {
  const g = await guard('products', 'approve'); if ('error' in g) return g.error;
  const r = await previewHsBackfill();
  revalidatePath('/admin/hs-codes');
  return ok(`Preview ready: ${r.proposals} of ${r.products} products · ${r.aiCalls} AI call${r.aiCalls === 1 ? '' : 's'}. Nothing applied yet.`);
}

export async function applyBackfill(): Promise<Result> {
  const g = await guard('products', 'approve'); if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can apply the HS backfill.');
  const n = await applyHsBackfill(g.s.userId);
  return done(`Applied to ${n} products`);
}

