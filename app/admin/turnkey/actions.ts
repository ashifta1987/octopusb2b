'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type TkPreviewRow = { row_no: number; project_id: string; action: 'new' | 'update' | 'unchanged' | 'invalid'; reason: string | null; changes: Record<string, { from: unknown; to: unknown }> };

/** Turnkey T1: CSV import of the project sheet (preview → tick changes → import). The database checks everything again. */
export async function importTurnkeyCatalogueAction(rows: Record<string, string>[], apply: boolean, replaceIds: string[]): Promise<{ ok: boolean; rows?: TkPreviewRow[]; message?: string; error?: string }> {
  await requireStaff('turnkey', 'edit', '/admin/turnkey');
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_import_catalogue', { p_rows: rows, p_apply: apply, p_replace_ids: replaceIds });
  if (error) return { ok: false, error: error.message.replace(/^[A-Z_]+:\s*/, '') };
  const out = (data ?? []) as TkPreviewRow[];
  if (apply) {
    revalidateTag('turnkey', 'max');
    revalidatePath('/admin/turnkey');
    revalidatePath('/turnkey');
    const n = out.filter((r) => r.action === 'new').length; const u = out.filter((r) => r.action === 'update').length;
    return { ok: true, rows: out, message: `Imported: ${n} new, ${u} updated.` };
  }
  return { ok: true, rows: out };
}
