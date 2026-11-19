'use server';
import { revalidatePath } from 'next/cache';
import { guard, fail, failAt, ok, str, requireFresh, type Result } from '@/components/admin/server';

const PAGE = '/admin/company';
/** The legal company record (company_profile id 1). Empty fields stay empty (null) — nothing is ever filled in for the owner. */
const FIELDS = ['legal_name', 'legal_name_cn', 'registration_no', 'tax_id', 'address', 'address_cn', 'registered_in'] as const;

/** Admin › Company: company-wide Admin only, fresh 2FA, every change in the audit log (trigger on company_profile). */
export async function saveCompany(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only a company-wide Admin can change the legal company details.');
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) {
    const v = str(fd, f);
    if (v.length > 400) return fail('One of the fields is too long.');
    patch[f] = v || null;
  }
  if (!patch.legal_name) return fail('The legal name cannot be empty.');
  const stale = await requireFresh(g.sb, PAGE);
  if (stale) return stale;
  const { data: cur } = await g.sb.from('company_profile').select(FIELDS.join(', ')).eq('id', 1).maybeSingle();
  const changed = FIELDS.filter((f) => ((cur as Record<string, string | null> | null)?.[f] ?? null) !== patch[f]);
  if (!changed.length) return ok('No changes');
  const { data, error } = await g.sb.from('company_profile').update({ ...Object.fromEntries(changed.map((f) => [f, patch[f]])), updated_at: new Date().toISOString() }).eq('id', 1).select('id');
  if (error) return failAt(error, PAGE);
  if (!data?.length) return fail('Not saved (permission or fresh 2FA code needed).');
  revalidatePath(PAGE);
  return ok(`Saved: ${changed.map((f) => f.replace(/_/g, ' ')).join(', ')}`);
}
