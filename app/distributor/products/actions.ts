'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { slugify, toCents } from '@/lib/format';
import { actionSession, fail, ok, type Result } from '@/components/backoffice/server-utils';
import { productSchema, draftSchema, type ProductFormValues } from '@/components/backoffice/product-schema';

type Sb = Awaited<ReturnType<typeof createClient>>;

async function checkSupplier(sb: Sb, supplierId: string) {
  const { data: sw } = await sb.from('supplier_switches').select('product_upload').eq('supplier_id', supplierId).maybeSingle();
  const { data: sup } = await sb.from('suppliers').select('id').eq('id', supplierId).maybeSingle();
  if (!sup) return 'This supplier is not assigned to you.';
  if (sw && sw.product_upload === false) return 'Product upload is switched off for this supplier.';
  return null;
}

async function replaceChildren(sb: Sb, id: string, v: ProductFormValues) {
  const tiers = (v.tiers ?? []).filter((t) => Number.isFinite(t.min_qty) && Number.isFinite(t.price_usd));
  const del = await Promise.all([
    sb.from('price_tiers').delete().eq('product_id', id),
    sb.from('product_specs').delete().eq('product_id', id),
    sb.from('product_tags').delete().eq('product_id', id),
    sb.from('product_certificates').delete().eq('product_id', id),
    sb.from('product_media').delete().eq('product_id', id),
  ]);
  const de = del.find((r) => r.error)?.error;
  if (de) return de;
  const seen = new Set<number>();
  const tierRows = tiers.filter((t) => !seen.has(t.min_qty) && seen.add(t.min_qty))
    .map((t) => ({ product_id: id, min_qty: t.min_qty, unit_price_cents: toCents(t.price_usd) }));
  const ins = await Promise.all([
    tierRows.length ? sb.from('price_tiers').insert(tierRows) : null,
    v.specs?.length ? sb.from('product_specs').insert(v.specs.filter((s) => s.name && s.value).map((s, i) => ({ product_id: id, name: s.name, value: s.value, sort: i + 1 }))) : null,
    v.tag_ids?.length ? sb.from('product_tags').insert(v.tag_ids.map((t) => ({ product_id: id, tag_id: t }))) : null,
    v.certificate_ids?.length ? sb.from('product_certificates').insert(v.certificate_ids.map((c) => ({ product_id: id, certificate_id: c }))) : null,
    v.images?.length ? sb.from('product_media').insert(v.images.map((url, i) => ({ product_id: id, url, sort: i, alt: v.title }))) : null,
  ]);
  return ins.find((r) => r?.error)?.error ?? null;
}

function columns(v: ProductFormValues) {
  const prices = (v.tiers ?? []).map((t) => toCents(t.price_usd)).filter((n) => Number.isFinite(n));
  return {
    title: v.title.trim(),
    supplier_id: v.supplier_id,
    category_id: v.category_id || null,
    unit: v.unit || 'pcs',
    moq: Number.isFinite(v.moq) && v.moq > 0 ? v.moq : 1,
    lead_time_days: v.lead_time_days ?? null,
    incoterm: v.incoterm || null,
    origin_country: v.origin_country ? v.origin_country.toUpperCase() : null,
    hs_code: v.hs_code || null,
    octopus_dropship: !!v.octopus_dropship,
    ready_to_ship: !!v.ready_to_ship,
    description: v.description || null,
    seo_title: v.seo_title || null,
    seo_description: v.seo_description || null,
    image_url: v.images?.[0] ?? null,
    min_price_cents: prices.length ? Math.min(...prices) : null,
  };
}

/**
 * Create or update a product with all child rows. `mode = 'draft'` (autosave) only needs title + supplier;
 * `mode = 'full'` validates everything. Returns the product id.
 */
export async function saveProduct(id: string | null, values: ProductFormValues, mode: 'draft' | 'full' = 'full'): Promise<Result<{ id: string }>> {
  const g = await actionSession('products', id ? 'edit' : 'create');
  if ('error' in g) return fail(g.error);
  if (mode === 'full') {
    const p = productSchema.safeParse(values);
    if (!p.success) return fail(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; '));
  } else if (!draftSchema.safeParse(values).success) {
    return fail('Add a title and supplier to save a draft.');
  }
  const sb = await createClient();
  const block = await checkSupplier(sb, values.supplier_id);
  if (block) return fail(block);
  const cols = columns(values);
  let pid = id;
  if (pid) {
    const { data: cur } = await sb.from('products').select('status').eq('id', pid).maybeSingle();
    if (!cur) return fail('Product not found or not editable.');
    if (mode === 'draft' && !['draft', 'rejected'].includes(cur.status)) return fail('Autosave only runs on drafts.');
    const { error, data } = await sb.from('products').update(cols).eq('id', pid).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('You cannot edit this product.');
  } else {
    const slug = `${slugify(cols.title).slice(0, 80)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await sb.from('products').insert({ ...cols, slug, status: 'draft', created_by: g.s.userId }).select('id').single();
    if (error) return fail(error);
    pid = data.id as string;
  }
  const ce = await replaceChildren(sb, pid!, values);
  if (ce) return fail(ce);
  if (mode === 'draft') return ok({ id: pid! }, 'Draft saved'); // no route refresh while typing
  revalidatePath('/distributor/products');
  revalidateTag('products', 'max');
  return ok({ id: pid! }, 'Saved');
}

/** Status moves go through transition_product (draft→submitted, live↔paused, →archived). */
export async function transitionProduct(id: string, to: 'submitted' | 'paused' | 'live' | 'archived', reason?: string): Promise<Result> {
  const g = await actionSession('products', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  if (to === 'submitted') {
    const { data: p } = await sb.from('products').select('title, category_id, price_tiers(id)').eq('id', id).maybeSingle();
    if (!p) return fail('Product not found');
    if (!p.category_id) return fail('Choose a category before submitting.');
    if (!(p.price_tiers as unknown[] | null)?.length) return fail('Add at least one price tier before submitting.');
  }
  const { error } = await sb.rpc('transition_product', { p_product: id, p_to: to, p_reason: reason ?? null });
  if (error) return fail(error);
  revalidatePath('/distributor/products');
  revalidateTag('products', 'max');
  return ok(undefined, to === 'submitted' ? 'Submitted for moderation' : 'Updated');
}
