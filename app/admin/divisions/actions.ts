'use server';
import { revalidatePath } from 'next/cache';
import { guard, fail, failAt, ok, str, bool, requireFresh, type Result } from '@/components/admin/server';
import { DIVISION_LOGOS } from '@/lib/divisions/shared';

const PAGE = '/admin/divisions';

/** Admin › Divisions: name, display order, logo (approved files only — never recoloured or redrawn), active. Admin only. */
export async function saveDivision(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only a company-wide Admin can change the divisions.');
  const code = str(fd, 'code');
  const name = str(fd, 'name');
  const order = Number(str(fd, 'sort_order'));
  const logo = str(fd, 'logo_key');
  const active = bool(fd, 'active');
  if (!code) return fail('NOT_FOUND');
  if (name.length < 2 || name.length > 60) return fail('Enter a name of 2 to 60 characters.');
  if (!Number.isInteger(order) || order < 1 || order > 99) return fail('Order must be a whole number from 1 to 99.');
  if (!(logo in DIVISION_LOGOS)) return fail('Pick one of the approved logos.');
  const stale = await requireFresh(g.sb, PAGE);
  if (stale) return stale;
  const { data, error } = await g.sb.from('divisions')
    .update({ name, sort_order: order, logo_key: logo, status: active ? 'active' : 'inactive', updated_at: new Date().toISOString() })
    .eq('code', code).select('code');
  if (error) return failAt(/DIVISION_LAST_ACTIVE/.test(error.message) ? 'At least one division must stay active.' : error, PAGE);
  if (!data?.length) return fail('Not saved (permission or fresh 2FA code needed).');
  revalidatePath(PAGE);
  revalidatePath('/admin', 'layout');
  return ok(`${name} saved`);
}
