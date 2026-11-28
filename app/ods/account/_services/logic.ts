/**
 * ODS T6 · My account › services (Turnkey, Warehouse, Shipping, Make My Brand, Settings, Support): pure mappings shared by
 * the pages, the staging fixtures and the unit tests (tests/unit/ods-account-services.test.ts). No server imports, no React,
 * no 'use client' (so server pages can call these). The database (RLS + RPCs) decides what is allowed; nothing here grants
 * anything, and nothing here changes a money calculation.
 */
import type { StatusTone } from '@octopus/ui';
import { companyStatusName, kycState } from '../_lib/status';

/* ───────── URL state (2.8) ───────── */

/** `?tab=` value → one of `ids` (first one when missing / unknown). */
export function pickTab<T extends string>(raw: string | string[] | undefined | null, ids: readonly T[], fallback: T = ids[0]): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (ids as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Today's tone words (green / amber / red / blue / gray; ok / warn / bad / info / neutral) → ODS pill tones. */
export function odsTone(t: string | null | undefined): StatusTone {
  switch (t) {
    case 'green': case 'ok': case 'success': return 'success';
    case 'amber': case 'warn': case 'needs': case 'warning': return 'warning';
    case 'red': case 'bad': case 'danger': return 'danger';
    case 'blue': case 'info': return 'info';
    case 'indigo': return 'indigo';
    default: return 'neutral';
  }
}

/* ───────── Turnkey: today's 8 phases → the 6-step ODS stepper (Part 6.7) ───────── */

export const TURNKEY_STEPS = [
  { id: 'brief', label: 'Brief' },
  { id: 'design', label: 'Design and quotes' },
  { id: 'samples', label: 'Samples' },
  { id: 'production', label: 'Production' },
  { id: 'qc', label: 'QC' },
  { id: 'shipping', label: 'Shipping' },
] as const;
export type TurnkeyStepId = (typeof TURNKEY_STEPS)[number]['id'];

/**
 * Today's phase (tk_client_projects.stage) → ODS step. Mapping (documented in the T6 report):
 *   enquiry, consultation               → Brief
 *   design, sourcing, quote_deposit     → Design and quotes
 *   (no phase today)                    → Samples — Turnkey has no separate sample phase; the step is shown with that note
 *   production_qc                       → Production, or QC once a pre-shipment inspection is under way
 *   shipment, handover                  → Shipping
 */
export const TURNKEY_STAGE_STEP: Record<string, TurnkeyStepId> = {
  enquiry: 'brief', consultation: 'brief',
  design: 'design', sourcing: 'design', quote_deposit: 'design',
  production_qc: 'production',
  shipment: 'shipping', handover: 'shipping',
};

/** Inspection statuses that mean the pre-shipment check has started (planned = fee first, not started). */
const QC_ACTIVE = ['scheduled', 'in_progress', 'submitted', 'published'];

export type TurnkeyStepState = { id: TurnkeyStepId; label: string; status: 'done' | 'current' | 'upcoming' | 'error'; note: string | null };

/** The stepper for one project: which step is current, each step's state, and the error text when on hold / cancelled. */
export function turnkeyStepper(input: {
  stage: string; status: string; statusReason?: string | null;
  inspections?: { kind: string; status: string }[];
}): { steps: TurnkeyStepState[]; current: number; errorText: string | null } {
  const ids = TURNKEY_STEPS.map((s) => s.id) as TurnkeyStepId[];
  let step: TurnkeyStepId = TURNKEY_STAGE_STEP[input.stage] ?? 'brief';
  if (step === 'production' && (input.inspections ?? []).some((i) => i.kind === 'pre_shipment' && QC_ACTIVE.includes(i.status))) step = 'qc';
  const completed = input.status === 'completed';
  const current = completed ? ids.length : ids.indexOf(step);
  const blocked = input.status === 'on_hold' || input.status === 'cancelled';
  const errorText = blocked
    ? `${input.status === 'on_hold' ? 'On hold' : 'Cancelled'}${input.statusReason ? `: ${input.statusReason}` : ''}`
    : null;
  const steps = TURNKEY_STEPS.map((s, i): TurnkeyStepState => ({
    id: s.id,
    label: s.label,
    status: i < current ? 'done' : i === current ? (blocked ? 'error' : 'current') : 'upcoming',
    note: s.id === 'samples' ? 'No separate sample step in Turnkey today; products are checked in QC.' : null,
  }));
  return { steps, current: Math.min(current, ids.length - 1), errorText };
}

/** Project status (open / on_hold / completed / cancelled) → pill. */
export function turnkeyStatusPill(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'open': return { label: 'Open', tone: 'info' };
    case 'on_hold': return { label: 'On hold', tone: 'warning' };
    case 'completed': return { label: 'Completed', tone: 'success' };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' };
    default: return { label: status, tone: 'neutral' };
  }
}

