import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_NAMES } from '@octopus/ui/status';
import {
  KYC_TAB_STATUSES, isSignedStorageUrl, kycDecisionState, kycHistoryItems, kycKpis, kycQueueHref, kycRawFilter, kycTab, submissionCompanyStatus,
  supplierDecisionState, supplierStatusName, validateKycDecision, validateSupplierReject, waitingDays, externalHref, type KycQueueRow,
} from '@/app/ods/office/kyc/_lib/kyc-core';
import { SERVICE_FILTERS, SERVICE_NEXT, detailsSummary, serviceActions, serviceStatusName, serviceTab, validateServiceReason } from '@/app/ods/office/services/_lib/services-core';
import { ago, assignmentOf, assistantTab, conversationActions, overdueCount, validateReply, type AssistantRow } from '@/app/ods/office/assistant/_lib/assistant-core';

const NOW = '2026-11-27T12:00:00Z';
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('ODS T9 KYC · Appendix C company status', () => {
  it('maps submission states to the four company names', () => {
    expect(submissionCompanyStatus('verified')).toBe('Verified');
    for (const s of ['submitted', 'in_review', 'more_info']) expect(submissionCompanyStatus(s)).toBe('Verification pending');
    for (const s of ['rejected', 'not_started', null, undefined]) expect(submissionCompanyStatus(s)).toBe('Not verified');
    expect(submissionCompanyStatus('verified', '2026-01-01T00:00:00Z')).toBe('Paused');
    const names = new Set<string>(STATUS_NAMES.company);
    for (const s of ['verified', 'submitted', 'rejected']) expect(names.has(submissionCompanyStatus(s))).toBe(true);
  });
  it('supplier applications use the approvals names', () => {
    expect(supplierStatusName('submitted')).toBe('Waiting');
    expect(supplierStatusName('in_review')).toBe('Waiting');
    expect(supplierStatusName('approved')).toBe('Approved');
    expect(supplierStatusName('rejected')).toBe('Rejected');
    for (const s of ['submitted', 'approved', 'rejected']) expect((STATUS_NAMES.approvals as readonly string[]).includes(supplierStatusName(s))).toBe(true);
  });
});

describe('ODS T9 KYC · queue tabs (same ?f= values as today)', () => {
  it('keeps today\'s filters for open / verified / rejected', () => {
    expect(KYC_TAB_STATUSES.open).toEqual(['submitted', 'in_review', 'more_info']);
    expect(KYC_TAB_STATUSES.verified).toEqual(['verified']);
    expect(KYC_TAB_STATUSES.rejected).toEqual(['rejected']);
  });
  it('unknown ?f falls back to open; raw filter only accepts pending states', () => {
    expect(kycTab(undefined)).toBe('open');
    expect(kycTab('nope')).toBe('open');
    expect(kycTab('suppliers')).toBe('suppliers');
    expect(kycTab('paused')).toBe('paused');
    expect(kycRawFilter('more_info')).toBe('more_info');
    expect(kycRawFilter('verified')).toBeNull();
  });
  it('builds public URLs', () => {
    expect(kycQueueHref('/office/kyc', 'open')).toBe('/office/kyc');
    expect(kycQueueHref('/office/kyc', 'open', 'in_review')).toBe('/office/kyc?raw=in_review');
    expect(kycQueueHref('/office/kyc?f=open&raw=submitted', 'suppliers', 'submitted')).toBe('/office/kyc?f=suppliers');
    expect(kycQueueHref('/dev/x?state=queue', 'verified')).toBe('/dev/x?state=queue&f=verified');
  });
  it('KPI counts and waiting days', () => {
    const row = (status: string, submittedAt: string): KycQueueRow => ({ id: status + submittedAt, company: 'C', account: null, place: '', registrationNo: null, status, companyStatus: submissionCompanyStatus(status), submittedAt, reviewedAt: null, documents: 1, assignee: null });
    const k = kycKpis([row('submitted', '2026-11-27T08:00:00Z'), row('in_review', '2026-11-20T08:00:00Z'), row('more_info', '2026-11-10T08:00:00Z')], NOW);
    expect(k).toEqual({ total: 3, submitted: 1, inReview: 1, moreInfo: 1, over2Days: 1 });
    expect(waitingDays('2026-11-24T12:00:00Z', NOW)).toBe(3);
    expect(waitingDays('2026-11-28T12:00:00Z', NOW)).toBe(0);
    expect(waitingDays(null, NOW)).toBeNull();
  });
});

