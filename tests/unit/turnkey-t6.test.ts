import { describe, expect, it } from 'vitest';
import {
  balanceCents, balanceGate, docKindLabel, handoverReady, nextShipmentStatuses, passportExt, shipmentGate, tripDays, tripPrice, tripPricesFrom, tripSummary,
} from '@/lib/turnkey/format';

const SERVICES = [
  { code: 'visit_china', from_cents: 39900, included_travellers: 2, extra_traveller_day_cents: 9900 },
  { code: 'visa_letter', from_cents: 4900 }, { code: 'car_driver', from_cents: 10000 }, { code: 'airport_pickup', from_cents: 3900 }, { code: 'hotel_help', from_cents: 0 },
];

describe('turnkey T6 helpers', () => {
  it('balance = quote total − deposit, never negative', () => {
    expect(balanceCents(300000, 90000)).toBe(210000);
    expect(balanceCents(1000, 1000)).toBe(0);
  });
  it('balance gate mirrors tk_balance_state', () => {
    expect(balanceGate('paid').done).toBe(true);
    expect(balanceGate('none').done).toBe(true);
    expect(balanceGate('unpaid')).toEqual({ done: false, text: expect.stringContaining('paid the balance in full') });
    expect(balanceGate('not_invoiced').text).toContain('issue the balance invoice');
    expect(balanceGate('no_quote').done).toBe(false);
  });
  it('shipment status moves forward only; Shipment completes when every live shipment is delivered', () => {
    expect(nextShipmentStatuses('booked')).toEqual(['in_transit', 'arrived', 'delivered']);
    expect(nextShipmentStatuses('delivered')).toEqual([]);
    expect(nextShipmentStatuses('cancelled')).toEqual([]);
    expect(shipmentGate([]).done).toBe(false);
    expect(shipmentGate([{ status: 'delivered' }, { status: 'cancelled' }]).done).toBe(true);
    expect(shipmentGate([{ status: 'delivered' }, { status: 'in_transit' }]).text).toContain('1 not delivered');
  });
  it('trip price from the services list: per day up to 2 people, extra traveller per day, extras (mirrors tk_trip_estimate)', () => {
    const p = tripPricesFrom(SERVICES)!;
    const r = tripPrice(p, { start: '2027-03-12', end: '2027-03-14', travellers: 3, visaLetters: 3, carDays: 2, airportPickups: 1, hotelHelp: true });
    expect(r.days).toBe(3);
    expect(r.problem).toBeNull();
    expect(r.listCents).toBe(3 * 39900 + 3 * 9900 + 3 * 4900 + 2 * 10000 + 3900);
    expect(r.listCents).toBe(188000);
    const two = tripPrice(p, { start: '2027-03-12', end: '2027-03-12', travellers: 2, visaLetters: 0, carDays: 0, airportPickups: 0, hotelHelp: false });
    expect(two.listCents).toBe(39900);
    expect(two.lines.some((l) => l.label.startsWith('Extra traveller'))).toBe(false);
  });
  it('trip requests the database refuses are flagged first', () => {
    const p = tripPricesFrom(SERVICES)!;
    const base = { start: '2027-03-12', end: '2027-03-13', travellers: 2, visaLetters: 0, carDays: 0, airportPickups: 0, hotelHelp: false };
    expect(tripPrice(p, { ...base, visaLetters: 3 }).problem).toContain('visa letter');
    expect(tripPrice(p, { ...base, carDays: 3 }).problem).toContain('Car and driver');
    expect(tripPrice(p, { ...base, end: '2027-04-20' }).problem).toContain('30 days');
    expect(tripPrice(p, { ...base, end: '2027-03-01' }).problem).toContain('first and the last day');
    expect(tripDays('2027-03-12', '2027-03-12')).toBe(1);
    expect(tripPricesFrom([{ code: 'visa_letter', from_cents: 4900 }])).toBeNull();
  });
  it('labels', () => {
    expect(docKindLabel('bill_of_lading')).toBe('Bill of lading');
    expect(docKindLabel('other')).toBe('Document');
    expect(passportExt('application/pdf')).toBe('pdf');
    expect(passportExt('image/jpeg')).toBe('jpg');
    expect(tripSummary({ start_on: 'a', end_on: 'b', days: 1, travellers: 1 }, (x) => x)).toBe('a · 1 day · 1 traveller');
  });
  it('handover: sign when every checklist line (at least one) is ready', () => {
    expect(handoverReady([]).ready).toBe(false);
    expect(handoverReady([{ done_at: 'x' }, { done_at: null }]).text).toContain('1 of 2');
    expect(handoverReady([{ done_at: 'x' }]).ready).toBe(true);
  });
});
