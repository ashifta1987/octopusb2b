// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { can, requireStaffOrManager } from '@/lib/auth';
import { approvalQueue, approvalReadiness } from '@/lib/office/approvals';
import type { ApprovalItem } from '@/lib/office/workspace-core';
import { decideApprovalAction } from '../_actions/approvals';
import { ApprovalsView, type QueueState, type Readiness } from '../_components/approvals-view';

/**
 * ODS T9 · /office/approvals — the ONE approvals home (Part 7.7 / 7.8). Guard: Finance (finance:view) or today's
 * /admin/approvals rule (approvals:view, account managers) — requireStaffOrManager. The money queue is T8-DATA
 * approvalQueue() (office_approval_queue: Finance viewers / approvers only; FORBIDDEN otherwise, so people without
 * finance:view get the "for Finance" note + the link to today's price approvals). Decisions: decideApprovalAction →
 * staff_approval_decide or TODAY's decide_finance_approval / decide_escrow_hold_approval / decide_customer_credit_terms,
 * unchanged (two-person rule and step-up 2FA enforced in the database; STEP_UP_REQUIRED → OfficeResult.redirect).
 * `?status=waiting|decided`, `?item=<id>` (staff notifications deep link). Today's /admin/approvals (sales price
 * approvals + manager limits) stays as it is and is linked from here.
 */
export const metadata: Metadata = { title: 'Approvals' };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OdsApprovalsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ApprovalsLoading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function ApprovalsLoading() {
  return (
    <div className="flex flex-col gap-ods-gap" aria-busy="true">
      <div className="h-8 w-48 rounded-ods-control bg-ods-line" />
      <div className="h-64 rounded-ods-card bg-ods-surface" />
      <span className="sr-only" role="status">Loading approvals</span>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaffOrManager('/office/approvals', ['finance', 'view'], ['approvals', 'view']);
  const sp = await searchParams;
  const status = one(sp.status) === 'decided' ? 'decided' : 'waiting';
  const focusId = one(sp.item) ?? null;
  const seesFinance = can(s, 'finance', 'view') || can(s, 'finance', 'approve');
  const showPriceApprovals = s.isAdmin || s.roles.includes('account_manager') || can(s, 'approvals', 'view');

  let items: ApprovalItem[] = [];
  let queueState: QueueState = seesFinance ? 'ok' : 'no-finance';
  let readiness: Readiness | null = null;
  if (seesFinance) {
    const [q, ready] = await Promise.all([approvalQueue({ status, limit: 200 }), approvalReadiness()]);
    if (q.ok) {
      items = q.data;
      // deep link to an item on the other tab: show it in the list it belongs to
      if (focusId && !items.some((a) => a.id === focusId)) {
        const all = await approvalQueue({ status: 'all', limit: 500 });
        const hit = all.ok ? all.data.find((a) => a.id === focusId) : undefined;
        if (hit) items = [hit, ...items];
      }
    } else {
      queueState = q.unavailable ? 'unavailable' : 'error';
    }
    if (ready.ok) readiness = { approvers: ready.data.approvers, secondApproverNeeded: ready.data.secondApproverNeeded, limitMinor: ready.data.limitMinor };
  }

  return (
    <ApprovalsView
      items={items}
      status={status}
      queueState={queueState}
      readiness={readiness}
      focusId={focusId}
      showPriceApprovals={showPriceApprovals}
      canManageStaff={can(s, 'staff', 'edit')}
      decide={decideApprovalAction}
      live
      statusLinks={{ waiting: '/office/approvals', decided: '/office/approvals?status=decided' }}
    />
  );
}
