// ODS T9
/**
 * ODS T9 · KYC review (Part 7.6 list + record pattern) — pure rules shared by the real pages, the fixtures and the unit
 * tests. Server + client safe. Nothing here changes today's data or decisions:
 *  - the queue reads the same `kyc_submissions` rows as today's /office/kyc (same `?f=` values: open · verified ·
 *    rejected · suppliers), plus a `paused` tab (archived organisations, Appendix C "Paused");
 *  - decisions call today's `reviewKyc` / `reviewSupplierApplication` server actions unchanged (the DB functions
 *    review_kyc / review_supplier_application still enforce permissions, the customer-message rule and the
 *    two-person supplier approval).
 */
import { kycMessageRequired, kycMessageRequiredText } from '@/lib/kyc-message';

/* ───────── Appendix C company status ───────── */

export type CompanyStatusName = 'Not verified' | 'Verification pending' | 'Verified' | 'Paused';

/** kyc_submissions.status (+ the organisation's archived_at) → Appendix C company status. */
export function submissionCompanyStatus(status: string | null | undefined, archivedAt?: string | null): CompanyStatusName {
  if (archivedAt) return 'Paused';
  if (status === 'verified') return 'Verified';
  if (status === 'submitted' || status === 'in_review' || status === 'more_info') return 'Verification pending';
  return 'Not verified';
}

/** Today's raw KYC states, as staff read them next to the Appendix C pill. */
export const KYC_RAW_LABEL: Record<string, string> = {
  not_started: 'Not started',
  submitted: 'Submitted',
  in_review: 'In review',
  more_info: 'More info requested',
  verified: 'Verified',
  rejected: 'Rejected',
};
export const kycRawLabel = (s: string | null | undefined) => (s ? (KYC_RAW_LABEL[s] ?? s.replace(/_/g, ' ')) : '—');

/* ───────── Queue tabs (?f=, same values as today + paused) ───────── */

export type KycTab = 'open' | 'verified' | 'rejected' | 'paused' | 'suppliers';

export const KYC_TABS: { id: KycTab; label: string; hint: string }[] = [
  { id: 'open', label: 'Verification pending', hint: 'Submitted, in review or more info requested' },
  { id: 'verified', label: 'Verified', hint: 'Approved submissions' },
  { id: 'rejected', label: 'Not verified', hint: 'Rejected submissions' },
  { id: 'paused', label: 'Paused', hint: 'Submissions of archived organisations' },
  { id: 'suppliers', label: 'Supplier applications', hint: 'From the public “Sell on Octopus B2B” page' },
];

/** The kyc_submissions statuses each tab reads (identical to today's FILTERS for open / verified / rejected). */
export const KYC_TAB_STATUSES: Record<Exclude<KycTab, 'suppliers'>, readonly string[]> = {
  open: ['submitted', 'in_review', 'more_info'],
  verified: ['verified'],
  rejected: ['rejected'],
  paused: ['submitted', 'in_review', 'more_info', 'verified', 'rejected'],
};

export const isKycTab = (v: string | null | undefined): v is KycTab => KYC_TABS.some((t) => t.id === v);
/** Unknown values fall back to `open`, as today. */
export const kycTab = (v: string | null | undefined): KycTab => (isKycTab(v) ? v : 'open');

/** Raw sub-filter inside "Verification pending" (?raw=submitted|in_review|more_info). */
export const KYC_RAW_FILTERS = ['submitted', 'in_review', 'more_info'] as const;
export type KycRawFilter = (typeof KYC_RAW_FILTERS)[number];
export const kycRawFilter = (v: string | null | undefined): KycRawFilter | null => ((KYC_RAW_FILTERS as readonly string[]).includes(v ?? '') ? (v as KycRawFilter) : null);

