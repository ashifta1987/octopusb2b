import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Turnkey T6 — balance, shipments, documents, trips and handover, read with the signed-in session. Clients read the
 * customer-safe columns (row-level security: their company's projects; released documents only; shipments that are not
 * cancelled; passport copies of their company). Staff read tk_staff_shipping / tk_staff_trips (staff notes, authors,
 * reasons; passport copies only for staff with a need). Files open through short signed URLs from the private buckets:
 * documents 600 s, passport copies 60 s (storage policies decide who may sign them).
 */
export const TK_DOCUMENTS_BUCKET = 'turnkey-documents';
export const TK_PASSPORTS_BUCKET = 'turnkey-passports';
const DOC_URL_SECONDS = 600;
const PASSPORT_URL_SECONDS = 60;
const n = (v: unknown) => Number(v ?? 0);

async function sign(bucket: string, paths: string[], seconds: number): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const sb = await createClient();
  const { data } = await sb.storage.from(bucket).createSignedUrls(paths, seconds);
  const out = new Map<string, string>();
  for (const x of data ?? []) if (x.path && x.signedUrl) out.set(x.path, x.signedUrl);
  return out;
}
export const signDocuments = (paths: string[]) => sign(TK_DOCUMENTS_BUCKET, paths, DOC_URL_SECONDS);
export const signPassports = (paths: string[]) => sign(TK_PASSPORTS_BUCKET, paths, PASSPORT_URL_SECONDS);

type Doc = { id: string; number: string | null; status: string | null; paid_cents: number; amount_cents: number };
async function docs(ids: string[]): Promise<Map<string, Doc>> {
  if (!ids.length) return new Map();
  const sb = await createClient();
  const { data } = await sb.from('documents').select('id, number, status, paid_cents, amount_cents').in('id', ids);
  return new Map(((data ?? []) as Doc[]).map((d) => [d.id, { ...d, paid_cents: n(d.paid_cents), amount_cents: n(d.amount_cents) }]));
}

/* ───────── client ───────── */
export type TkClientBalance = { id: string; quote_id: string; total_cents: number; deposit_cents: number; amount_cents: number; currency: string; created_at: string; document: Doc | null };
export type TkClientShipment = {
  id: string; seq: number; mode: string; carrier: string; booking_ref: string | null; container_no: string | null; tracking_no: string | null; origin: string | null;
  destination: string | null; etd: string | null; eta: string | null; status: string; delivered_at: string | null; created_at: string;
  events: { id: number; happened_at: string; status_to: string | null; location: string | null; description: string }[];
};
export type TkClientDocument = {
  id: string; section: 'shipment' | 'handover'; shipment_id: string | null; kind: string; title: string; file_name: string; mime_type: string; size_bytes: number;
  released_at: string | null; url: string | null;
};
export type TkClientHandover = {
  items: { id: string; position: number; label: string; document_id: string | null; done_at: string | null }[];
  signoff: { signed_name: string; client_comment: string | null; items_count: number; signed_at: string } | null;
};

export async function getTkClientShipping(projectId: string) {
  const sb = await createClient();
  const [{ data: b }, { data: s }, { data: e }, { data: d }, { data: i }, { data: so }] = await Promise.all([
    sb.from('tk_quote_balances').select('id, quote_id, total_cents, deposit_cents, amount_cents, currency, document_id, created_at').eq('project_id', projectId).maybeSingle(),
    sb.from('tk_shipments').select('id, seq, mode, carrier, booking_ref, container_no, tracking_no, origin, destination, etd, eta, status, delivered_at, created_at').eq('project_id', projectId).order('seq'),
    sb.from('tk_shipment_events').select('id, shipment_id, happened_at, status_to, location, description').eq('project_id', projectId).order('happened_at', { ascending: false }).order('id', { ascending: false }),
    sb.from('tk_project_documents').select('id, section, shipment_id, kind, title, file_path, file_name, mime_type, size_bytes, released_at').eq('project_id', projectId).eq('status', 'released').order('released_at'),
    sb.from('tk_handover_items').select('id, position, label, document_id, done_at').eq('project_id', projectId).order('position'),
    sb.from('tk_handover_signoffs').select('signed_name, client_comment, items_count, signed_at').eq('project_id', projectId).maybeSingle(),
  ]);
  const bal = b as (Omit<TkClientBalance, 'document'> & { document_id: string }) | null;
  const D = (d ?? []) as (Omit<TkClientDocument, 'url'> & { file_path: string })[];
  const [dm, urls] = await Promise.all([docs(bal ? [bal.document_id] : []), signDocuments(D.map((x) => x.file_path))]);
  const E = (e ?? []) as (TkClientShipment['events'][number] & { shipment_id: string })[];
  return {
    balance: bal ? { id: bal.id, quote_id: bal.quote_id, total_cents: n(bal.total_cents), deposit_cents: n(bal.deposit_cents), amount_cents: n(bal.amount_cents), currency: bal.currency,
      created_at: bal.created_at, document: dm.get(bal.document_id) ?? null } as TkClientBalance : null,
    shipments: ((s ?? []) as Omit<TkClientShipment, 'events'>[]).map((x) => ({ ...x, events: E.filter((ev) => ev.shipment_id === x.id) })) as TkClientShipment[],
    documents: D.map(({ file_path, ...x }) => ({ ...x, size_bytes: n(x.size_bytes), url: urls.get(file_path) ?? null })) as TkClientDocument[],
    handover: { items: (i ?? []) as TkClientHandover['items'], signoff: (so ?? null) as TkClientHandover['signoff'] } as TkClientHandover,
  };
}

