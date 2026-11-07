import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import type { Service } from './wallet';

/**
 * ADDON-41 approvals. Inside the customer's limits and the manager's ceiling → approved automatically;
 * inside the ceiling → the customer's account manager; above it (or when limits are not set yet) → the owner.
 */
export type ApprovalResult = { id: string; status: 'approved' | 'pending'; approver: 'auto' | 'manager' | 'owner' };

export async function requestApproval(input: {
  orgId: string; service: Service | 'wallet'; refType: string; refId: string; amountCents: number; marginPct?: number | null; reason?: string;
}): Promise<ApprovalResult> {
  const { data, error } = await createAdminClient().rpc('request_approval', {
    p_org: input.orgId, p_service: input.service, p_ref_type: input.refType, p_ref_id: input.refId,
    p_amount_cents: input.amountCents, p_margin_pct: input.marginPct ?? null, p_reason: input.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ApprovalResult;
}

