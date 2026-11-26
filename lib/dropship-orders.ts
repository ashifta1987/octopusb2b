import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Octopus Dropship · Release 3 · Step 8 (paying for orders) — data loaders. Merchants read ONLY through the SECURITY
 * DEFINER RPCs of migration *_ds8_order_payment_intake (ds_orders_page, ds_wallet_get, ds_order_detail_events). They return
 * the merchant's own orders: Octopus lines only, cost lines (product, processing, shipping, duties — unknown duties stay
 * null, never 0), how each order is paid and its hold with the exact reason. Pay later appears only for credit_eligible
 * organisations (the field is null for everyone else and the UI never mentions it).
 */

export type PaymentOption = 'wallet' | 'protection' | 'pay_later';
export type HoldCode = 'high_risk' | 'address' | 'stock_shortage' | 'duty_unknown';

export type OrderRow = {
  id: string;
  order_number: string;
  external_order_name: string | null;
  channel: string;
  kind: 'store' | 'sample';
  created_at: string;
  destination_country: string;
  incoterm: 'DDP' | 'DAP';
  shipping_method: string;
  total_cents: number | null;
  product_cents: number;
  processing_cents: number;
  shipping_cents: number;
  duties_cents: number | null;
  payment_state: 'unpaid' | 'held' | 'paid' | 'refunded';
  merchant_status: 'awaiting_payment' | 'on_hold' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  cancelled_at: string | null;
  delivered_at: string | null;
  buyer: string | null;
  items: { title: string; variant: string | null; qty: number; model_no: string }[];
  other_items: number;
  hold_code: HoldCode | null;
  hold_message: string | null;
  address_issue: string | null;
  payment_option: PaymentOption | null;
  payment_due_at: string | null;
  expired_at: string | null;
  days_left: number | null;
  cancel_state: 'accepted' | 'rejected' | null;
  cancel_message: string | null;
  problem_code: 'address_after_packing' | null;
  refunded_cents: number;
  last_charge_error: string | null;
  charged_at: string | null;
  test_order: boolean;
  invoice_number: string | null;
  invoice_due_at: string | null;
  invoice_status: string | null;
  protection_status: 'held' | 'partially_released' | 'released' | 'refunded' | 'disputed' | null;
  protection_release_at: string | null;
  track_token: string | null;
  address: Record<string, string> | null;
};

export type OrderSettings = { payment_mode: PaymentOption; auto_pay: boolean; saved: boolean };

export type OrdersPageData = {
  dropship_status: 'on' | 'paused' | 'off';
  wallet: { available_cents: number; held_cents: number };
  settings: OrderSettings;
  /** null unless the organisation is credit_eligible (then: whether pay later can be used right now) */
  pay_later: boolean | null;
  expiry_days: number;
  store_connected: boolean;
  rows: OrderRow[];
};

export type WalletDsData = {
  orders_on: boolean;
  dropship_status: 'on' | 'paused' | 'off';
  available_cents: number;
  held_cents: number;
  held_orders: number;
  waiting_orders: number;
  waiting_cents: number;
  expiry_days: number;
  protection_days: number;
  protection_enabled: boolean;
  settings: OrderSettings;
  pay_later: boolean | null;
};

export type OrderEvent = { kind: string; title: string; body: string | null; amount_cents: number | null; at: string };

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getOrdersPage = () => call<OrdersPageData>('ds_orders_page');
export const getWalletDs = () => call<WalletDsData>('ds_wallet_get');
export const getOrderEvents = (id: string) => call<OrderEvent[]>('ds_order_detail_events', { p_so: id });
