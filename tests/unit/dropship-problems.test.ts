import { describe, expect, it } from 'vitest';
import { caseSteps, centsFromInput, claimPhotoPath, orderProgress, ticketStatusLabel, usd, waitingOn } from '@/lib/dropship-problems-shared';

describe('dropship problems (Step 10) — pure labels', () => {
  it('formats US$ with two decimals and parses staff amounts', () => {
    expect(usd(1850)).toBe('US$18.50');
    expect(usd(null)).toBe('Not known yet');
    expect(centsFromInput('18.5')).toBe(1850);
    expect(centsFromInput('US$1,000.00')).toBe(100000);
    expect(centsFromInput('-1')).toBeNull();
    expect(centsFromInput('1.234')).toBeNull();
  });

  it('claim stepper follows States-Orders (Reported → carrier → decision → reship or refund)', () => {
    const s = caseSteps({ kind: 'lost', status: 'carrier_claim', carrier_claim_ref: 'YT-1', merchant_choice: 'reship', return_to: null });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(s[1].detail).toBe('YT-1');
    expect(s[3].detail).toBe('Your choice: reship');
    const done = caseSteps({ kind: 'damaged', status: 'refunded', carrier_claim_ref: null, merchant_choice: 'refund', return_to: null });
    expect(done.every((x) => x.state === 'done')).toBe(true);
  });

  it('return stepper: warehouse path vs own address', () => {
    expect(caseSteps({ kind: 'return', status: 'received', carrier_claim_ref: null, merchant_choice: null, return_to: 'warehouse' }).map((x) => x.state))
      .toEqual(['done', 'done', 'current', 'upcoming']);
    expect(caseSteps({ kind: 'return', status: 'closed', carrier_claim_ref: null, merchant_choice: null, return_to: 'merchant' })).toHaveLength(2);
  });

  it('who a case waits on and how tickets read to merchants (no SLA)', () => {
    expect(waitingOn('awaiting_approval')).toBe('Finance');
    expect(waitingOn('carrier_claim')).toBe('Carrier claim');
    expect(ticketStatusLabel('waiting_customer').label).toBe('Waiting on you');
    expect(ticketStatusLabel('closed').label).toBe('Resolved');
  });

  it('order progress marks the first unfinished step as current', () => {
    const p = orderProgress({ created_at: '2026-11-23T10:12:00Z', charged_at: '2026-11-23T10:12:00Z', payment_option: 'wallet', address_ok: true,
      packing_started: false, packed: false, handed_over: false, delivered: false, cancelled: false, channel: 'shopify' });
    expect(p.map((x) => x.state)).toEqual(['done', 'done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(p[0].label).toBe('Order received from Shopify');
    expect(p[3].detail).toMatch(/until it is packed/);
  });

  it('claim photo path is <org>/<order>/<uuid>.<ext> and only for images', () => {
    expect(claimPhotoPath('o', 's', 'u', 'image/png')).toBe('o/s/u.png');
    expect(claimPhotoPath('o', 's', 'u', 'application/pdf')).toBeNull();
  });
});
