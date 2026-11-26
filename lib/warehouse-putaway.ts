/**
 * Warehouse OS · W2b (putaway, pallets, bins, transfers, labels) — labels and shapes shared by the staff screens.
 * Client-safe (no server imports). The database (wh_* functions + RLS) decides what is allowed.
 */
import type { ItemLabel, Tone } from '@/lib/warehouse-inbound';

export const BIN_STATUS: Record<string, [string, Tone]> = {
  active: ['Active', 'ok'],
  blocked: ['Blocked', 'bad'],
  archived: ['Archived', 'neutral'],
};
export const PALLET_STATUS: Record<string, [string, Tone]> = {
  open: ['Open · not in a bin', 'warn'],
  stored: ['Stored', 'ok'],
  shipped: ['Shipped', 'neutral'],
  broken: ['Broken down', 'neutral'],
};
export const TRANSFER_STATUS: Record<string, [string, Tone]> = {
  draft: ['Draft', 'info'],
  in_transit: ['In transit', 'warn'],
  received: ['Received', 'ok'],
  cancelled: ['Cancelled', 'neutral'],
};
export const MOVE_KIND: Record<string, string> = {
  putaway: 'Put away', move: 'Moved', pallet_move: 'Pallet moved', transfer_out: 'Picked for transfer',
};
export const SOURCE_TEXT: Record<string, string> = {
  client: 'Client stock notice', sourcing: 'Sourcing', make_my_brand: 'Make My Brand', transfer: 'Transfer',
};

export type UnplacedLot = {
  lot_id: string; lot_code: string; warehouse_code: string; item_id: string; item: ItemLabel; qty: number; free: number;
  org_id: string | null; owner: string | null; source: string | null; source_ref: string | null; asn_id: string | null; created_at: string;
};
export type PalletRow = {
  id: string; code: string; warehouse_code: string; status: string; org_id: string | null; owner: string | null; asn_code: string | null;
  asn_source: string | null; bin_id: string | null; bin_code: string | null; note: string | null; units: number | null; lots: number; created_at: string;
};
export type BinRow = {
  id: string; code: string; warehouse_code: string; zone: string | null; status: string; block_reason: string | null;
  units: number | null; items: number; pallets: number;
};
export type BinContent = {
  bin_id: string; bin_code: string; warehouse_code: string; item_id: string; item: ItemLabel; lot_id: string; lot_code: string; pallet_code: string | null; qty: number;
};
export type MoveRow = {
  id: string; kind: string; warehouse_code: string; qty: number; reason: string | null; created_at: string; lot_code: string;
  pallet_code: string | null; from_bin: string | null; to_bin: string | null; item: ItemLabel; by_name: string | null;
};
export type PutawayBoard = {
  can_putaway: string[]; unplaced: UnplacedLot[]; pallets: PalletRow[]; bins: BinRow[]; contents: BinContent[]; recent: MoveRow[];
  asns: { id: string; code: string; warehouse_code: string; owner: string }[];
  clients: { org_id: string; name: string }[];
};

export type TransferLine = {
  id: string; item_id: string; item: ItemLabel; qty: number; dest_lot: string | null;
  picks: { lot_code: string; bin_code: string; pallet_code: string | null; qty: number }[];
};
export type TransferRow = {
  id: string; code: string; from_wh: string; to_wh: string; status: string; note: string | null; cancel_reason: string | null;
  created_at: string; dispatched_at: string | null; received_at: string | null; cancelled_at: string | null;
  created_by_name: string | null; dispatched_by_name: string | null; received_by_name: string | null;
  can_dispatch: boolean; can_receive: boolean; lines: TransferLine[];
};
export type TransfersBoard = {
  transfers: TransferRow[];
  stock: { warehouse_code: string; item_id: string; item: ItemLabel; available: number; placed: number }[];
  warehouses: { code: string; name: string; can_send: boolean }[];
};

export type LabelBoard = {
  can_print: string[];
  bins: { code: string; warehouse_code: string; zone: string | null; status: string; printed: number }[];
  pallets: { code: string; warehouse_code: string; status: string; owner: string; asn_code: string | null; bin_code: string | null; units: number | null; created_at: string; printed: number }[];
  asns: { code: string; warehouse_code: string; status: string; cartons: number | null; owner: string;
    lines: { n: number; item: ItemLabel; qty: number; lot_code: string | null; printed: number }[] }[];
  prints: { id: string; warehouse_code: string; kind: string; ref: string; copies: number; created_at: string; by_name: string | null }[];
};

/** Bin codes are rack-row-bin: A-01-03 (rack 1–3 letters, optional digits). */
export const BIN_CODE = /^[A-Z]{1,3}[0-9]{0,2}-[0-9]{2}-[0-9]{2}$/;
export const RACK_CODE = /^[A-Z]{1,3}[0-9]{0,2}$/;

/** The bins a range produces: rack A, rows 1–2, bins 1–3 → A-01-01 … A-02-03. Empty when the range is invalid. */
export function binRange(rack: string, rowFrom: number, rowTo: number, binFrom: number, binTo: number): string[] {
  const r = rack.trim().toUpperCase();
  if (!RACK_CODE.test(r) || ![rowFrom, rowTo, binFrom, binTo].every((n) => Number.isInteger(n) && n >= 1 && n <= 99)) return [];
  if (rowFrom > rowTo || binFrom > binTo) return [];
  const out: string[] = [];
  for (let row = rowFrom; row <= rowTo; row++) for (let b = binFrom; b <= binTo; b++) out.push(`${r}-${String(row).padStart(2, '0')}-${String(b).padStart(2, '0')}`);
  return out;
}

/** Carton label reference for an ASN line: ASN-0091-01. */
export const cartonRef = (asnCode: string, n: number) => `${asnCode}-${String(n).padStart(2, '0')}`;
