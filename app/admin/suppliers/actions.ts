'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';

const SWITCHES = ['portal_login', 'product_upload', 'rfq_replies', 'listings_live', 'ai_tools'] as const;

function refresh() {
  revalidatePath('/admin/suppliers');
  revalidateTag('suppliers', 'max');
  revalidateTag('products', 'max');
}

const Supplier = z.object({
  legal_name: z.string().trim().min(2).max(200),
  country: z.string().trim().length(2),
  city: z.string().trim().max(80).optional(),
  supplier_type: z.string().trim().max(60).optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_email: z.string().trim().email().optional().or(z.literal('')),
  contact_phone: z.string().trim().max(40).optional(),
  main_categories: z.string().trim().max(200).optional(),
});

function parse(fd: FormData) {
  return Supplier.safeParse(Object.fromEntries(['legal_name', 'country', 'city', 'supplier_type', 'contact_name', 'contact_email', 'contact_phone', 'main_categories'].map((k) => [k, str(fd, k) || undefined])));
}

export async function createSupplier(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('suppliers', 'create');
  if ('error' in g) return g.error;
  const p = parse(fd);
  if (!p.success) return fail(`${p.error.issues[0]?.path.join('.')}: ${p.error.issues[0]?.message}`);
  const { data, error } = await g.sb.from('suppliers').insert({ ...p.data, country: p.data.country.toUpperCase(), contact_email: p.data.contact_email || null, verified: bool(fd, 'verified') }).select('code').maybeSingle();
  if (error) return fail(error);
  refresh();
  return ok(`Supplier ${data?.code ?? ''} created`);
}

export async function updateSupplier(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const id = str(fd, 'id');
  const p = parse(fd);
  if (!id) return fail('NOT_FOUND');
  if (!p.success) return fail(`${p.error.issues[0]?.path.join('.')}: ${p.error.issues[0]?.message}`);
  const row = Object.fromEntries(Object.entries({ ...p.data, country: p.data.country.toUpperCase() }).map(([k, v]) => [k, v === '' || v === undefined ? null : v]));
  const { data, error } = await g.sb.from('suppliers').update({ ...row, verified: bool(fd, 'verified') }).eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh();
  return ok('Supplier saved');
}

export async function setSwitch(supplierId: string, key: string, value: boolean): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  if (!(SWITCHES as readonly string[]).includes(key)) return fail('Unknown switch');
  const { data, error } = await g.sb.from('supplier_switches').update({ [key]: value, updated_at: new Date().toISOString() }).eq('supplier_id', supplierId).select('supplier_id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh();
  return ok();
}

export async function setArchived(id: string, archived: boolean): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('suppliers').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  refresh();
  return ok(archived ? 'Supplier archived' : 'Supplier restored');
}
