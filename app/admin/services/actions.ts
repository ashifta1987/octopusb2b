'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { toCents, CURRENCIES, type Currency } from '@/lib/format';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';
import { createAdminClient } from '@/lib/supabase/server';

function refresh() {
  revalidatePath('/admin/services');
  revalidatePath('/admin/wallet');
  revalidatePath('/account/dropship', 'layout');
  revalidatePath('/office/dropship', 'layout');
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

/** Save Dropshipping minimum margin settings (default %, per-category overrides, supported selling countries). */
export async function saveDropshipMarginSettings(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const defaultPct = Number(str(fd, 'default_min_margin_pct') || '15');
  if (!Number.isFinite(defaultPct) || defaultPct < 0 || defaultPct > 95) {
    return fail('Default minimum margin must be between 0 and 95%.');
  }
  const defaultBp = Math.round(defaultPct * 100);

  const overridesRaw = str(fd, 'category_overrides');
  const overrides: Record<string, number> = {};
  if (overridesRaw) {
    for (const line of overridesRaw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const idx = t.indexOf(':');
      if (idx <= 0) return fail(`Invalid category override line "${t}" — use "Category: 18"`);
      const cat = t.slice(0, idx).trim();
      const pct = Number(t.slice(idx + 1).replace('%', '').trim());
      if (!cat || !Number.isFinite(pct) || pct < 0 || pct > 95) {
        return fail(`Invalid percentage for category "${cat}"`);
      }
      overrides[cat] = Math.round(pct * 100);
    }
  }

  const countriesRaw = str(fd, 'supported_countries');
  const countries = countriesRaw
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (!countries.length || countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    return fail('Supported countries must be comma-separated 2-letter ISO codes (e.g. AE, SA, GB, US).');
  }

  const upserts = [
    { key: 'dropship.min_margin_bp', value: defaultBp },
    { key: 'dropship.category_min_margin_bp', value: overrides },
    { key: 'dropship.supported_countries', value: [...new Set(countries)] },
  ];
  for (const row of upserts) {
    const { error } = await g.sb
      .from('site_settings')
      .upsert({ key: row.key, value: row.value, updated_at: new Date().toISOString() });
    if (error) return fail(error);
  }
  await createAdminClient().from('audit_log').insert({
    actor_id: g.s.userId,
    actor_kind: 'staff',
    action: 'dropship.settings_updated',
    entity: 'site_settings',
    entity_id: 'dropship.min_margin_bp',
    service: 'dropship',
    details: { min_margin_bp: defaultBp, category_min_margin_bp: overrides, supported_countries: [...new Set(countries)] },
  });
  refresh();
  return ok('Dropshipping margin & countries settings saved');
}

/** Toggle the Dropship design v2 UI shell (site_settings.dropship_v2_ui) with an audit log entry. */
export async function setDropshipV2Ui(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('services', 'edit');
  if ('error' in g) return g.error;
  const enabled = bool(fd, 'dropship_v2_ui');
  const { data: before } = await g.sb
    .from('site_settings')
    .select('value')
    .eq('key', 'dropship_v2_ui')
    .maybeSingle();
  const { error } = await g.sb
    .from('site_settings')
    .upsert({ key: 'dropship_v2_ui', value: enabled, updated_at: new Date().toISOString() });
  if (error) return fail(error);
  await createAdminClient().from('audit_log').insert({
    actor_id: g.s.userId,
    actor_kind: 'staff',
    action: 'dropship.v2_ui_toggled',
    entity: 'site_settings',
    entity_id: 'dropship_v2_ui',
    service: 'dropship',
    before: before ? { dropship_v2_ui: before.value } : null,
    after: { dropship_v2_ui: enabled },
    details: { dropship_v2_ui: enabled },
  });
  refresh();
  return ok(enabled ? 'Dropship design v2 UI switched ON' : 'Dropship design v2 UI switched OFF');
}