/** Public URL of the queue for a tab (+ raw filter). */
export function kycQueueHref(base: string, tab: KycTab, raw?: KycRawFilter | null): string {
  const [path, existing] = base.split('?');
  const u = new URLSearchParams(existing ?? '');
  u.delete('f');
  u.delete('raw');
  if (tab !== 'open') u.set('f', tab);
  if (raw && tab === 'open') u.set('raw', raw);
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

/* ───────── Queue rows ───────── */

export type KycQueueRow = {
  id: string;
  company: string;
  account: string | null;
  place: string;
  registrationNo: string | null;
  status: string;
  companyStatus: CompanyStatusName;
  submittedAt: string | null;
  reviewedAt: string | null;
  documents: number;
  /** kyc_submissions.reviewer_id (set by review_kyc on Start review / each decision) → name. No separate assignee exists today. */
  assignee: string | null;
};

export type SupplierQueueRow = {
  id: string;
  reference: string;
  company: string;
  email: string | null;
  place: string;
  categories: string[];
  status: string;
  createdAt: string;
  firstApproved: boolean;
};

/** Days waiting since submission (whole days, never negative). */
export function waitingDays(submittedAt: string | null, nowIso: string): number | null {
  if (!submittedAt) return null;
  const d = Math.floor((new Date(nowIso).getTime() - new Date(submittedAt).getTime()) / 86_400_000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

/** KPI counts for the open tab: total, more info, waiting over 2 days. */
export function kycKpis(rows: KycQueueRow[], nowIso: string) {
  return {
    total: rows.length,
    submitted: rows.filter((r) => r.status === 'submitted').length,
    inReview: rows.filter((r) => r.status === 'in_review').length,
    moreInfo: rows.filter((r) => r.status === 'more_info').length,
    over2Days: rows.filter((r) => (waitingDays(r.submittedAt, nowIso) ?? 0) > 2 && r.status !== 'more_info').length,
  };
}

/* ───────── Decisions (customer KYC) ───────── */

export type KycDecision = 'verified' | 'more_info' | 'rejected';
export const KYC_DECISION_LABEL: Record<KycDecision, string> = { verified: 'Approve', more_info: 'Request more info', rejected: 'Reject' };
export const KYC_DECISION_CONFIRM: Record<KycDecision, string> = { verified: 'Approve & verify', more_info: 'Request information', rejected: 'Reject' };

export type KycDecisionState =
  | { kind: 'view-only'; text: string }
  | { kind: 'closed'; text: string }
  | { kind: 'open'; canStartReview: boolean; decisions: KycDecision[] };

/** Same rules as today's Decision card: customers:approve, closed when verified / rejected, Start review only from submitted. */
export function kycDecisionState(status: string, canApprove: boolean): KycDecisionState {
  if (!canApprove) return { kind: 'view-only', text: 'You can view this submission but not approve it.' };
  if (status === 'verified' || status === 'rejected') return { kind: 'closed', text: `This submission is ${kycRawLabel(status).toLowerCase()}. The customer can submit again if needed.` };
  return { kind: 'open', canStartReview: status === 'submitted', decisions: ['more_info', 'rejected', 'verified'] };
}

/** Client-side check before calling reviewKyc (the action and review_kyc() check the same rule). */
export function validateKycDecision(to: KycDecision, customerMessage: string): string | null {
  return kycMessageRequired(to) && !customerMessage.trim() ? kycMessageRequiredText(to) : null;
}
export { kycMessageRequired };

/* ───────── Documents (fresh 2FA, signed 60-second links only) ───────── */

export type KycDocVM = { id: string; type: string; fileName: string; uploadedAt: string; url: string | null };
export type KycDocsState = 'unlocked' | 'locked';

/** A document link is shown only when it is a short-lived signed storage URL (never a public object URL). */
export function isSignedStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return /\/storage\/v1\/object\/sign\//.test(u.pathname) && u.searchParams.has('token');
  } catch {
    return false;
  }
}

/* ───────── History ───────── */

export type KycHistoryRow = { from_status: string | null; to_status: string; reason: string | null; created_at: string; actor?: string | null };
export function kycHistoryItems(rows: KycHistoryRow[]) {
  return rows.map((h, i) => ({
    id: `h${i}`,
    title: `${h.from_status ? kycRawLabel(h.from_status) : 'New'} → ${kycRawLabel(h.to_status)}`,
    description: h.reason ?? undefined,
    date: h.created_at,
    actor: h.actor ?? undefined,
    tone: (h.to_status === 'verified' ? 'success' : h.to_status === 'rejected' ? 'danger' : h.to_status === 'more_info' ? 'warning' : 'info') as 'success' | 'danger' | 'warning' | 'info',
  }));
}

/* ───────── Supplier applications ───────── */

/** Supplier application status → Appendix C approvals name (Waiting / Approved / Rejected). */
export function supplierStatusName(status: string): 'Waiting' | 'Approved' | 'Rejected' {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Waiting';
}
export const SUPPLIER_RAW_LABEL: Record<string, string> = { submitted: 'Submitted', in_review: 'In review', approved: 'Approved', rejected: 'Rejected' };

export type SupplierDecisionState =
  | { kind: 'view-only'; text: string }
  | { kind: 'closed'; text: string }
  | { kind: 'open'; canStartReview: boolean; waitingForSecond: boolean; approveLabel: string; approveTitle: string; firstNote: string | null };

/**
 * Same rules as today's supplier application page (DS16: two different approvers, enforced by the database):
 * suppliers:approve; closed when approved / rejected; the first approver sees "Waiting for a second approver".
 */
export function supplierDecisionState(input: {
  status: string; canApprove: boolean; firstBy: string | null; userId: string; firstName?: string | null; firstAt?: string | null; reviewedAt?: string | null;
}): SupplierDecisionState {
  if (!input.canApprove) return { kind: 'view-only', text: 'You can view this application but not approve it.' };
  if (input.status === 'approved' || input.status === 'rejected') return { kind: 'closed', text: `This application is ${input.status}.` };
  const firstMine = !!input.firstBy && input.firstBy === input.userId;
  const firstNote = input.firstBy
    ? `First approval by ${firstMine ? 'you' : input.firstName ?? 'a colleague'}. ${firstMine ? 'A different colleague must give the second approval.' : 'Your approval is the second one.'}`
    : null;
  return {
    kind: 'open',
    canStartReview: input.status === 'submitted',
    waitingForSecond: firstMine,
    approveLabel: input.firstBy ? 'Give second approval' : 'Approve (first of two)',
    approveTitle: input.firstBy ? 'Second approval' : 'First approval',
    firstNote,
  };
}

/** Reject needs a reason (same as reviewSupplierApplication). */
export const validateSupplierReject = (note: string) => (note.trim() ? null : 'Add a reason for the rejection.');

/** Website / store links: open in a new tab with https:// added when missing (as today). */
export const externalHref = (u: string) => (/^https?:/i.test(u) ? u : `https://${u}`);
