'use client';

import { ApprovalsView, type DecideFn, type QueueState, type Readiness } from '@/app/ods/office/_components/approvals-view';
import type { ApprovalItem } from '@/lib/office/workspace-core';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { APPROVAL_FIXTURE_STATES, SAMPLE_APPROVALS, SAMPLE_APPROVALS_DECIDED, SAMPLE_APPROVALS_SELF, type ApprovalFixtureState } from '../office-dashboard/sample-data';

const BASE = '/dev/ui/screens/office-approvals';
const STEP_UP = '/staff/verify?next=%2Foffice%2Fapprovals&reason=step_up';

/** Sample decide: the same results decideApprovalAction returns (ok · REASON_REQUIRED · STEP_UP_REQUIRED redirect). */
function sampleDecide(state: ApprovalFixtureState): DecideFn {
  return async (input) => {
    await new Promise((r) => setTimeout(r, 250));
    if (state === 'step-up') return { ok: false, error: 'Enter your 2-step code again to continue.', code: 'STEP_UP_REQUIRED', redirect: STEP_UP };
    if (!input.approve && (input.note ?? '').trim().length < 3) return { ok: false, error: 'Add a reason.', code: 'REASON_REQUIRED' };
    return { ok: true, data: { status: input.approve ? 'approved' : 'rejected' }, message: input.approve ? 'Approved' : 'Rejected' };
  };
}

export function ApprovalsFixture({ state }: { state: ApprovalFixtureState }) {
  const items: ApprovalItem[] = state === 'decided' ? SAMPLE_APPROVALS_DECIDED : state === 'self' ? SAMPLE_APPROVALS_SELF : SAMPLE_APPROVALS;
  const queueState: QueueState = state === 'unavailable' ? 'unavailable' : state === 'no-finance' ? 'no-finance' : state === 'error' ? 'error' : 'ok';
  const readiness: Readiness = state === 'no-second-approver' ? { approvers: 1, secondApproverNeeded: true, limitMinor: 250_000 } : { approvers: 3, secondApproverNeeded: false, limitMinor: 250_000 };
  return (
    <OfficeScreenFrame pathname="/office/approvals" role={state === 'no-finance' ? 'sales' : 'finance'}>
      <FixtureStates label="Fixture states (sample data)" links={APPROVAL_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <ApprovalsView
        key={state}
        items={queueState === 'ok' ? items : []}
        status={state === 'decided' ? 'decided' : 'waiting'}
        queueState={queueState}
        readiness={queueState === 'ok' ? readiness : null}
        focusId={state === 'deep-link' ? 'apr-2' : null}
        showPriceApprovals
        canManageStaff={state === 'no-second-approver'}
        decide={sampleDecide(state)}
        statusLinks={{ waiting: `${BASE}?state=waiting`, decided: `${BASE}?state=decided` }}
        initialNotice={state === 'step-up' ? { tone: 'warning', text: 'Enter your 2-step code again to continue.', href: STEP_UP } : null}
      />
    </OfficeScreenFrame>
  );
}
