import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CaseKind, CaseStatus, TicketStatus } from '@/lib/dropship-problems-shared';

/**
 * Octopus Dropship · Release 4 · Step 10 — data loaders for order problems and support. Merchants read ONLY through the
 * SECURITY DEFINER RPCs of migration *_ds10_order_problems_support (ds10_order_detail, ds10_support_page): their own
 * organisation, white-label safe (no supplier, cost or margin; staff names never shown). Staff read ds10_staff_board().
 * Photos are private: signed URLs (10 minutes) are made with the signed-in person's session, the storage policies decide.
 */

export type CaseRow = {
  id: string; code: string; store_order_id: string; kind: CaseKind; status: CaseStatus;
  merchant_choice: 'reship' | 'refund' | null; description: string; return_to: 'merchant' | 'warehouse' | null;
  return_reason: string | null; return_units: { item_id: string; model_no: string; title: string; qty: number }[];
  return_tracking: string | null; carrier_claim_ref: string | null; outcome: string | null; outcome_message: string | null;
  refund_cents: number | null; refund_destination: string | null; decided_at: string | null; created_at: string;
  history: { step: string; text: string; at: string }[]; order_number: string; external_order_name: string | null;
  reship: { id: string; order_number: string; merchant_status: string } | null; credit_note: string | null;
  ticket: { id: string; code: string; status: TicketStatus } | null; photos: string[];
  warehouse_return: { code: string; status: string; decision: string | null; units: number; good_units: number } | null;
  photo_urls?: (string | null)[];
};

export type StaffCaseRow = CaseRow & {
  merchant: string; org_id: string; suggested_refund_cents: number | null; refund_cap_cents: number; order_total_cents: number | null;
  payment_option: string | null; protected_open: boolean; ticket_sla_due_at: string | null; ticket_owner: string | null; wh_return_id: string | null;
  approval: { id: string; status: string; amount_cents: number; requested_by: string; requested_by_name: string | null; can_approve: boolean } | null;
};

export type TimelineEntry = { source: string; kind: string; title: string; body: string | null; amount_cents?: number | null; at: string };

export type OrderDetail = {
  order: {
    id: string; order_number: string; external_order_name: string | null; channel: string; kind: string; created_at: string; merchant_status: string;
    payment_state: string; destination_country: string; incoterm: 'DDP' | 'DAP'; shipping_method: string; cancelled_at: string | null;
    delivered_at: string | null; units: number; test_order: boolean; reship_of: { id: string; order_number: string; external_order_name: string | null } | null;
  };
  items: { title: string; variant: string | null; qty: number; model_no: string; item_id: string }[];
  other_items: number;
  cost: { product_cents: number; processing_cents: number; shipping_cents: number; duties_cents: number | null; total_cents: number | null; refunded_cents: number };
  payment: {
    option: 'wallet' | 'protection' | 'pay_later' | null; charged_cents: number | null; charged_at: string | null; invoice_number: string | null;
    invoice_status: string | null; protection_status: string | null; protection_release_at: string | null; hold_code: string | null;
    hold_message: string | null; expired_at: string | null; payment_due_at: string | null;
  };
  ship_to: { name: string | null; address: Record<string, string> | null };
  tracking_token: string | null;
  stage: { packing_started: boolean; label_created: boolean; handed_over: boolean; delivered: boolean; packed: boolean; address_ok: boolean };
  actions: {
    cancel: boolean; cancel_reason: string | null; address: boolean; address_after_label: boolean; claim: boolean; claim_reason: string | null;
    return: boolean; return_reason: string | null; claim_window_days: number; return_window_days: number;
  };
  cases: CaseRow[];
  reweigh: {
    id: string; amount_cents: number; quoted_weight_g: number; billed_weight_g: number; measured_weight_g: number; tolerance_g: number | null;
    dispute_until: string; can_dispute: boolean; dispute_state: 'open' | 'refunded' | 'rejected' | null; dispute_reason: string | null;
    dispute_answer: string | null; refund_cents: number | null; invoice_number: string | null; credit_note: string | null; photo_path: string | null;
    created_at: string; photo_url?: string | null;
  } | null;
  tickets: { id: string; code: string; subject: string; status: TicketStatus; updated_at: string }[];
  return_address: { merchant: Record<string, string | null> | null; warehouse: Record<string, string | null> | null };
  timeline: TimelineEntry[];
};

export type SupportTicket = {
  id: string; code: string; subject: string; category: string; status: TicketStatus; updated_at: string; created_at: string;
  store_order: { id: string; order_number: string; external_order_name: string | null } | null; rfq: string | null; b2b_order: string | null;
  case: { code: string; kind: CaseKind; status: CaseStatus } | null;
};
export type SupportPageData = {
  orders_on: boolean; tickets: SupportTicket[]; orders: { id: string; order_number: string; external_order_name: string | null }[];
};

export type ReweighCandidate = {
  store_order_id: string; order_number: string; external_order_name: string | null; merchant: string; wh_order_code: string; quoted_g: number; actual_g: number;
  volumetric_g: number; billed_g: number; diff_g: number; tolerance_g: number | null; amount_cents: number; over: boolean; tolerance_unknown: boolean;
  photo_path: string | null; dispute_days: number;
};
export type ReweighDispute = {
  id: string; store_order_id: string; order_number: string; external_order_name: string | null; merchant: string; amount_cents: number;
  quoted_weight_g: number; billed_weight_g: number; tolerance_g: number | null; dispute_reason: string; disputed_at: string; photo_path: string | null;
};
export type StaffBoard = {
  can_edit: boolean; can_approve: boolean; approval_limit_cents: number; open: StaffCaseRow[]; done: StaffCaseRow[];
  reweigh_candidates: ReweighCandidate[]; reweigh_disputes: ReweighDispute[];
};

type Sb = Awaited<ReturnType<typeof createClient>>;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

/** 10-minute signed URLs; the storage policies decide who may read (own company / staff). */
export async function signPaths(sb: Sb, bucket: 'ds-claims' | 'wh-evidence', paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!uniq.length) return out;
  const { data } = await sb.storage.from(bucket).createSignedUrls(uniq, 600);
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  return out;
}

export async function getOrderDetail(id: string): Promise<OrderDetail> {
  const d = await call<OrderDetail>('ds10_order_detail', { p_so: id });
  const sb = await createClient();
  const claimUrls = await signPaths(sb, 'ds-claims', d.cases.flatMap((c) => c.photos));
  d.cases = d.cases.map((c) => ({ ...c, photo_urls: c.photos.map((p) => claimUrls.get(p) ?? null) }));
  if (d.reweigh?.photo_path) d.reweigh.photo_url = (await signPaths(sb, 'wh-evidence', [d.reweigh.photo_path])).get(d.reweigh.photo_path) ?? null;
  return d;
}

export const getSupportPage = () => call<SupportPageData>('ds10_support_page');

export async function getStaffBoard(): Promise<StaffBoard> {
  const b = await call<StaffBoard>('ds10_staff_board');
  const sb = await createClient();
  const urls = await signPaths(sb, 'ds-claims', [...b.open, ...b.done].flatMap((c) => c.photos));
  const fix = (c: StaffCaseRow) => ({ ...c, photo_urls: c.photos.map((p) => urls.get(p) ?? null) });
  return { ...b, open: b.open.map(fix), done: b.done.map(fix) };
}
