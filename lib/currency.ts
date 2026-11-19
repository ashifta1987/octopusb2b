import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';
import { asCurrency, convertMinor, type Currency } from '@/lib/format';

export type CurrencyContext = {
  currency: Currency;                 // active platform currency
  rate: number;                       // approved rate, CNY per 1 USD
  fxRateId: string | null;
  rateFrom: string | null;
  rounding: Record<string, { step_minor: number }>;
  banner: { from: string; to: string; rate: number; applied_at: string; wallet_option: string } | null;
};

/** Platform currency + approved FX rate (SPEC §15.1). Cached; invalidate with revalidateTag('currency','max'). */
export async function getCurrencyContext(): Promise<CurrencyContext> {
  'use cache';
  cacheLife({ revalidate: 60 });
  cacheTag('currency');
  cacheTag('site-content');
  const sb = createPublicClient();
  // fx_rates.source is hidden from the public key (migration 195): the approved (manual, in effect) rate id comes from
  // current_fx_rate_id() (security definer, same rule as the database uses), then its public columns are read.
  const [settings, rateId] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['platform_currency', 'currency_rounding', 'currency_switch_banner']),
    sb.rpc('current_fx_rate_id'),
  ]);
  const fx = rateId.data
    ? await sb.from('fx_rates').select('id, rate, effective_from').eq('id', rateId.data as string).maybeSingle()
    : { data: null };
  const s: Record<string, unknown> = {};
  (settings.data ?? []).forEach((r) => (s[r.key] = r.value));
  return {
    currency: asCurrency(s.platform_currency as string),
    rate: Number(fx.data?.rate ?? 7.1),
    fxRateId: (fx.data?.id as string) ?? null,
    rateFrom: (fx.data?.effective_from as string) ?? null,
    rounding: (s.currency_rounding as CurrencyContext['rounding']) ?? {},
    banner: (s.currency_switch_banner as CurrencyContext['banner']) ?? null,
  };
}

/** Convert an amount into the platform currency for display (storefront catalogue). Quotes lock the converted amount server-side. */
export function toPlatform(ctx: CurrencyContext, minor: number | null | undefined, from: string | null | undefined) {
  if (minor == null) return null;
  return convertMinor(Number(minor), asCurrency(from), ctx.currency, ctx.rate, ctx.rounding[ctx.currency]?.step_minor ?? 1);
}