describe('ODS T9 KYC · decisions (same rules as today)', () => {
  it('view only without customers:approve', () => {
    expect(kycDecisionState('in_review', false).kind).toBe('view-only');
  });
  it('closed when verified or rejected', () => {
    expect(kycDecisionState('verified', true).kind).toBe('closed');
    expect(kycDecisionState('rejected', true).kind).toBe('closed');
  });
  it('Start review only from submitted; three decisions while open', () => {
    const a = kycDecisionState('submitted', true);
    const b = kycDecisionState('more_info', true);
    expect(a.kind === 'open' && a.canStartReview).toBe(true);
    expect(b.kind === 'open' && b.canStartReview).toBe(false);
    expect(a.kind === 'open' && a.decisions).toEqual(['more_info', 'rejected', 'verified']);
  });
  it('a message to the customer is required to reject or request more info (migration 196)', () => {
    expect(validateKycDecision('rejected', '  ')).toMatch(/why the verification was rejected/);
    expect(validateKycDecision('more_info', '')).toMatch(/what information or documents/);
    expect(validateKycDecision('verified', '')).toBeNull();
    expect(validateKycDecision('rejected', 'Licence expired')).toBeNull();
  });
  it('history items read old → new state', () => {
    const items = kycHistoryItems([{ from_status: null, to_status: 'submitted', reason: null, created_at: NOW }, { from_status: 'in_review', to_status: 'more_info', reason: 'x', created_at: NOW }]);
    expect(items[0].title).toBe('New → Submitted');
    expect(items[1].title).toBe('In review → More info requested');
    expect(items[1].tone).toBe('warning');
  });
});

