'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { WH_COOKIE } from '@/lib/warehouse';

/** Warehouse switcher: remember the choice (validated again on every request). */
export async function setWarehouseScope(formData: FormData) {
  const code = String(formData.get('warehouse') ?? 'all');
  const sb = await createClient();
  const { data } = await sb.rpc('wh_my_warehouses');
  const ok = code === 'all' || ((data ?? []) as { code: string }[]).some((w) => w.code === code);
  (await cookies()).set(WH_COOKIE, ok ? code : 'all', { path: '/office/warehouse', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 180 });
  revalidatePath('/office/warehouse', 'layout');
}