/** Fee / proforma pay state (today's feePayState values) → Appendix C payment names. */
export function payStatePill(state: 'paid' | 'part_paid' | 'to_pay'): { label: string; tone: StatusTone } {
  return state === 'paid' ? { label: 'Paid', tone: 'success' } : state === 'part_paid' ? { label: 'Partly paid', tone: 'warning' } : { label: 'Waiting for payment', tone: 'warning' };
}

export const TURNKEY_TABS = ['overview', 'quotes', 'samples', 'files', 'messages', 'timeline'] as const;
export type TurnkeyTab = (typeof TURNKEY_TABS)[number];

/* ───────── Support tickets ───────── */

export const SUPPORT_TABS = ['open', 'closed'] as const;
export type SupportTab = (typeof SUPPORT_TABS)[number];

/** ticket_status → label (today's words), tone and which tab (Open · Closed) it lists under. */
export function ticketStatus(status: string): { label: string; tone: StatusTone; group: SupportTab } {
  switch (status) {
    case 'new': return { label: 'New', tone: 'info', group: 'open' };
    case 'open': return { label: 'Open', tone: 'info', group: 'open' };
    case 'waiting_customer': return { label: 'Waiting for you', tone: 'warning', group: 'open' };
    case 'waiting_internal': return { label: 'With our team', tone: 'info', group: 'open' };
    case 'reopened': return { label: 'Reopened', tone: 'info', group: 'open' };
    case 'resolved': return { label: 'Resolved', tone: 'success', group: 'closed' };
    case 'closed': return { label: 'Closed', tone: 'neutral', group: 'closed' };
    default: return { label: status.replace(/_/g, ' '), tone: 'neutral', group: 'open' };
  }
}

/** Ticket category (complaint / question / feedback / warehouse …) → words. */
export const ticketCategory = (c: string) =>
  ({ complaint: 'Complaint', question: 'Question', feedback: 'Feedback', warehouse: 'Warehouse request' } as Record<string, string>)[c] ?? c.replace(/_/g, ' ');

/* ───────── KYC (Settings › Verification) ───────── */

/** kyc_status → Appendix C company name (the FRAME builder's kycState + companyStatusName, so Home and Settings agree), the label shown,
 *  pill tone and the verification step index (0-based of 4: email · details · review · verified). */
export function kycView(status: string | null | undefined): { name: 'Not verified' | 'Verification pending' | 'Verified'; label: string; tone: StatusTone; step: number } {
  const name = companyStatusName(kycState(status)) as 'Not verified' | 'Verification pending' | 'Verified';
  switch (status) {
    case 'verified': return { name, label: 'Verified', tone: 'success', step: 4 };
    case 'submitted': return { name, label: 'Verification pending', tone: 'info', step: 2 };
    case 'in_review': return { name, label: 'Being reviewed', tone: 'info', step: 2 };
    case 'more_info': return { name, label: 'More information needed', tone: 'warning', step: 1 };
    case 'rejected': return { name, label: 'Not approved', tone: 'danger', step: 1 };
    default: return { name, label: 'Not verified', tone: 'warning', step: 1 };
  }
}

export const KYC_STEPS = ['Email verified', 'Company details and documents', 'Review by our team (1–2 business days)', 'Verified'] as const;

/** Today's form mode (app/account/kyc): edit (new submission), docs (submitted but required documents missing), locked. */
export function kycMode(status: string, hasSubmission: boolean, missingRequired: number): 'edit' | 'docs' | 'locked' {
  if (status === 'verified' || status === 'in_review') return 'locked';
  if (status === 'submitted') return hasSubmission && missingRequired > 0 ? 'docs' : 'locked';
  return 'edit';
}

/* ───────── Warehouse ───────── */

export const WAREHOUSE_TABS = ['stock', 'inbound', 'outbound', 'fees'] as const;
export type WarehouseTab = (typeof WAREHOUSE_TABS)[number];

/**
 * Low-stock rule (owner decision 27 Nov 2026). No per-company threshold exists, so the pill uses days of cover (from today's
 * wh_portal_inventory: units shipped in the last 30 days): under N days = Low stock. N is the site setting
 * `warehouse.low_stock_cover_days` (integer 1–365; missing or invalid → 14), read on the server and passed in.
 * Unknown cover (no shipments) is never called low.
 */
export const LOW_STOCK_SETTING_KEY = 'warehouse.low_stock_cover_days';
export const LOW_STOCK_COVER_DAYS = 14;

/** site_settings value → days of cover (integer 1–365; a whole-number string is accepted); anything else → 14. */
export function lowStockCoverDays(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : LOW_STOCK_COVER_DAYS;
}

