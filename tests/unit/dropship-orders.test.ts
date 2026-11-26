import { describe, expect, it } from 'vitest';
import type { OrderRow } from '@/lib/dropship-orders';
import { bulkPlan, chipCounts, inChip, itemsSummary, otherItemsText, paymentLabel, rowAction, statusLabel, usd } from '@/lib/dropship-orders-shared';

/** Release 3 · Step 8 — Orders page labels (screens/Orders.html, states/States-Orders.html wording). */
const base: OrderRow = {
  id: '1', order_number: 'SO-1', external_order_name: '#1046', channel: 'shopify', kind: 'store', created_at: '2026-11-23T10:00:00Z',
  destination_country: 'AE', incoterm: 'DDP', shipping_method: 'standard', total_cents: 1970, product_cents: 1290, processing_cents: 120,
  shipping_cents: 495, duties_cents: 65, payment_state: 'paid', merchant_status: 'processing', cancelled_at: null, delivered_at: null,
  buyer: 'Omar S.', items: [{ title: 'Pet water fountain', variant: null, qty: 1, model_no: 'DS-000001-01' }], other_items: 0,
  hold_code: null, hold_message: null, address_issue: null, payment_option: 'wallet', payment_due_at: null, expired_at: null, days_left: null,
  cancel_state: null, cancel_message: null, problem_code: null, refunded_cents: 0, last_charge_error: null, charged_at: '2026-11-23T10:00:00Z',
  test_order: false, invoice_number: 'OCT-DS-2026-000001', invoice_due_at: null, invoice_status: 'paid', protection_status: null,
  protection_release_at: null, track_token: null, address: null,
};
const row = (o: Partial<OrderRow>): OrderRow => ({ ...base, ...o });

describe('Orders labels', () => {
  it('money: US$ with two decimals; unknown stays unknown (never US$0.00)', () => {
    expect(usd(1970)).toBe('US$19.70');
    expect(usd(16410)).toBe('US$164.10');
    expect(usd(null)).toBe('Not known yet');
  });

  it('payment column', () => {
    expect(paymentLabel(base).label).toBe('Wallet · paid');
    expect(paymentLabel(row({ payment_state: 'held', payment_option: 'protection' })).label).toBe('Protected · held until delivery');
    expect(paymentLabel(row({ payment_state: 'held', payment_option: 'protection', protection_release_at: '2026-12-01T00:00:00Z' })).label).toBe('Protected · releases 1 Dec');
    expect(paymentLabel(row({ payment_state: 'unpaid', merchant_status: 'awaiting_payment', payment_option: null, days_left: 2 })).label).toBe('Awaiting payment · 2 days left');
    expect(paymentLabel(row({ payment_state: 'unpaid', days_left: 1 })).label).toBe('Awaiting payment · 1 day left');
    expect(paymentLabel(row({ payment_state: 'unpaid', hold_code: 'high_risk' })).label).toBe('Not charged yet');
    expect(paymentLabel(row({ payment_state: 'unpaid', expired_at: '2026-11-26T00:00:00Z' })).label).toBe('Not charged · window ended');
    expect(paymentLabel(row({ payment_state: 'refunded' })).label).toBe('Refunded to wallet');
    expect(paymentLabel(row({ payment_option: 'pay_later', invoice_due_at: '2026-12-23T00:00:00Z' })).label).toBe('Pay later · due 23 Dec');
  });

  it('status column with the exact hold reasons', () => {
    expect(statusLabel(row({ merchant_status: 'on_hold', hold_code: 'high_risk', payment_state: 'unpaid' })).label).toBe('On hold: high risk');
    expect(statusLabel(row({ merchant_status: 'on_hold', hold_code: 'address', payment_state: 'unpaid' })).label).toBe('On hold: address');
    expect(statusLabel(row({ merchant_status: 'on_hold', hold_code: 'stock_shortage' })).label).toBe('On hold: stock');
    expect(statusLabel(row({ merchant_status: 'awaiting_payment', payment_state: 'unpaid' })).label).toBe('To pay');
    expect(statusLabel(row({ merchant_status: 'shipped' })).label).toBe('Shipped');
    expect(statusLabel(row({ expired_at: '2026-11-26T00:00:00Z', cancelled_at: '2026-11-26T00:00:00Z', merchant_status: 'cancelled' })).label).toBe('Back to your store');
  });

  it('actions: Pay, Review, Fix address, Track', () => {
    expect(rowAction(row({ payment_state: 'unpaid', merchant_status: 'awaiting_payment' }))).toBe('pay');
    expect(rowAction(row({ payment_state: 'unpaid', merchant_status: 'awaiting_payment', total_cents: null }))).toBe('none');
    expect(rowAction(row({ payment_state: 'unpaid', hold_code: 'high_risk' }))).toBe('review');
    expect(rowAction(row({ payment_state: 'unpaid', hold_code: 'address' }))).toBe('fix_address');
    expect(rowAction(row({ merchant_status: 'shipped', track_token: 'a'.repeat(32) }))).toBe('track');
    expect(rowAction(base)).toBe('none');
  });

  it('chips: To pay / Processing / Issues counts', () => {
    const rows = [
      base,
      row({ id: '2', payment_state: 'unpaid', merchant_status: 'awaiting_payment', last_charge_error: 'WALLET_INSUFFICIENT' }),
      row({ id: '3', payment_state: 'unpaid', merchant_status: 'on_hold', hold_code: 'high_risk' }),
      row({ id: '4', merchant_status: 'shipped' }),
      row({ id: '5', payment_state: 'unpaid', merchant_status: 'cancelled', cancelled_at: 'x', expired_at: 'x' }),
    ];
    const c = chipCounts(rows);
    expect(c).toEqual({ to_pay: 1, all: 5, processing: 1, shipped: 1, delivered: 0, issues: 2 });
    expect(inChip(rows[2], 'to_pay')).toBe(false);
  });

  it('mixed carts and item summary', () => {
    expect(otherItemsText(1)).toBe('+1 item not from Octopus');
    expect(otherItemsText(3)).toBe('+3 items not from Octopus');
    expect(otherItemsText(0)).toBeNull();
    expect(itemsSummary(row({ items: [{ title: 'Magnetic phone holder', variant: null, qty: 2, model_no: 'DS-000002-01' }] }))).toBe('Magnetic phone holder ×2');
  });

  it('bulk plan: oldest first, only what the wallet covers', () => {
    const a = row({ id: 'a', payment_state: 'unpaid', merchant_status: 'awaiting_payment', total_cents: 1440, created_at: '2026-11-20T00:00:00Z' });
    const b = row({ id: 'b', payment_state: 'unpaid', merchant_status: 'awaiting_payment', total_cents: 990, created_at: '2026-11-21T00:00:00Z' });
    const p = bulkPlan([b, a], 1500);
    expect(p.due.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p.fits.map((r) => r.id)).toEqual(['a']);
    expect(p.totalDue).toBe(2430);
  });
});
