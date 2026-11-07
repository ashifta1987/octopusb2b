'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** ADDON-44-E — import list (the products a seller wants to push to their store). RLS limits rows to the seller's company. */
const UUID = /^[0-9a-f-]{36}$/i;

export async function addToImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const productId = String(formData.get('product_id') ?? '');
  if (!UUID.test(productId)) throw new Error('Invalid product');
  const variant = String(formData.get('variant_id') ?? '');
  const service = String(formData.get('service') ?? '');
  const price = Math.round(Number(formData.get('price') ?? 0) * 100);
  const sb = await createClient();
  const { error } = await sb.from('dropship_import_list').upsert({
    org_id: s.org!.id, product_id: productId, added_by: s.userId,
    variant_id: UUID.test(variant) ? variant : null,
    service: ['express', 'standard', 'economy'].includes(service) ? service : null,
    price_cents: price > 0 ? price : null,
  });
  if (error) throw new Error(`Could not add to your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

export async function removeFromImportList(formData: FormData) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const productId = String(formData.get('product_id') ?? '');
  if (!UUID.test(productId)) throw new Error('Invalid product');
  const sb = await createClient();
  const { error } = await sb.from('dropship_import_list').delete().eq('org_id', s.org!.id).eq('product_id', productId);
  if (error) throw new Error(`Could not remove it from your import list: ${error.message}`);
  revalidatePath('/account/dropship/catalogue', 'layout');
}

