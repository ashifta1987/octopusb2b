import 'server-only';
import * as shared from '@/lib/assistant/facts';
import * as fallback from './facts-fallback';
import type { createClient } from '@/lib/supabase/server';

/**
 * Octo side-rail facts for staff (SPEC §20.5). Uses the shared customer-agent module (`lib/assistant/facts.ts`) with the
 * caller's client (RLS applies). Shared "not found" facts (data null) are returned as null. Wallet balances fall back to
 * `assistant_org_wallets` (assigned staff usually have no finance permission, so the `wallets` view is empty for them).
 */
export type Fact = { title: string; text: string; data: unknown };
type Sb = Awaited<ReturnType<typeof createClient>>;

const orNull = (f: shared.Fact | null | undefined): Fact | null => (f && f.data != null ? f : null);

export async function getShipmentFacts(sb: Sb, trackingOrOrderCode: string): Promise<Fact | null> {
  return orNull(await shared.getShipmentFacts(sb, trackingOrOrderCode));
}

export async function getQuoteFacts(sb: Sb, rfqId: string): Promise<Fact | null> {
  return orNull(await shared.getQuoteFacts(sb, rfqId));
}

export async function getWalletFacts(sb: Sb, orgId?: string): Promise<Fact | null> {
  const f = await shared.getWalletFacts(sb, orgId ?? null);
  const wallets = (f?.data as { wallets?: unknown[] } | null)?.wallets;
  if (Array.isArray(wallets) && wallets.length) return f;
  return fallback.getWalletFacts(sb, orgId);
}
