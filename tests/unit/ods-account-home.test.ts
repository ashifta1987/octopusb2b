import { describe, expect, it } from 'vitest';
import { buildWaitingItems } from '@/lib/core/waiting-items';
import { ACCOUNT_SERVICES, accountNavCurrent, bottomNavCurrent, buildAccountNav } from '@/app/ods/account/_lib/nav';
import { companyStatusName, dueText, greetingFor, kycState, orderStatusName, requestStatusName } from '@/app/ods/account/_lib/status';
import { STATUS_NAMES } from '@octopus/ui/status';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const day = 864e5;
const nowIso = new Date(NOW).toISOString();

describe('ODS T6 · account nav', () => {
  it('maps public paths to the sidebar item (old names included)', () => {
    expect(accountNavCurrent('/account')).toBe('home');
    expect(accountNavCurrent('/account/')).toBe('home');
    expect(accountNavCurrent('/account/action?type=pay')).toBe('action');
    expect(accountNavCurrent('/account/requests/RFQ-1042')).toBe('requests');
    expect(accountNavCurrent('/account/sourcing')).toBe('requests');
    expect(accountNavCurrent('/account/orders/abc')).toBe('orders');
    expect(accountNavCurrent('/account/ledger')).toBe('wallet');
    expect(accountNavCurrent('/account/kyc')).toBe('settings');
    expect(accountNavCurrent('/account/dropship/catalogue')).toBe('dropship');
    expect(accountNavCurrent('/account/notifications')).toBeUndefined();
    expect(accountNavCurrent('/account-other')).toBeUndefined();
  });
  it('bottom bar: Home · Requests · Orders · Wallet, everything else = More', () => {
    expect(bottomNavCurrent('/account')).toBe('home');
    expect(bottomNavCurrent('/account/wallet')).toBe('wallet');
    expect(bottomNavCurrent('/account/support')).toBe('more');
    expect(bottomNavCurrent('/account/notifications')).toBeUndefined();
  });
  it('groups, counts and Start flags', () => {
    const groups = buildAccountNav({
      counts: { action: 3, requests: 0, orders: 1 },
      started: { sourcing: true, turnkey: false, warehouse: false, shipping: false, brand: true, dropship: false },
    });
    expect(groups.map((g) => g.label)).toEqual(['Overview', 'Services', 'Money', 'Account']);
    const flat = groups.flatMap((g) => g.items);
    expect(flat.map((i) => i.label)).toEqual([
      'Home', 'Action needed', 'Sourcing requests', 'Orders', 'Turnkey projects', 'Warehouse (3PL)', 'Shipping', 'Make My Brand', 'Dropshipping', 'Wallet', 'Invoices', 'Team and settings', 'Support',
    ]);
    expect(flat.find((i) => i.id === 'action')?.count).toBe(3);
    expect(flat.find((i) => i.id === 'requests')?.count).toBeUndefined();
    expect(flat.filter((i) => i.notStarted).map((i) => i.id)).toEqual(['turnkey', 'warehouse', 'shipping', 'dropship']);
    expect(flat.every((i) => i.href.startsWith('/account'))).toBe(true);
  });
  it('start pages are today’s flows', () => {
    expect(ACCOUNT_SERVICES.sourcing.start).toBe('/request/sourcing');
    expect(ACCOUNT_SERVICES.warehouse.start).toBe('/3pl/apply');
    expect(ACCOUNT_SERVICES.brand.start).toBe('/request/brand');
  });
});

describe('ODS T6 · status names (Appendix C)', () => {
  it('orders and requests only use Appendix C names', () => {
    const raws = ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'weird'];
    raws.forEach((r) => expect(STATUS_NAMES.orders as readonly string[]).toContain(orderStatusName(r)));
    ['draft', 'submitted', 'assigned', 'quoting', 'quoted', 'accepted', 'closed', 'x'].forEach((r) => expect(STATUS_NAMES.requests as readonly string[]).toContain(requestStatusName(r)));
    expect(orderStatusName('deposit_pending')).toBe('Deposit due');
    expect(requestStatusName('quoted')).toBe('Quote ready');
  });
  it('company verification', () => {
    expect(companyStatusName(kycState('verified'))).toBe('Verified');
    expect(companyStatusName(kycState('in_review'))).toBe('Verification pending');
    expect(kycState('more_info')).toBe('more_info');
    expect(companyStatusName(kycState('not_started'))).toBe('Not verified');
    expect(STATUS_NAMES.company as readonly string[]).toContain(companyStatusName(kycState('rejected')));
  });
  it('due text and greeting', () => {
    expect(dueText(new Date(NOW + 2 * day + 3600e3).toISOString(), nowIso)).toEqual({ text: 'Expires in 2 days', urgent: true });
    expect(dueText(new Date(NOW + 9 * day).toISOString(), nowIso)).toEqual({ text: 'Expires in 9 days', urgent: false });
    expect(dueText(new Date(NOW + 3 * 3600e3).toISOString(), nowIso).text).toBe('Expires in 3 hours');
    expect(dueText(null, nowIso, 'pay')).toEqual({ text: 'Due now', urgent: true });
    expect(dueText(null, nowIso, 'reply').text).toBe('No due date');
    expect(greetingFor(null)).toBe('Hello');
    expect(greetingFor(9)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });
});

describe('ODS T6 · waiting items carry the Action needed fields', () => {
  it('type, action, ODS link and due date per rule; order unchanged', () => {
    const items = buildWaitingItems(
      {
        quotes: [{ rfq_id: 'r1', valid_until: new Date(NOW + 2 * day).toISOString(), rfqs: { code: 'RFQ-1', title: 'Mug' } }],
        orders: [
          { id: 'o1', code: 'OCT-1', title: 'Lamp', status: 'deposit_pending', updated_at: new Date(NOW - 5 * day).toISOString() },
          { id: 'o2', code: 'OCT-2', title: null, status: 'balance_pending', updated_at: new Date(NOW - 4 * day).toISOString() },
        ],
        transfers: [{ id: 't1', amount_cents: 50000, status: 'failed', reject_reason: 'Slip unreadable', confirmed_at: new Date(NOW - day).toISOString() }],
        kyc: { status: 'more_info', customer_message: 'Send the licence', reviewed_at: new Date(NOW - 2 * day).toISOString() },
      },
      nowIso,
    );
    expect(items.map((i) => i.key)).toEqual(['o-o1', 'o-o2', 'kyc', 't-t1', 'q-r1']);
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by['q-r1']).toMatchObject({ type: 'review', action: 'Review quote', odsHref: '/account/requests/RFQ-1', href: '/account/sourcing/RFQ-1', ref: 'RFQ-1' });
    expect(by['q-r1']!.dueAt).toBe(new Date(NOW + 2 * day).toISOString());
    expect(by['o-o1']).toMatchObject({ type: 'pay', action: 'Pay deposit', odsHref: '/account/orders/o1', dueAt: null });
    expect(by['o-o2']).toMatchObject({ type: 'pay', action: 'Pay balance', what: 'Balance for order OCT-2' });
    expect(by['t-t1']).toMatchObject({ type: 'pay', service: 'wallet', action: 'Upload slip' });
    expect(by.kyc).toMatchObject({ type: 'reply', service: 'account', odsHref: '/account/settings?tab=verification', href: '/account/kyc' });
  });
});
