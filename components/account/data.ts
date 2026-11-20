import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** Customer-portal server helpers (reads run with the user's cookie so RLS applies). */

export type Settings = {
  wallet_enabled: boolean;
  ads_enabled: boolean;
  deposit_pct: number;
  claim_visible_days: number;
  claim_hidden_days: number;
  raw: Record<string, unknown>;
};

function asBool(v: unknown, d = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  return d;
}
function asNum(v: unknown, d: number) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Fresh (uncached) settings so wallet on/off is reflected immediately. */
export async function getSettings(): Promise<Settings> {
  const sb = await createClient();
  const { data } = await sb.from('site_settings').select('key, value');
  const raw: Record<string, unknown> = {};
  (data ?? []).forEach((r) => (raw[r.key as string] = r.value));
  return {
    wallet_enabled: asBool(raw.wallet_enabled, false),
    ads_enabled: asBool(raw.ads_enabled, false),
    deposit_pct: asNum(raw.deposit_pct, 30),
    claim_visible_days: asNum(raw.claim_visible_days, 7),
    claim_hidden_days: asNum(raw.claim_hidden_days, 30),
    raw,
  };
}

/** Balance of my org's wallet in `currency` (default: the platform currency — SPEC §15.1, one wallet per currency). */
export async function getWalletBalance(currency?: string | null): Promise<number> {
  const sb = await createClient();
  const { data } = await sb.rpc('my_wallet_balance', currency ? { p_currency: currency } : {});
  return Number(data ?? 0);
}

/** Wallet credit facility (migration 143): balance, credit limit and spendable amount of my org's wallet in `currency`. */
export async function getWalletFunds(currency?: string | null): Promise<{ balance: number; credit: number; available: number }> {
  const sb = await createClient();
  const { data } = await sb.rpc('my_wallet_credit', currency ? { p_currency: currency } : {}).maybeSingle<{ balance_minor: number; credit_limit_minor: number; available_minor: number }>();
  const balance = Number(data?.balance_minor ?? 0), credit = Number(data?.credit_limit_minor ?? 0);
  return { balance, credit, available: balance + credit };
}

export async function latestTermsId(): Promise<{ id: string; version: string } | null> {
  const sb = await createClient();
  const { data } = await sb.from('terms_versions').select('id, version').eq('status', 'published').eq('kind', 'general').order('published_at', { ascending: false }).limit(1).maybeSingle();
  return (data as { id: string; version: string } | null) ?? null;
}

/** Factory label data ("Verified factory · China (Guangdong)") through the buyer-safe views — never a supplier id or code
 *  (migration 195, decision 19 Nov 2026). Keyed by QUOTE id / ORDER id. */
export type FactoryInfo = { verified: boolean; country: string | null; province: string | null };
async function factoryByView(view: 'quote_factory' | 'order_factory', key: 'quote_id' | 'order_id', ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  const map = new Map<string, FactoryInfo>();
  if (!uniq.length) return map;
  const sb = await createClient();
  const { data } = await sb.from(view).select(`${key}, verified, country, province`).in(key, uniq);
  ((data ?? []) as unknown as Record<string, unknown>[]).forEach((f) => map.set(f[key] as string, {
    verified: !!f.verified, country: (f.country as string | null) ?? null, province: (f.province as string | null) ?? null,
  }));
  return map;
}
export const quoteFactoryMap = (quoteIds: (string | null | undefined)[]) => factoryByView('quote_factory', 'quote_id', quoteIds);
export const orderFactoryMap = (orderIds: (string | null | undefined)[]) => factoryByView('order_factory', 'order_id', orderIds);

export const DOC_LABEL: Record<string, string> = {
  proforma_invoice: 'Proforma invoice',
  commercial_invoice: 'Commercial invoice',
  receipt: 'Receipt',
  confirmation: 'Order confirmation',
  statement: 'Statement',
  credit_note: 'Credit note',
  qc_report: 'QC report',
  purchase_order: 'Purchase order',
  remittance: 'Remittance',
};

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
