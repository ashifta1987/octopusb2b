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

export async function latestTermsId(): Promise<{ id: string; version: string } | null> {
  const sb = await createClient();
  const { data } = await sb.from('terms_versions').select('id, version').eq('status', 'published').eq('kind', 'general').order('published_at', { ascending: false }).limit(1).maybeSingle();
  return (data as { id: string; version: string } | null) ?? null;
}

/** Supplier code/country lookup through the buyer-safe view (never legal names). */
export async function supplierMap(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  const map = new Map<string, { code: string; country: string | null; verified: boolean }>();
  if (!uniq.length) return map;
  const sb = await createClient();
  const { data } = await sb.from('public_suppliers').select('id, code, country, verified').in('id', uniq);
  (data ?? []).forEach((s) => map.set(s.id as string, { code: s.code as string, country: s.country as string | null, verified: !!s.verified }));
  return map;
}

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