export function stockLevel(s: { available: number; on_hand: number; days_cover: number | null }, coverDays: number = LOW_STOCK_COVER_DAYS): { id: 'out' | 'low' | 'ok'; label: string; tone: StatusTone } {
  if (s.available <= 0) return { id: 'out', label: s.on_hand > 0 ? 'All reserved' : 'Out of stock', tone: 'danger' };
  if (s.days_cover != null && s.days_cover < coverDays) return { id: 'low', label: 'Low stock', tone: 'warning' };
  return { id: 'ok', label: 'In stock', tone: 'success' };
}

/* ───────── Shipping (B2B shipments + warehouse outbound orders) ───────── */

export const SHIPPING_FILTERS = ['all', 'preparing', 'in_transit', 'delivered', 'problem'] as const;
export type ShippingFilter = (typeof SHIPPING_FILTERS)[number];

/** shipment_status (core schema) → group, label and tone. */
export function shipmentGroup(status: string): { group: Exclude<ShippingFilter, 'all'>; label: string; tone: StatusTone } {
  switch (status) {
    case 'draft': case 'priced': case 'created': return { group: 'preparing', label: 'Preparing', tone: 'neutral' };
    case 'label_ready': return { group: 'preparing', label: 'Label created', tone: 'neutral' };
    case 'picked_up': return { group: 'in_transit', label: 'Picked up', tone: 'info' };
    case 'in_transit': return { group: 'in_transit', label: 'In transit', tone: 'info' };
    case 'out_for_delivery': return { group: 'in_transit', label: 'Out for delivery', tone: 'info' };
    case 'delivered': return { group: 'delivered', label: 'Delivered', tone: 'success' };
    case 'exception': return { group: 'problem', label: 'Problem', tone: 'danger' };
    case 'returned': return { group: 'problem', label: 'Returned', tone: 'danger' };
    default: return { group: 'preparing', label: status.replace(/_/g, ' '), tone: 'neutral' };
  }
}

/** Warehouse outbound order status (wh_orders) → shipping group (only shipped orders are listed as shipments). */
export function warehouseOrderGroup(status: string): { group: Exclude<ShippingFilter, 'all'>; label: string; tone: StatusTone } {
  if (status === 'shipped') return { group: 'in_transit', label: 'Shipped', tone: 'info' };
  if (status === 'exception') return { group: 'problem', label: 'Problem', tone: 'danger' };
  if (status === 'cancelled') return { group: 'problem', label: 'Cancelled', tone: 'neutral' };
  return { group: 'preparing', label: 'Preparing', tone: 'neutral' };
}

/* ───────── Make My Brand ───────── */

export const BRAND_TABS = ['proofs', 'files', 'orders'] as const;
export type BrandTab = (typeof BRAND_TABS)[number];

/** brand_projects.status → customer label + tone (today's app/account/brand words). */
export function brandStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'submitted': return { label: 'Submitted', tone: 'info' };
    case 'proof': return { label: 'Proof to approve', tone: 'warning' };
    case 'sample': return { label: 'Sample on the way', tone: 'info' };
    case 'quoted': return { label: 'Quote ready', tone: 'info' };
    case 'production': return { label: 'In production', tone: 'info' };
    case 'stocked': return { label: 'In our warehouse', tone: 'success' };
    case 'closed': return { label: 'Closed', tone: 'neutral' };
    default: return { label: status, tone: 'neutral' };
  }
}
/** Statuses listed under Orders (a quote or later). */
export const BRAND_ORDER_STATUSES = ['quoted', 'production', 'stocked'];

/* ───────── Settings ───────── */

export const SETTINGS_TABS = ['company', 'team', 'addresses', 'notifications', 'security', 'verification'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  company: 'Company', team: 'Team', addresses: 'Addresses', notifications: 'Notifications', security: 'Security', verification: 'Verification (KYC)',
};

/** org_members.member_role → words. */
export const memberRole = (r: string) => ({ owner: 'Owner', admin: 'Admin', buyer: 'Buyer', viewer: 'Viewer', member: 'Member' } as Record<string, string>)[r] ?? r.charAt(0).toUpperCase() + r.slice(1);

/** Support prefill from another page (`/account/support?about=TKP-00012&subject=…`): only safe, short text. */
export function supportPrefill(about: string | undefined | null, subject: string | undefined | null): { subject: string; body: string } | null {
  const ref = (about ?? '').trim().toUpperCase();
  const okRef = /^(TKP-\d{5,}|MB-\d{1,8}|WO-\d{6,}|OCT-[A-Z0-9-]{3,30}|RFQ-\d{1,8})$/.test(ref) ? ref : '';
  const subj = (subject ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
  if (!okRef && !subj) return null;
  return { subject: subj || `About ${okRef}`, body: okRef ? `About ${okRef}: ` : '' };
}
