/**
 * ODS T9 · Customer record view models (pure types). The real page fills them from today's queries
 * (app/ods/admin/customers/[id]/_lib/loaders.ts); staging fixtures fill them with SAMPLE data.
 * Convention per panel: `T` = loaded, `null` = failed to load (ErrorState), `'restricted'` = this staff member may not see it.
 */
import type { CompanyStatusName, InvoiceStatusName, MoneySummary, OpenItem, PanelVisibility } from './customer-logic';

export type StaffCandidateVM = { id: string; name: string; team: string | null; customers: number; outOfOffice: boolean };

export type CustomerHeaderVM = {
  id: string;
  name: string;
  buyerCode: string | null;
  city: string | null;
  countryName: string | null;
  since: string;
  status: CompanyStatusName;
  vip: boolean;
  accountManager: { id: string; name: string; team: string | null; outOfOffice: boolean } | null;
  owner: string | null;
  services: string[];
  counts: { orders: number | null; invoices: number | null; rfqs: number | null; documents: number | null; team: number | null; tickets: number | null };
  /** Message → the customer's latest open support ticket (support:view). null + reason when not available. */
  message: { href: string } | { reason: string };
  /** New quote → quotes are added on the customer's open RFQ (requests:view). */
  newQuote: { href: string } | { reason: string };
};

export type CompanyVM = {
  legalName: string;
  buyerCode: string | null;
  country: string | null;
  city: string | null;
  businessType: string | null;
  registrationNo: string | null;
  website: string | null;
  kycStatus: string;
  kycHref: string | null;
  since: string;
  walletReference: string | null;
};

export type CreditVM = {
  eligible: boolean;
  terms: { id: string; division: string; limitCents: number; currency: string; netDays: number; status: string; overdueBlocked: boolean; updatedAt: string; proposedByMe: boolean }[];
};

export type OrderRowVM = { id: string; code: string; date: string; service: string; title: string; totalCents: number; paidCents: number; currency: string; status: string; href: string | null };
export type InvoiceRowVM = { id: string; number: string; docType: string; issued: string; dueAt: string | null; amountCents: number; paidCents: number; balanceCents: number; currency: string; status: InvoiceStatusName; href: string };
export type RfqRowVM = { id: string; code: string; title: string; quantity: string; quotes: number; created: string; status: string; href: string | null };
export type DocumentRowVM = { id: string; number: string; type: string; supplier: boolean; amountCents: number | null; currency: string; status: string; created: string; href: string };
export type KycSubmissionVM = { id: string; status: string; submittedAt: string | null; href: string | null };
export type MemberVM = { id: string; name: string; email: string | null; role: string; joined: string };
export type ActivityVM = { id: string; title: string; actor: string; at: string; tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral' };
export type AssistantSessionVM = { id: string; title: string; status: string; lastAt: string | null; href: string | null };
export type WalletHoldVM = { id: string; at: string; service: string; amountCents: number; status: string };
export type TopupVM = { id: string; at: string; amountCents: number; currency: string; method: string; reference: string | null; status: string };

export type ServiceSettingVM = { service: string; label: string; status: string; plan: string; updatedAt: string | null };
export type LimitsVM = { maxOrderCents: number | null; maxMonthCents: number | null; minMarginPct: number | null; setAt: string | null; ownCeiling: { maxAmountCents: number; minMarginPct: number } | null | 'none' };

export type AccountManagerVM = {
  current: { id: string; name: string; title: string | null; team: string | null; office: string | null; email: string | null; outOfOffice: boolean; assignedAt: string; assignedBy: string; reason: string | null; load: number | null } | null;
  cap: number;
  candidates: StaffCandidateVM[];
  /** Assignment history (audit_log, RLS); null = failed. Empty + !auditVisible → "Audit log is visible to Admins." (today's text). */
  history: ActivityVM[] | null;
  auditVisible: boolean;
};

/** Everything the Actions ▾ menu + drawers need (only today's customer actions). */
export type CustomerActionsVM = {
  orgId: string;
  orgName: string;
  visibility: PanelVisibility['actions'];
  vip: boolean;
  creditEligible: boolean;
  accountManager: AccountManagerVM;
  services: ServiceSettingVM[];
  dropshipMarkets: { countries: string[]; locked: boolean };
  limits: LimitsVM;
  kycHref: string | null;
  assistantHref: string | null;
};

export type PanelData<T> = T | null | 'restricted';

export type OverviewVM = {
  company: CompanyVM;
  money: MoneySummary | null;
  statementHref: string | null;
  credit: PanelData<CreditVM>;
  openItems: OpenItem[] | null;
  recentOrders: OrderRowVM[] | null;
  activity: ActivityVM[] | null;
};

export type WalletTabVM = { money: MoneySummary | null; reference: string | null; holds: WalletHoldVM[] | null; topups: PanelData<TopupVM[]> };
export type DocumentsTabVM = { documents: DocumentRowVM[] | null; kyc: KycSubmissionVM[] | null; supplierHidden: boolean };
export type TeamTabVM = { members: MemberVM[] | null; accountManager: AccountManagerVM };
export type ActivityTabVM = { activity: ActivityVM[] | null; assistant: AssistantSessionVM[] | null; auditVisible: boolean };