export type TkClientTrip = {
  id: string; seq: number; start_on: string; end_on: string; days: number; travellers: number; visa_letters: number; car_days: number; airport_pickups: number; hotel_help: boolean;
  client_message: string | null; list_cents: number; status: string; itinerary: string | null; trip_report: string | null; confirmed_at: string | null; cancelled_at: string | null;
  cancel_reason: string | null; created_at: string;
  fee: { id: string; amount_cents: number; currency: string; document: Doc | null } | null;
  passports: { id: string; position: number; full_name: string; mime_type: string; url: string | null }[];
};

/** The client's trips with the active fee and their own passport copies (60-second signed links). */
export async function getTkClientTrips(projectId: string): Promise<TkClientTrip[]> {
  const sb = await createClient();
  const { data } = await sb.from('tk_trips')
    .select('id, seq, start_on, end_on, days, travellers, visa_letters, car_days, airport_pickups, hotel_help, client_message, list_cents, status, itinerary, trip_report, confirmed_at, cancelled_at, cancel_reason, created_at')
    .eq('project_id', projectId).order('seq', { ascending: false });
  const trips = (data ?? []) as Omit<TkClientTrip, 'fee' | 'passports'>[];
  if (!trips.length) return [];
  const ids = trips.map((t) => t.id);
  const [{ data: fees }, { data: pass }] = await Promise.all([
    sb.from('tk_trip_fees').select('id, trip_id, amount_cents, currency, document_id').in('trip_id', ids).eq('status', 'active'),
    sb.from('tk_trip_travellers').select('id, trip_id, position, full_name, file_path, mime_type').in('trip_id', ids).order('position'),
  ]);
  const F = (fees ?? []) as { id: string; trip_id: string; amount_cents: number; currency: string; document_id: string | null }[];
  const P = (pass ?? []) as { id: string; trip_id: string; position: number; full_name: string; file_path: string; mime_type: string }[];
  const [dm, urls] = await Promise.all([docs(F.map((f) => f.document_id).filter((x): x is string => !!x)), signPassports(P.map((p) => p.file_path))]);
  return trips.map((t) => {
    const f = F.find((x) => x.trip_id === t.id);
    return {
      ...t, list_cents: n(t.list_cents),
      fee: f ? { id: f.id, amount_cents: n(f.amount_cents), currency: f.currency, document: f.document_id ? dm.get(f.document_id) ?? null : null } : null,
      passports: P.filter((p) => p.trip_id === t.id).map((p) => ({ id: p.id, position: p.position, full_name: p.full_name, mime_type: p.mime_type, url: urls.get(p.file_path) ?? null })),
    };
  });
}

