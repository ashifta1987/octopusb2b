'use server';

import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cleanQuery, searchableKinds, SEARCH_LIMIT, toPaletteItems, type PaletteRecord, type RecordKind, type SearchRows } from './search-core';
import type { OfficePerms } from './nav';

/**
 * ODS T8 · command palette record search (Part 7.1), called debounced from the palette (query ≥ 2 characters).
 * Read-only SELECTs with the staff member's OWN session (createClient → row-level security), the same tables and
 * columns today's list pages read; only the record kinds the person may open are queried (search-core RECORD_RULES).
 * Signed out / not staff / not 2FA-verified → no results (the proxy and page guards handle the redirect).
 * Each kind fails on its own: a failed read just leaves that kind out.
 */
export async function searchOfficeRecords(query: string): Promise<{ items: PaletteRecord[]; error?: string }> {
  const q = cleanQuery(query);
  if (!q) return { items: [] };
  const s = await getSession();
  if (!s?.isStaff || s.aal !== 'aal2') return { items: [], error: 'not-signed-in' };
  // the palette needs only the permission part of OfficePerms
  const p: OfficePerms = {
    isAdmin: s.isAdmin, roles: s.roles, permissions: [...s.permissions],
    canOpenDropship: false, canSeeRates: false, canSeeFeesDuty: false, canEditDropship: false, canSeeSaas: false, warehouseMember: false, dropshipV2Ui: false,
  };
  const kinds = new Set<RecordKind>(searchableKinds(p));
  const sb = await createClient();
  const like = `%${q}%`;
  const L = SEARCH_LIMIT;
  const safe = async <T,>(on: boolean, run: () => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
    if (!on) return [];
    try {
      const { data, error } = await run();
      return error ? [] : (data ?? []);
    } catch {
      return [];
    }
  };

  const [customer, rfq, quote, order, invoice, payment, product, supplier] = await Promise.all([
    safe<NonNullable<SearchRows['customer']>[number]>(kinds.has('customer'), () =>
      sb.from('organizations').select('id, name, buyer_code, city, country').is('archived_at', null).or(`name.ilike.${like},buyer_code.ilike.${like}`).order('name').limit(L)),
    safe<NonNullable<SearchRows['rfq']>[number]>(kinds.has('rfq'), () =>
      sb.from('rfqs').select('id, code, title, status').or(`code.ilike.${like},title.ilike.${like}`).order('created_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['quote']>[number]>(kinds.has('quote'), () =>
      sb.from('quotes').select('id, code, status, rfq_id').ilike('code', like).order('created_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['order']>[number]>(kinds.has('order'), () =>
      sb.from('orders').select('id, code, title, status, total_cents, paid_cents').or(`code.ilike.${like},title.ilike.${like}`).order('updated_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['invoice']>[number]>(kinds.has('invoice'), () =>
      sb.from('proforma_invoices').select('id, number, order_id').ilike('number', like).order('issued_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['payment']>[number]>(kinds.has('payment'), () =>
      sb.from('payments').select('id, reference, status, purpose').ilike('reference', like).order('created_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['product']>[number]>(kinds.has('product'), () =>
      sb.from('products').select('id, title, slug, status').or(`title.ilike.${like},slug.ilike.${like}`).order('created_at', { ascending: false }).limit(L)),
    safe<NonNullable<SearchRows['supplier']>[number]>(kinds.has('supplier'), () =>
      sb.from('suppliers').select('id, code, legal_name, country').is('archived_at', null).or(`code.ilike.${like},legal_name.ilike.${like}`).order('code').limit(L)),
  ]);

  return { items: toPaletteItems({ customer, rfq, quote, order, invoice, payment, product, supplier }, p) };
}
