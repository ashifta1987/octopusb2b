'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Dropshipping catalogue v2 — merchant import list and selling-countries actions.
 *  · All prices are parsed strictly into integer cents (no floating-point Number(...) * 100 maths).
 *  · All input is validated server-side with zod.
 *  · RLS limits rows to the merchant's own company; selling-countries changes are audited in set_dropship_markets().
 */

/** Parse a US$ string ("29.99", "29", "2999" when cents) into integer cents without floating-point arithmetic. */
function parseUsdToCents(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const fracStr = (m[2] ?? '').padEnd(2, '0');
  const frac = Number(fracStr);
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const AddSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
  service: z.enum(['express', 'standard', 'economy']).optional().nullable(),
  price_cents: z.number().int().positive().max(100_000_000).optional().nullable(),
});

const RemoveSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
});

const MarketsSchema = z.object({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1, 'Choose at least one selling country').max(40),
});

export async function addToImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const rawVariant = String(formData.get('variant_id') ?? '').trim();
  const rawService = String(formData.get('service') ?? '').trim();
  const rawPriceCents = String(formData.get('price_cents') ?? '').trim();
  const rawPriceUsd = String(formData.get('price') ?? '').trim();

  const priceCents =
    /^\d+$/.test(rawPriceCents) && Number(rawPriceCents) > 0
      ? Number(rawPriceCents)
      : parseUsdToCents(rawPriceUsd);

  const parsed = AddSchema.safeParse({
    product_id: String(formData.get('product_id') ?? '').trim(),
    variant_id: rawVariant ? rawVariant : null,
    service: ['express', 'standard', 'economy'].includes(rawService) ? rawService : null,
    price_cents: priceCents,
  });
  if (!parsed.success) throw new Error('Invalid import list item');

  const sb = await createClient();
  // Remove existing row for (org_id, product_id) first so toggling from card or detail page updates cleanly
  await sb.from('dropship_import_list').delete().eq('org_id', s.org!.id).eq('product_id', parsed.data.product_id);
  const { error } = await sb.from('dropship_import_list').insert({
    org_id: s.org!.id,
    product_id: parsed.data.product_id,
    variant_id: parsed.data.variant_id ?? null,
    service: parsed.data.service ?? null,
    price_cents: parsed.data.price_cents ?? null,
    added_by: s.userId,
  });
  if (error) throw new Error(`Could not add to your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

export async function removeFromImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const rawVariant = String(formData.get('variant_id') ?? '').trim();
  const parsed = RemoveSchema.safeParse({
    product_id: String(formData.get('product_id') ?? '').trim(),
    variant_id: rawVariant ? rawVariant : null,
  });
  if (!parsed.success) throw new Error('Invalid product');

  const sb = await createClient();
  let q = sb.from('dropship_import_list').delete().eq('org_id', s.org!.id).eq('product_id', parsed.data.product_id);
  if (parsed.data.variant_id) q = q.eq('variant_id', parsed.data.variant_id);
  const { error } = await q;
  if (error) throw new Error(`Could not remove it from your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

export async function saveMerchantMarkets(formData: FormData) {
  await requireCustomer('/account/dropship/catalogue');
  const countries = formData
    .getAll('countries')
    .map((c) => String(c).toUpperCase().trim())
    .filter(Boolean);
  const parsed = MarketsSchema.safeParse({ countries });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Choose at least one selling country');

  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_markets', {
    p_countries: parsed.data.countries,
    p_org_id: null,
    p_lock: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/account/dropship/catalogue', 'layout');
}