describe('ODS T9 KYC · documents are never public links', () => {
  it('accepts only signed storage URLs', () => {
    expect(isSignedStorageUrl('https://x.supabase.co/storage/v1/object/sign/kyc/a.pdf?token=abc')).toBe(true);
    expect(isSignedStorageUrl('https://x.supabase.co/storage/v1/object/public/kyc/a.pdf')).toBe(false);
    expect(isSignedStorageUrl('https://x.supabase.co/storage/v1/object/sign/kyc/a.pdf')).toBe(false);
    expect(isSignedStorageUrl(null)).toBe(false);
    expect(isSignedStorageUrl('not a url')).toBe(false);
  });
  it('the review page keeps the fresh-2FA gate, 60-second signing and the view audit', () => {
    const page = src('app/ods/office/kyc/[id]/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('customers', 'view'");
    expect(page).toContain("rpc('mfa_fresh')");
    expect(page).toMatch(/createSignedUrl\(d\.storage_path, 60\)/);
    expect(page).toContain("rpc('log_staff_view'");
    expect(page).not.toMatch(/getPublicUrl/);
    expect(page).toContain("can(s, 'customers', 'approve')");
    expect(page).toContain('reviewKyc.bind(null');
  });
});

describe('ODS T9 KYC · supplier applications (DS16 two approvers)', () => {
  const base = { status: 'in_review', canApprove: true, firstBy: null as string | null, userId: 'me' };
  it('first approval, then second by someone else', () => {
    const first = supplierDecisionState(base);
    expect(first.kind === 'open' && first.approveLabel).toBe('Approve (first of two)');
    const second = supplierDecisionState({ ...base, firstBy: 'other', firstName: 'Lena' });
    expect(second.kind === 'open' && second.approveLabel).toBe('Give second approval');
    expect(second.kind === 'open' && second.firstNote).toContain('Lena');
  });
  it('the first approver waits for a colleague', () => {
    const s = supplierDecisionState({ ...base, firstBy: 'me' });
    expect(s.kind === 'open' && s.waitingForSecond).toBe(true);
  });
  it('view only / closed', () => {
    expect(supplierDecisionState({ ...base, canApprove: false }).kind).toBe('view-only');
    expect(supplierDecisionState({ ...base, status: 'approved' }).kind).toBe('closed');
  });
  it('reject needs a reason; links get https', () => {
    expect(validateSupplierReject(' ')).toBe('Add a reason for the rejection.');
    expect(validateSupplierReject('No licence')).toBeNull();
    expect(externalHref('lumen.example')).toBe('https://lumen.example');
    expect(externalHref('http://a.example')).toBe('http://a.example');
  });
  it('the page keeps suppliers:view / suppliers:approve and today\'s action', () => {
    const page = src('app/ods/office/kyc/supplier/[id]/page.tsx');
    expect(page).toContain("requireStaff('suppliers', 'view'");
    expect(page).toContain("can(s, 'suppliers', 'approve')");
    expect(page).toContain('reviewSupplierApplication.bind(null, id)');
  });
});

describe('ODS T9 Service requests', () => {
  it('mirrors transition_service_request and today\'s filters', () => {
    expect(SERVICE_NEXT.requested).toEqual(['paid', 'rejected']);
    expect(SERVICE_NEXT.in_progress).toEqual(['report_ready', 'completed']);
    expect(SERVICE_FILTERS.open).toEqual(['requested', 'paid', 'accepted', 'in_progress', 'report_ready']);
    expect(serviceTab('x')).toBe('open');
    expect(serviceTab('done')).toBe('done');
  });
  it('buttons only with requests:edit; reject asks for a reason; paid/refunded confirm', () => {
    expect(serviceActions({ status: 'requested', code: 'SRV-1', paidVia: 'wallet' }, false)).toEqual([]);
    const a = serviceActions({ status: 'requested', code: 'SRV-1', paidVia: 'wallet' }, true);
    expect(a.map((x) => x.to)).toEqual(['paid', 'rejected']);
    expect(a[0].confirm).toBe('Mark SRV-1 as paid (invoice settled)?');
    expect(a[0].label).toBe('Mark paid');
    expect(serviceActions({ status: 'paid', code: 'SRV-1', paidVia: null }, true)[0].label).toBe('Accept');
    expect(a[1]).toMatchObject({ kind: 'reason', placeholder: 'Reason (fee is refunded to the wallet)' });
    expect(serviceActions({ status: 'rejected', code: 'SRV-2', paidVia: null }, true)[0].confirm).toBe('Mark SRV-2 as refunded?');
    expect(serviceActions({ status: 'completed', code: 'SRV-3', paidVia: null }, true)).toEqual([]);
    expect(validateServiceReason('rejected', ' ')).toBe('A reason is required to reject.');
    expect(validateServiceReason('paid', '')).toBeNull();
  });
  it('status names come from Appendix C', () => {
    const all = new Set<string>(Object.values(STATUS_NAMES).flat());
    for (const s of ['requested', 'paid', 'accepted', 'in_progress', 'report_ready', 'completed', 'rejected', 'refunded']) expect(all.has(serviceStatusName(s))).toBe(true);
    expect(serviceStatusName('rejected')).toBe('Rejected');
    expect(serviceStatusName('requested')).toBe('Waiting for payment');
    expect(serviceStatusName('paid')).toBe('Paid');
  });
  it('details summary = first four non-empty values', () => {
    expect(detailsSummary({ a_b: 1, c: '', d: null, e: { x: 1 }, f: 'y', g: 'z', h: 'w' })).toBe('A b: 1 · E: {"x":1} · F: y · G: z');
  });
  it('the page keeps requests:view / requests:edit, division scope and transitionService', () => {
    const page = src('app/ods/office/services/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('requests', 'view'");
    expect(page).toContain("can(s, 'requests', 'edit')");
    expect(page).toContain('getDivisionScope(s)');
    expect(page).toContain('transition={transitionService}');
  });
});

describe('ODS T9 Assistant queue', () => {
  const now = Date.parse(NOW);
  it('tabs, assignment and ago', () => {
    expect(assistantTab(undefined)).toBe('escalations');
    expect(assistantTab('low')).toBe('low');
    expect(assignmentOf(null, 'me')).toBe('team');
    expect(assignmentOf('me', 'me')).toBe('me');
    expect(assignmentOf('x', 'me')).toBe('colleague');
    expect(ago(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(ago(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3 h ago');
    expect(ago(null, now)).toBe('—');
  });
  it('counts overdue SLAs', () => {
    const r = (due: string | null) => ({ slaDueAt: due }) as AssistantRow;
    expect(overdueCount([r(new Date(now - 1).toISOString()), r(new Date(now + 60_000).toISOString()), r(null)], now)).toBe(1);
  });
  it('conversation buttons follow today\'s workspace rules', () => {
    const all = { canReply: true, canTakeOver: true, canClose: true };
    expect(conversationActions({ status: 'bot', hasOpenEscalation: false, ...all })).toEqual({ closed: false, reply: true, takeOver: true, resolve: false });
    expect(conversationActions({ status: 'escalated', hasOpenEscalation: true, ...all })).toMatchObject({ takeOver: true, resolve: true });
    expect(conversationActions({ status: 'human', hasOpenEscalation: true, ...all })).toMatchObject({ takeOver: false, resolve: true });
    expect(conversationActions({ status: 'closed', hasOpenEscalation: false, ...all })).toEqual({ closed: true, reply: false, takeOver: false, resolve: false });
    expect(conversationActions({ status: 'escalated', hasOpenEscalation: true, canReply: false, canTakeOver: false, canClose: false })).toMatchObject({ reply: false, takeOver: false, resolve: false });
  });
  it('reply checks match staffAssistantReply', () => {
    expect(validateReply('  ')).toBe('Write a message first.');
    expect(validateReply('x'.repeat(4001))).toMatch(/4,000/);
    expect(validateReply('ok')).toBeNull();
  });
  it('the page keeps assistant:view and today\'s actions + per-action permissions', () => {
    const page = src('app/ods/office/assistant/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('assistant', 'view'");
    for (const a of ['reply', 'take_over', 'close']) expect(page).toContain(`can(s, 'assistant', '${a}')`);
    for (const fn of ['logAssistantOpen', 'staffAssistantReply', 'takeOverSession', 'resolveEscalation', 'lookupShipmentFact', 'refreshFact', 'setOutOfOffice']) expect(page).toContain(fn);
    expect(page).toContain("withHiddenColumns<NonNullable<typeof msgRows>[number]");
  });
});

describe('ODS T9 batch 2 · the KYC queue page keeps today\'s guards', () => {
  it('customers:view and suppliers:view for the supplier tab', () => {
    const page = src('app/ods/office/kyc/page.tsx');
    expect(page).toMatch(/^\/\/ ODS T9/);
    expect(page).toContain("requireStaff('customers', 'view', '/office/kyc')");
    expect(page).toContain("can(s, 'suppliers', 'view')");
  });
});
