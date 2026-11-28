'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * HS codes › Change › Preview — the same read today's page does in its inline server action (RPC hs_type_change_preview,
 * which checks the caller in the database; read-only). Moved to its own file so the client screen can call it.
 */
export async function previewHsChangeAction(typeId: string, heading: string) {
  const c = await createClient();
  const { data } = await c.rpc('hs_type_change_preview', { p_type: typeId, p_heading: heading });
  return (data ?? []) as { sku: string; title: string; current_code: string | null }[];
}
