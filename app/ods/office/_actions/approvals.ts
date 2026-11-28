'use server';
import { revalidatePath } from 'next/cache';
import { approvalQueue, approvalReadiness, decideApproval, requestStaffApproval } from '@/lib/office/approvals';
import type { ApprovalItem, ApprovalSource, OfficeResult, StaffApprovalKind } from '@/lib/office/workspace-core';

/** T9 Approvals screen / phone: the queue (Finance viewers and approvers). */
export async function approvalQueueAction(opts: { status?: 'waiting' | 'decided' | 'all'; limit?: number } = {}): Promise<OfficeResult<ApprovalItem[]>> {
  return approvalQueue(opts);
}

export async function approvalReadinessAction() {
  return approvalReadiness();
}

/** Approve / reject: staff approvals through staff_approval_decide; the existing tables through TODAY's decide functions, unchanged. */
export async function decideApprovalAction(input: { source: ApprovalSource; id: string; approve: boolean; note?: string | null }): Promise<OfficeResult<{ status: 'approved' | 'rejected' }>> {
  const r = await decideApproval(input);
  if (r.ok) {
    revalidatePath('/office', 'layout');
    if (input.source !== 'staff_approvals') revalidatePath('/admin/finance');
  }
  return r;
}

/** T9 money screens: ask for a second approver when the amount is above the limit in settings (records only; moves no money). */
export async function requestStaffApprovalAction(input: {
  kind: StaffApprovalKind; amountMinor: number; currency: string; reason: string; refType: string; refId: string; orgId?: string | null;
}) {
  return requestStaffApproval(input);
}
