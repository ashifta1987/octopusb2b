import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ChannelSettings, PartnerRule } from '@/lib/dropship-ds14-shared';

/**
 * Octopus Dropship · Release 6 · Step 14 — data loaders. Every screen reads through ONE SECURITY DEFINER RPC of migration
 * *_ds14_supplier_partners_channels (supplier RPCs check the signed-in supplier, staff RPCs the staff permission, merchant RPCs the
 * own organisation + the 'stores' feature). Money is integer US cents; unknown values stay null (never 0).
 */

// ───────── supplier portal ─────────
export type SupHome = { supplier_name: string; supplier_code: string; to_ship: number; out_of_stock: number; in_review: number; attention: string[] };
export type SupPrice = { id: string; incoterm: string; moq: number; variant: string; price_minor: number; currency: string };
export type SupProduct = {
  id: string; title: string; model: string | null; status: string; stock_qty: number | null; rejection_reason: string | null;
  variants: number; in_dropship: boolean; prices: SupPrice[]; updated_at: string;
};
export type SupSubmission = { id: string; kind: string; status: string; summary: string; review_note: string | null; row_count: number | null; updated_at: string; editable: boolean };
export type SupProducts = { products: SupProduct[]; submissions: SupSubmission[]; auto_price_pct: number | null };
export type SupItem = { title: string; sku: string; variant: string | null; qty: number };
export type ShipTo = { name: string; line1: string | null; line2: string | null; city: string | null; region: string | null; postcode: string | null; country: string; phone: string | null };
export type SupOrder = {
  id: string; order: string; country: string; status: 'to_ship' | 'shipped' | 'problem' | 'cancelled'; ship_by: string | null; carrier: string | null;
  tracking_no: string | null; shipped_at: string | null; problem_note: string | null; items: SupItem[]; ship_to: ShipTo | null;
};
export type SupOrders = { orders: SupOrder[]; ship_within_days: number | null };
export type ProductPayload = {
  name?: string; category?: string; brand?: string; description?: string; supplier_sku?: string; barcode?: string; condition?: string; features?: string[];
  variants?: { option: string; sku: string; barcode?: string; cost_cents: number; stock: number; weight_g: number }[];
  images?: string[]; video?: string; handling_days?: number; ships_from?: string;
  package?: { weight_g?: number; length_cm?: number; width_cm?: number; height_cm?: number };
  customs?: { hs_code?: string; origin?: string; material?: string; description_en?: string; battery?: boolean; liquid?: boolean; magnetic?: boolean; branded?: boolean };
  terms?: { moq?: number; lead_days?: number; price_valid_days?: number; packaging?: string };
};
export type SupSubmissionFull = { id: string; kind: string; status: string; payload: ProductPayload; review_note: string | null; editable: boolean };
export type BulkResult = {
  products: ProductPayload[]; problems: { row: number; problem: string }[]; good_rows: number; total_rows: number; id?: string;
};

