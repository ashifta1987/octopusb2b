/**
 * Account › Product sourcing (7 Nov 2026): one list for every request a customer sent from /request/* —
 * sourcing requests are `rfqs` (submit_rfq), the other types are `service_requests` (request_service).
 * Pure helpers (unit tested): customer-facing status, type labels, the 6-step timeline position.
 */
export const SOURCING_STATUSES = ['Submitted', 'Under review', 'Quoted', 'Accepted', 'Onboarding', 'Active', 'Closed'] as const;
export type SourcingStatus = (typeof SOURCING_STATUSES)[number];

export const SOURCING_TYPES = ['sourcing', 'dropship', '3pl', 'sample', 'qc', 'certification'] as const;
export type SourcingType = (typeof SOURCING_TYPES)[number];
export const TYPE_LABEL: Record<SourcingType, string> = {
  sourcing: 'Product sourcing', dropship: 'Dropshipping', '3pl': '3PL warehousing', sample: 'Sample', qc: 'QC inspection', certification: 'Certification',
};
export const isSourcingType = (t: string | undefined): t is SourcingType => !!t && (SOURCING_TYPES as readonly string[]).includes(t);

/** Order statuses after the deposit is paid count as an active sourcing relationship. */
const ORDER_ACTIVE = new Set(['deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped', 'delivered']);

export function rfqStatus(status: string, orderStatus?: string | null): SourcingStatus {
  if (orderStatus === 'closed' || orderStatus === 'cancelled') return 'Closed';
  if (orderStatus && ORDER_ACTIVE.has(orderStatus)) return 'Active';
  switch (status) {
    case 'draft': case 'submitted': return 'Submitted';
    case 'assigned': case 'quoting': return 'Under review';
    case 'quoted': return 'Quoted';
    case 'accepted': return 'Accepted';
    default: return 'Closed'; // expired, cancelled
  }
}

export function serviceStatus(status: string, type: SourcingType): SourcingStatus {
  switch (status) {
    case 'requested': return 'Submitted';
    case 'paid': return 'Under review';
    case 'accepted': return type === 'dropship' || type === '3pl' ? 'Onboarding' : 'Accepted';
    case 'in_progress': case 'report_ready': return 'Active';
    default: return 'Closed'; // completed, rejected, refunded
  }
}

/** service_requests.service_code → request type */
export function serviceType(code: string): SourcingType {
  return isSourcingType(code) ? code : code === 'warehouse' ? '3pl' : 'sample';
}

/** Position on the 6-step timeline (Submitted … Active); Closed keeps the furthest step reached. */
export function timelineStep(s: SourcingStatus, reached: SourcingStatus = s): number {
  const i = SOURCING_STATUSES.indexOf(s);
  if (s !== 'Closed') return i;
  const r = SOURCING_STATUSES.indexOf(reached);
  return r >= 0 && reached !== 'Closed' ? r : 0;
}

export const STATUS_TONE: Record<SourcingStatus, string> = {
  Submitted: 'bg-[#EEF2F7] text-[#3B4556]', 'Under review': 'bg-[#FEF3C7] text-[#92400E]', Quoted: 'bg-[#E6EFFC] text-[#1E4F9C]',
  Accepted: 'bg-[#DCFCE7] text-[#15803D]', Onboarding: 'bg-[#F3E8FF] text-[#6B21A8]', Active: 'bg-[#DCFCE7] text-[#15803D]', Closed: 'bg-[#F1F5F9] text-[#64748B]',
};