/* ───────── staff (tk_staff_shipping / tk_staff_trips: staff who can view the project) ───────── */
export type TkStaffShipment = {
  id: string; seq: number; mode: string; carrier: string; booking_ref: string | null; container_no: string | null; tracking_no: string | null; origin: string | null;
  destination: string | null; etd: string | null; eta: string | null; status: string; delivered_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
  staff_note: string | null; created_at: string; created_by_name: string | null;
  events: { id: number; happened_at: string; status_to: string | null; location: string | null; description: string; created_at: string; created_by_name: string | null }[];
};
export type TkStaffDocument = {
  id: string; section: 'shipment' | 'handover'; shipment_id: string | null; kind: string; title: string; file_path: string; file_name: string; mime_type: string;
  size_bytes: number; status: 'draft' | 'released' | 'withdrawn'; released_at: string | null; withdrawn_at: string | null; withdraw_reason: string | null; created_at: string;
  uploaded_by_name: string | null; url?: string | null;
};
export type TkStaffShipping = {
  balance_state: string;
  balance: { id: string; quote_id: string; quote_version: number; total_cents: number; deposit_cents: number; amount_cents: number; document_id: string; document_number: string | null;
    document_status: string | null; paid_cents: number | null; paid: boolean; issued_by_name: string | null; created_at: string } | null;
  shipments: TkStaffShipment[];
  documents: TkStaffDocument[];
  items: { id: string; position: number; label: string; document_id: string | null; done_at: string | null; done_by_name: string | null; created_at: string }[];
  signoff: { signed_name: string; client_comment: string | null; items_count: number; signed_at: string; signed_by_email: string | null } | null;
};

export async function getTkStaffShipping(projectId: string): Promise<TkStaffShipping | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_staff_shipping', { p_project: projectId });
  if (error || !data) return null;
  const d = data as TkStaffShipping;
  const urls = await signDocuments(d.documents.map((x) => x.file_path));
  return {
    ...d,
    balance: d.balance ? { ...d.balance, total_cents: n(d.balance.total_cents), deposit_cents: n(d.balance.deposit_cents), amount_cents: n(d.balance.amount_cents),
      paid_cents: d.balance.paid_cents == null ? null : n(d.balance.paid_cents) } : null,
    documents: d.documents.map((x) => ({ ...x, size_bytes: n(x.size_bytes), url: urls.get(x.file_path) ?? null })),
  };
}

export type TkStaffTripFee = {
  id: string; version: number; amount_cents: number; starting_cents: number; needs_approval: boolean; status: string; note: string | null; proposed_by: string;
  proposed_by_name: string | null; proposed_at: string; approved_by_name: string | null; approved_at: string | null; rejected_by_name: string | null; rejected_at: string | null;
  reject_reason: string | null; withdrawn_at: string | null; document_id: string | null; document_number: string | null; document_status: string | null; paid_cents: number | null; paid: boolean;
};
export type TkStaffTrip = {
  id: string; seq: number; start_on: string; end_on: string; days: number; travellers: number; visa_letters: number; car_days: number; airport_pickups: number; hotel_help: boolean;
  client_message: string | null; day_cents: number; included_travellers: number; extra_traveller_day_cents: number; visa_letter_cents: number; car_day_cents: number;
  airport_pickup_cents: number; hotel_help_cents: number; list_cents: number; status: string; itinerary: string | null; trip_report: string | null; confirmed_at: string | null;
  completed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; guide_name: string | null; staff_notes: string | null; created_at: string;
  requested_by_name: string | null; confirmed_by_name: string | null; paid: boolean; fees: TkStaffTripFee[]; passports_count: number;
  passports: { id: string; position: number; full_name: string; file_path: string; mime_type: string; size_bytes: number; created_at: string; url?: string | null }[] | null;
};
export type TkStaffTrips = { passport_access: boolean; trips: TkStaffTrip[] };

export async function getTkStaffTrips(projectId: string): Promise<TkStaffTrips | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_staff_trips', { p_project: projectId });
  if (error || !data) return null;
  const d = data as TkStaffTrips;
  const urls = d.passport_access ? await signPassports(d.trips.flatMap((t) => (t.passports ?? []).map((p) => p.file_path))) : new Map<string, string>();
  return {
    ...d,
    trips: d.trips.map((t) => ({
      ...t, list_cents: n(t.list_cents), passports_count: n(t.passports_count),
      fees: t.fees.map((f) => ({ ...f, amount_cents: n(f.amount_cents), starting_cents: n(f.starting_cents), paid_cents: f.paid_cents == null ? null : n(f.paid_cents) })),
      passports: t.passports ? t.passports.map((p) => ({ ...p, url: urls.get(p.file_path) ?? null })) : null,
    })),
  };
}

/** Visit China and trip-extra prices from the services list (tk_services: active rows, public columns). */
export async function getTkTripPrices() {
  const sb = await createClient();
  const { data } = await sb.from('tk_services').select('code, from_cents, included_travellers, extra_traveller_day_cents')
    .in('code', ['visit_china', 'visa_letter', 'car_driver', 'airport_pickup', 'hotel_help']).eq('active', true);
  return (data ?? []) as { code: string; from_cents: number; included_travellers: number | null; extra_traveller_day_cents: number | null }[];
}
