'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { actionSession, fail, ok, type Result } from '@/components/backoffice/server-utils';

const SWITCHES = ['portal_login', 'product_upload', 'rfq_replies', 'listings_live', 'ai_tools'] as const;
type SwitchKey = (typeof SWITCHES)[number];

/** Distributor flips a supplier switch (RLS: distributor for own suppliers, or suppliers:edit). */
export async function setSupplierSwitch(supplierId: string, key: SwitchKey, value: boolean): Promise<Result> {
  const g = await actionSession();
  if ('error' in g) return fail(g.error);
  if (!SWITCHES.includes(key)) return fail('Unknown switch');
  if (!g.s.isAdmin && !g.s.roles.includes('distributor')) return fail('FORBIDDEN');
  const sb = await createClient();
  const { data, error } = await sb.from('supplier_switches')
    .update({ [key]: value, updated_at: new Date().toISOString() })
    .eq('supplier_id', supplierId).select('supplier_id');
  if (error) return fail(error);
  if (!data?.length) return fail('This supplier is not assigned to you.');
  revalidatePath('/distributor');
  return ok();
}
