import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { asCurrency, type Currency } from '@/lib/format';
import type { FxRow, SwitchRow } from '../../_website/website-core';

/**
 * Currency — TODAY's reads (app/admin/currency/page.tsx), unchanged: settings, fx_rates (+ set_by / source / note via the
 * service role after requireStaff, migration 195), switch requests, services, staff names.
 */
export type CurrencyData = {
  current: Currency;
  banner: { from: string; to: string; rate: number; applied_at: string; wallet_option: string } | null;
  rates: FxRow[];
  requests: SwitchRow[];
  names: Record<string, string>;
  serviceNames: Record<string, string>;
  nowIso: string;
};

export async function loadCurrency(nowMs: number): Promise<CurrencyData> {
  const sb = await createClient();
  const [settings, fx, switches, services] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['platform_currency', 'currency_switch_banner', 'currency_rounding']),
    sb.from('fx_rates').select('id, rate, effective_from, created_at').order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    sb.from('currency_switch_requests').select('*').order('created_at', { ascending: false }).limit(30),
    sb.from('services').select('code, name').order('sort'),
  ]);
  const set = new Map((settings.data ?? []).map((r) => [r.key as string, r.value]));
  const rates = (await withHiddenColumns('fx_rates', fx.data, 'set_by, source, note')) as unknown as FxRow[];
  const requests = (switches.data ?? []) as SwitchRow[];
  const people = [...new Set([...rates.map((r) => r.set_by), ...requests.flatMap((r) => [r.requested_by, r.approved_by])].filter(Boolean) as string[])];
  const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
  return {
    current: asCurrency(set.get('platform_currency') as string),
    banner: (set.get('currency_switch_banner') as CurrencyData['banner']) ?? null,
    rates,
    requests,
    names: Object.fromEntries((profs ?? []).map((p) => [p.id as string, (p.full_name as string) ?? 'Staff member'])),
    serviceNames: Object.fromEntries((services.data ?? []).map((x) => [x.code as string, x.name as string])),
    nowIso: new Date(nowMs).toISOString(),
  };
}
