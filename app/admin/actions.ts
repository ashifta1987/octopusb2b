'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guard, fail, ok, type Result } from '@/components/admin/server';

/** Master switches and settings (site_settings) — Admin only; the set_setting RPC re-checks is_admin() and writes the audit log. */
export async function setSetting(key: string, value: unknown): Promise<Result> {
  const g = await guard('dashboard', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  if (!/^[a-z0-9_]{2,64}$/.test(key)) return fail('INVALID_KEY');
  const { error } = await g.sb.rpc('set_setting', { p_key: key, p_value: value as never });
  if (error) return fail(error);
  revalidateTag('site-content', 'max');
  if (key === 'ads_enabled') revalidateTag('ads', 'max');
  revalidatePath('/admin', 'layout');
  return ok(`${key} updated`);
}

/** Generic settings form (numbers / text / booleans) — Admin only. */
export async function saveSettings(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('dashboard', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const keys = String(fd.get('_keys') ?? '').split(',').filter(Boolean);
  for (const k of keys) {
    if (!/^[a-z0-9_]{2,64}$/.test(k)) return fail('INVALID_KEY');
    const kind = String(fd.get(`_type_${k}`) ?? 'text');
    const raw = fd.get(k);
    let value: unknown;
    if (kind === 'bool') value = raw === 'on';
    else if (kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fail(`Invalid number for ${k}`);
      value = n;
    } else value = String(raw ?? '');
    const { error } = await g.sb.rpc('set_setting', { p_key: k, p_value: value as never });
    if (error) return fail(error);
  }
  revalidateTag('site-content', 'max');
  revalidatePath('/admin', 'layout');
  return ok('Settings saved');
}
