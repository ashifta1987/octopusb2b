import 'server-only';
import { officeCtx, requestIp } from '@/lib/office/server';
import {
  approvalFromRow, decideCall, officeFail, okResult, APPROVAL_SOURCES,
  type ApprovalItem, type ApprovalSource, type OfficeResult, type StaffApprovalKind,
} from '@/lib/office/workspace-core';

export type { ApprovalItem, ApprovalSource, StaffApprovalKind } from '@/lib/office/workspace-core';

/**
 * Approvals queue (T9 Approvals screen, phone M_ERP_Approvals): staff approvals (255) + TODAY's finance_approvals,
 * escrow_hold_approvals (payment protection) and customer_credit_terms (Pay later), read through office_approval_queue().
 * Finance viewers / approvers only (FORBIDDEN otherwise).
 */
export async function approvalQueue(opts: { status?: 'waiting' | 'decided' | 'all'; limit?: number } = {}): Promise<OfficeResult<ApprovalItem[]>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('office_approval_queue', { p_status: opts.status ?? 'waiting', p_limit: opts.limit ?? 100 });
  if (error) return officeFail(error, '/office/approvals');
  return okResult(((data ?? []) as Record<string, unknown>[]).map((r) => approvalFromRow(r, c.s.userId)));
}

/** Waiting items the signed-in person can decide (for the Waiting-for-approval KPI / sidebar count). */
export async function approvalWaitingCount(): Promise<OfficeResult<number>> {
  const r = await approvalQueue({ status: 'waiting', limit: 500 });
  return r.ok ? okResult(r.data.filter((a) => a.canDecide).length) : r;
}

/** "Second approver needed" banner (Part 7.7: the owner must add a second Finance user before go-live). */
export async function approvalReadiness(): Promise<OfficeResult<{ approvers: number; secondApproverNeeded: boolean; limitMinor: number; currency: 'USD' }>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_approvals_readiness');
  if (error) return officeFail(error);
  const d = (data ?? {}) as { approvers?: number; second_approver_needed?: boolean; limit_minor?: number };
  return okResult({ approvers: Number(d.approvers ?? 0), secondApproverNeeded: d.second_approver_needed !== false, limitMinor: Number(d.limit_minor ?? 0), currency: 'USD' });
}

/**
 * Approve / reject one item. Staff approvals → staff_approval_decide (records only). The existing tables → TODAY's decide
 * function, called unchanged (decide_finance_approval, decide_escrow_hold_approval, decide_customer_credit_terms run their own
 * money step exactly as on today's Admin › Finance screen). Rejecting needs a reason. Step-up 2FA → `redirect`.
 */
export async function decideApproval(input: { source: ApprovalSource; id: string; approve: boolean; note?: string | null }): Promise<OfficeResult<{ status: 'approved' | 'rejected' }>> {
  if (!APPROVAL_SOURCES.includes(input.source)) return officeFail('INVALID_INPUT: unknown approval type');
  if (!input.approve && (input.note ?? '').trim().length < 3) return officeFail('REASON_REQUIRED: Say why it is rejected.');
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const call = decideCall(input.source, input.id, input.approve, input.note ?? null, await requestIp());
  const { error } = await c.sb.rpc(call.fn, call.args);
  if (error) return officeFail(error, '/office/approvals');
  return okResult({ status: input.approve ? 'approved' : 'rejected' }, input.approve ? 'Approved' : 'Rejected');
}

/**
 * For T9 money screens BEFORE calling today's money action: is a second approver needed for this amount? At / under the limit
 * nothing is recorded ({required:false}); above it a waiting approval is created (or the same one returned).
 */
export async function requestStaffApproval(input: {
  kind: StaffApprovalKind; amountMinor: number; currency: string; reason: string; refType: string; refId: string; orgId?: string | null;
  details?: Record<string, unknown>;
}): Promise<OfficeResult<{ required: boolean; id?: string; code?: string; limitMinor: number; duplicate?: boolean }>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_approval_request', {
    p_kind: input.kind, p_amount_minor: Math.round(input.amountMinor), p_currency: input.currency, p_reason: input.reason,
    p_ref_type: input.refType, p_ref_id: input.refId, p_org: input.orgId ?? null, p_details: input.details ?? {}, p_ip: await requestIp(),
  });
  if (error) return officeFail(error);
  const d = data as { required: boolean; id?: string; code?: string; limit_minor: number; duplicate?: boolean };
  return okResult({ required: !!d.required, id: d.id, code: d.code, limitMinor: Number(d.limit_minor ?? 0), duplicate: d.duplicate },
    d.required ? `Second approver needed (${d.code})` : undefined);
}

/** The approved, unused approval covering this action (or null): check it right before running today's money action. */
export async function staffApprovalReady(input: { kind: StaffApprovalKind; refType: string; refId: string; amountMinor: number }): Promise<OfficeResult<string | null>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_approval_ready', { p_kind: input.kind, p_ref_type: input.refType, p_ref_id: input.refId, p_amount_minor: Math.round(input.amountMinor) });
  if (error) return officeFail(error);
  return okResult((data as string | null) ?? null);
}

/** After today's money action succeeded: the approval is used (once). */
export async function markStaffApprovalExecuted(id: string): Promise<OfficeResult<null>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { error } = await c.sb.rpc('staff_approval_mark_executed', { p_id: id, p_ip: await requestIp() });
  if (error) return officeFail(error);
  return okResult(null);
}
