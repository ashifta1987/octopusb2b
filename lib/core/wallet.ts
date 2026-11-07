import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * ADDON-41 shared wallet operations (server only). Money moves only through these, on top of the double-entry ledger:
 * hold → capture | release, refund after capture. Each call is idempotent on its reference and audited in the database.
 * The database functions are callable by the service role only; callers check the user's rights first.
 */
export type Service = 'sourcing' | 'dropship' | 'warehouse' | 'brand';

export class WalletError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function fail(e: { message: string }): never {
  const code = e.message.split(':')[0].trim();
  throw new WalletError(code, code === 'INSUFFICIENT_FUNDS' ? 'Not enough in the wallet.' : e.message);
}

export async function placeHold(input: { orgId: string; amountCents: number; service: Service; refType: string; refId: string; expiresAt?: Date }) {
  const { data, error } = await createAdminClient().rpc('place_hold', {
    p_org: input.orgId, p_amount_cents: input.amountCents, p_service: input.service, p_ref_type: input.refType, p_ref_id: input.refId,
    p_expires_at: input.expiresAt?.toISOString() ?? null,
  });
  if (error) fail(error);
  return data as string;
}

export async function captureHold(holdId: string, opts: { stream?: string; amountCents?: number } = {}) {
  const { error } = await createAdminClient().rpc('capture_hold', { p_hold: holdId, p_stream: opts.stream ?? null, p_amount_cents: opts.amountCents ?? null });
  if (error) fail(error);
}

export async function releaseHold(holdId: string, reason?: string) {
  const { error } = await createAdminClient().rpc('release_hold', { p_hold: holdId, p_reason: reason ?? null, p_expired: false });
  if (error) fail(error);
}

export async function refund(holdId: string, amountCents: number, reason: string, idempotencyKey: string) {
  const { error } = await createAdminClient().rpc('refund_capture', { p_hold: holdId, p_amount_cents: amountCents, p_reason: reason, p_idem: idempotencyKey });
  if (error) fail(error);
}

export async function expireHolds() {
  const { data, error } = await createAdminClient().rpc('expire_holds');
  if (error) fail(error);
  return Number(data ?? 0);
}

