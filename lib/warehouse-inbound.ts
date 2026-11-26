/**
 * Warehouse OS · W2a (inbound) — labels and shapes shared by the staff screens and the client portal.
 * Client-safe (no server imports). The database (wh_* functions + RLS) decides what is allowed.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const ASN_STATUS: Record<string, [string, Tone]> = {
  submitted: ['Submitted', 'info'],
  booked: ['Booked', 'info'],
  arrived: ['Arrived', 'warn'],
  receiving: ['Receiving', 'warn'],
  received: ['Received', 'ok'],
  cancelled: ['Cancelled', 'neutral'],
};
export const SLOT_STATUS: Record<string, [string, Tone]> = {
  booked: ['Booked', 'info'],
  arrived: ['Arrived', 'warn'],
  unloading: ['Unloading', 'warn'],
  done: ['Done', 'ok'],
  cancelled: ['Cancelled', 'neutral'],
};
export const LINE_STATUS: Record<string, [string, Tone]> = {
  pending: ['Not counted', 'neutral'],
  counted: ['Recount needed', 'warn'],
  blocked: ['Blocked · waiting for a supervisor', 'bad'],
  accepted: ['Accepted', 'ok'],
};
export const SOURCE_LABEL: Record<string, string> = { client: 'Client stock', sourcing: 'Octopus B2B stock', make_my_brand: 'Make My Brand stock' };

export type ItemLabel = { sku: string | null; name: string | null; barcode: string | null; owner: 'client' | 'octopus' } | null;
export type CountPass = { pass: 1 | 2; good: number; damaged: number; by: string | null; by_name: string | null; note?: string | null; at?: string };

export type AsnRow = {
  id: string; code: string; org_id: string | null; org_name: string | null; warehouse_code: string; source: string;
  expected_date: string; cartons: number | null; pallets: number | null; status: string; client_note: string | null;
  cancel_reason: string | null; booked_slot_at: string | null; received_at: string | null; created_at: string;
  lines: number; units: number | null; attention: number;
};

export type AsnDetail = {
  asn: AsnRow & { created_by_name: string | null };
  me: string;
  can_receive: boolean;
  can_approve: boolean;
  slot: { id: string; dock: string; starts_at: string; ends_at: string; status: string } | null;
  lines: {
    id: string; item_id: string; expected: number; good: number | null; damaged: number | null; status: string; item: ItemLabel;
    counts: CountPass[]; lot: { id: string; code: string; qty: number; status: string } | null;
  }[];
};

/** "2 pallets · 40 cartons"; empty when the load is unknown (never 0). */
export function loadText(cartons: number | null, pallets: number | null) {
  return [pallets ? `${pallets} pallet${pallets === 1 ? '' : 's'}` : '', cartons ? `${cartons} carton${cartons === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' · ');
}

export function itemText(i: ItemLabel) {
  if (!i) return 'Unknown item';
  return [i.sku, i.name].filter(Boolean).join(' · ') || 'Item without a name';
}

/** A date-only value ('2026-11-26') as '26 Nov 2026' — same on the server and in every browser time zone. */
export function fmtDay(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}

/** A timestamp at the warehouse (China time), e.g. '26 Nov, 14:00'. */
export function fmtWh(ts: string | null | undefined, timeZone = 'Asia/Shanghai') {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Database error → a sentence for people ("DOUBLE_BOOKED: dock D1 is …" → "Dock D1 is …"). */
export function cleanDbError(m: string): string {
  if (/FORBIDDEN/.test(m) && !/:/.test(m.replace(/^FORBIDDEN/, ''))) return 'You don’t have permission to do this.';
  if (/NOT_FOUND/.test(m) && !/:/.test(m.replace(/^NOT_FOUND/, ''))) return 'Not found. Reload the page and try again.';
  const t = m.replace(/^[A-Z_]+:\s*/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