// ───────── staff ─────────
export type ApprovalRow = { id: string; kind: string; status: string; summary: string; row_count: number | null; supplier_code: string; supplier_name: string; created_at: string; updated_at: string };
export type ApprovalsPage = {
  counts: { review: number; changes: number; approved: number; rejected: number };
  rules: { price_auto_pct?: number; ship_within_days?: number; price_cum_30d_pct?: number };
  rows: ApprovalRow[];
};
export type ApprovalDetail = ApprovalRow & {
  payload: Record<string, unknown> & ProductPayload & { products?: ProductPayload[]; price_id?: string; old_minor?: number; new_minor?: number; currency?: string; pct?: number; from_qty?: number; to_qty?: number; direction?: string; cum_pct?: number };
  checks: Record<string, boolean>; review_note: string | null; product_ids: string[];
  auto: { ids_unique: boolean; hs_present: boolean; size_present: boolean; images_present: boolean };
};
export type StaffSuppliers = {
  suppliers: { id: string; code: string; name: string; verified: boolean; portal_on: boolean; portal_user: string | null; products: number; open_orders: number; in_review: number }[];
  link_candidates: { id: string; code: string; name: string; email: string | null }[];
  unassigned: { id: string; order: string; country: string; created_at: string; suppliers: string | null; mixed: boolean }[];
  partner_orders: { id: string; order: string; supplier_code: string; status: string; ship_by: string | null; carrier: string | null; tracking_no: string | null; problem_note: string | null; created_at: string }[];
};
export type PartnersPage = {
  plan_fees_on: boolean; can_edit: boolean; can_rules: boolean; default_rule: PartnerRule | null;
  partners: { id: string; code: string; name: string; kind: string; status: string; contact_email: string; contact_name: string | null; invited_at: string; merchants: number; earned_cents: number; rule: PartnerRule | null }[];
  merchants: { partner_id: string; org_id: string; name: string; attached_at: string; earned_cents: number }[];
  available_merchants: { id: string; name: string }[];
};
export type InvoiceRow = { id: string; number: string; type: 'commercial_invoice' | 'credit_note' | 'statement'; created_at: string; amount_cents: number | null; currency: string; status: string | null; kind: string | null; merchant: string | null };
export type InvoicesPage = { entity: { code: string; legal_name: string; tax_id: string | null; registered_in: string | null; currency: string } | null; rows: InvoiceRow[]; limit: number };
export type DocRow = {
  id: string; kind: string; title: string; doc_number: string | null; issuer: string | null; status: string; effective_status: string; expires_on: string | null;
  mime: string; size_bytes: number; review_note: string | null; created_at: string; product_id: string | null; product: string | null; model_no: string | null; supplier_code: string | null;
};
export type DocsPage = { can_edit: boolean; docs: DocRow[]; products: { id: string; model_no: string; title: string }[] };

// ───────── merchant ─────────
export type ChannelsPage = {
  shopify: { status: string; shop?: string; connected_at?: string | null };
  /** C0: every connected / connecting store of any platform (no secrets) */
  connections?: { id: string; platform: string; shop: string; store_url: string | null; status: string; last_error: string | null; last_sync_at: string | null; connected_at: string | null }[];
  settings: Partial<Record<string, ChannelSettings>>;
  waitlist: string[];
  plan_name: string | null; stores_limit: number | null; stores_used: number; billing_enabled: boolean;
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getSupHome = () => call<SupHome>('ds_sup_home');
export const getSupProducts = () => call<SupProducts>('ds_sup_products');
export const getSupOrders = () => call<SupOrders>('ds_sup_orders');
export const getSupSubmission = (id: string) => call<SupSubmissionFull>('ds_sup_submission_get', { p_id: id });
export const getApprovalsPage = (tab: string) => call<ApprovalsPage>('ds_staff_approvals_page', { p_tab: tab });
export const getApproval = (id: string) => call<ApprovalDetail>('ds_staff_approval_get', { p_id: id });
export const getStaffSuppliers = () => call<StaffSuppliers>('ds_staff_suppliers_page');
export const getPartnersPage = () => call<PartnersPage>('ds_partners_page');
export const getChannelsPage = () => call<ChannelsPage>('ds_channels_page');
export const getInvoices = (f: { type?: string; q?: string; from?: string; to?: string; status?: string; limit?: number }) =>
  call<InvoicesPage>('ds_staff_invoices', { p_type: f.type || null, p_q: f.q || null, p_from: f.from || null, p_to: f.to || null, p_status: f.status || null, p_limit: f.limit ?? 200 });
export const getDocsPage = (q?: string, status?: string) => call<DocsPage>('ds_docs_page', { p_q: q || null, p_status: status || null });
export const getApplicationChecks = (id: string) => call<{ key: string; ok: boolean; label: string }[]>('ds_supplier_application_checks', { p_id: id });
