'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { toCents, CURRENCIES, type Currency } from '@/lib/format';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';

function refresh() {
  revalidatePath('/admin/services');
  revalidatePath('/admin/wallet');
  revalidateTag('site-content', 'max');
  revalidateTag('service-prices', 'max');
}

const Service = z.object({
  code: z.string().regex(/^[a-z0-9_]{2,32}$/, 'Code: lowercase letters, digits, underscore'),
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(2).max(40),
  description: z.string().trim().max(500).optional(),
});

/** Edit name / unit / description / live flag (price history is separate). */
export async function updateService(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const p = Service.safeParse({ code: str(fd, 'code'), name: str(fd, 'name'), unit: str(fd, 'unit'), description: str(fd, 'description') || undefined });
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid input');
  const { data, error } = await g.sb.from('services')
    .update({ name: p.data.name, unit: p.data.unit, description: p.data.description ?? null, active: bool(fd, 'active') })
    .eq('code', p.data.code).select('code');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh();
  return ok('Service saved');
}

/** Change a price = insert a new service_prices row effective now or at a future date (history is kept). */
export async function addPrice(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const code = str(fd, 'code');
  const cents = toCents(str(fd, 'amount'));
  if (!code) return fail('Missing service');
  const currency = (str(fd, 'currency') || 'USD') as Currency;
  if (!CURRENCIES.includes(currency)) return fail('UNSUPPORTED_CURRENCY');
  if (!Number.isFinite(cents) || cents < 0) return fail('INVALID_AMOUNT');
  const when = str(fd, 'effective_from');
  let effective = new Date();
  if (when) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) return fail('Invalid date');
    if (d.getTime() > Date.now()) effective = d;
  }
  const { error } = await g.sb.from('service_prices').insert({ service_code: code, amount_minor: cents, currency, effective_from: effective.toISOString(), created_by: g.s.userId });
  if (error) return fail(error);
  refresh();
  return ok(effective.getTime() > Date.now() + 60_000 ? `${currency} price scheduled` : `${currency} price updated — applies to new requests`);
}

/** Add a new service with its first price. */
export async function createService(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const p = Service.safeParse({ code: str(fd, 'code').toLowerCase(), name: str(fd, 'name'), unit: str(fd, 'unit'), description: str(fd, 'description') || undefined });
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid input');
  const cents = toCents(str(fd, 'amount') || '0');
  if (!Number.isFinite(cents) || cents < 0) return fail('INVALID_AMOUNT');
  const { data: last } = await g.sb.from('services').select('sort').order('sort', { ascending: false }).limit(1).maybeSingle();
  const { error } = await g.sb.from('services').insert({ ...p.data, description: p.data.description ?? null, active: bool(fd, 'active'), sort: (last?.sort ?? 0) + 1 });
  if (error) return fail(error);
  const { error: e2 } = await g.sb.from('service_prices').insert({ service_code: p.data.code, amount_minor: cents, currency: 'USD', created_by: g.s.userId });
  if (e2) return fail(e2);
  refresh();
  return ok('Service created');
}

export async function setServiceActive(code: string, active: boolean): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('services').update({ active }).eq('code', code).select('code');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh();
  return ok(active ? 'Service is live' : 'Service deactivated');
}
