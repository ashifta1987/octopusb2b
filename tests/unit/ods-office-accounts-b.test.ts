import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUS_NAMES } from '@octopus/ui/status';
import {
  CREDIT_TABS, HOLD_TABS, NET_DAYS, OPEN_HOLD_STATUSES, PLATFORM_SETTINGS, PROFORMA_REF, TOPUP_REF,
  creditAvailable, creditPill, creditSource, creditUsage, defaultHoldReason, fmtMinor, holdIsOpen, holdNeedsSecond, holdPill, holdRemaining, holdThreshold,
  matchesCreditTab, matchesHoldTab, overrideText, priceFor, saasDecision, saasStatusLine, splitPrices, toMinor, topupPill, totalsByCurrency, totalsText,
  validateProformaTransfer, validateTransferConfirm, walletPerms,
} from '@/app/ods/admin/finance/_accounts-b/core';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const appendixPayments = STATUS_NAMES.payments as readonly string[];
const perm = (list: string[], isAdmin = false) => ({ isAdmin, can: (a: string, x: string) => isAdmin || list.includes(`${a}:${x}`) });

describe('ODS T9 accounts B · held payments', () => {
  it('statuses use Appendix C payment names', () => {
    for (const s of ['held', 'partially_released', 'disputed', 'released', 'refunded']) expect(appendixPayments).toContain(holdPill(s).status);
    expect(holdPill('disputed')).toMatchObject({ status: 'Held', step: 'Disputed', attention: true });
    expect(holdPill('partially_released')).toMatchObject({ status: 'Held', step: 'Partly released' });
  });
  it('tabs, remaining and open rule = today', () => {
    expect(HOLD_TABS[0][0]).toBe('open');
    expect([...OPEN_HOLD_STATUSES]).toEqual(['held', 'partially_released', 'disputed']);
    expect(matchesHoldTab('disputed', 'open') && !matchesHoldTab('released', 'open') && matchesHoldTab('released', 'all')).toBe(true);
    const h = { status: 'partially_released', amount_cents: 1000, released_cents: 400, refunded_cents: 100 };
    expect(holdRemaining(h)).toBe(500);
    expect(holdIsOpen(h)).toBe(true);
    expect(holdIsOpen({ ...h, released_cents: 900 })).toBe(false);
    expect(holdIsOpen({ ...h, status: 'released' })).toBe(false);
    expect(defaultHoldReason('disputed')).toBe('Dispute resolved & milestone confirmed');
    expect(defaultHoldReason('held')).toBe('Milestone confirmed');
  });
  it('threshold as today (missing or 0 → US$ 1,000); note only, the DB decides', () => {
    expect(holdThreshold(undefined)).toBe(100000);
    expect(holdThreshold(0)).toBe(100000);
    expect(holdThreshold('250000')).toBe(250000);
    expect(holdNeedsSecond(100001, 100000) && !holdNeedsSecond(100000, 100000)).toBe(true);
  });
});

describe('ODS T9 accounts B · credit terms', () => {
  it('pill + tabs', () => {
    expect(creditPill('pending_approval')).toMatchObject({ status: 'Waiting' });
    expect(STATUS_NAMES.approvals as readonly string[]).toContain('Waiting');
    expect(creditPill('rejected').status).toBe('Rejected');
    expect(creditPill('active')).toMatchObject({ label: 'Active', tone: 'success' });
    expect(CREDIT_TABS.map(([t]) => t)).toEqual(['all', 'waiting', 'active', 'other']);
    expect(matchesCreditTab('suspended', 'other') && !matchesCreditTab('active', 'other')).toBe(true);
    expect([...NET_DAYS]).toEqual([7, 15, 30, 45, 60]);
  });
  it('usage and available = today’s sums', () => {
    const unpaid = [
      { org_id: 'o', division_id: 'd1', amount_cents: 1000, paid_cents: 300 },
      { org_id: 'o', division_id: 'd2', amount_cents: 500, paid_cents: 0 },
      { org_id: 'x', division_id: 'd1', amount_cents: 999, paid_cents: 0 },
      { org_id: 'o', division_id: 'd1', amount_cents: 100, paid_cents: 200 },
    ];
    const res = [{ org_id: 'o', division_id: 'd1', amount_cents: 50 }, { org_id: 'o', division_id: 'd2', amount_cents: 70 }];
    expect(creditUsage('o', null, unpaid, res)).toEqual({ unpaid: 1200, reserved: 120 });
    expect(creditUsage('o', 'd1', unpaid, res)).toEqual({ unpaid: 700, reserved: 50 });
    expect(creditAvailable({ credit_limit_cents: 1000, unpaid_invoices_cents: 700, reserved_cents: 500 })).toBe(0);
    expect(creditAvailable({ credit_limit_cents: 1000, unpaid_invoices_cents: 200, reserved_cents: 100 })).toBe(700);
  });
});

describe('ODS T9 accounts B · bank transfers', () => {
  const reasons = ['bank_charges', 'exchange_rate', 'partial_payment', 'other'];
  it('confirm checks = today’s confirmTransfer', () => {
    expect(validateTransferConfirm({ received: '', bankRef: 'x', reason: '', reasonText: '' }, 100, reasons, 80)).toMatch(/amount that actually arrived/);
    expect(validateTransferConfirm({ received: '1.00', bankRef: ' ', reason: '', reasonText: '' }, 100, reasons, 80)).toMatch(/bank reference/);
    expect(validateTransferConfirm({ received: '1.00', bankRef: 'R1', reason: '', reasonText: '' }, 100, reasons, 80)).toBeNull();
    expect(validateTransferConfirm({ received: '0.95', bankRef: 'R1', reason: '', reasonText: '' }, 100, reasons, 80)).toMatch(/choose the reason/);
    expect(validateTransferConfirm({ received: '0.95', bankRef: 'R1', reason: 'other', reasonText: '' }, 100, reasons, 80)).toMatch(/Other/);
    expect(validateTransferConfirm({ received: '0.95', bankRef: 'R1', reason: 'other', reasonText: 'x'.repeat(81) }, 100, reasons, 80)).toMatch(/80 characters/);
    expect(validateTransferConfirm({ received: '1,000.00', bankRef: 'R1', reason: 'bank_charges', reasonText: '' }, 100, reasons, 80)).toBeNull();
  });
  it('proforma checks = today’s recordProformaTransfer', () => {
    expect(validateProformaTransfer({ number: 'X-1', amount: '1', bankRef: 'r' })).toMatch(/proforma number/);
    expect(validateProformaTransfer({ number: 'pf-2026-1', amount: '1', bankRef: '' })).toMatch(/reference/);
    expect(validateProformaTransfer({ number: 'PI-2026-1', amount: '0', bankRef: 'r' })).toMatch(/amount/);
    expect(validateProformaTransfer({ number: 'PF-2026-000012', amount: '1,200.50', bankRef: 'r' })).toBeNull();
  });
  it('payment names (Appendix C) and parsing', () => {
    for (const s of ['pending', 'credited', 'failed']) expect(appendixPayments).toContain(topupPill(s).status);
    expect(toMinor('1,000.50')).toBe(100050);
    expect(toMinor('')).toBeNull();
    expect(toMinor('abc')).toBeNull();
  });
});

describe('ODS T9 accounts B · money flows: today’s actions, two-person where today has none', () => {
  const gated = read('app/ods/admin/finance/_accounts-b/gated-actions.ts');
  it('the gate file only calls today’s actions (no rpc / insert / update of its own)', () => {
    expect(gated).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(gated).toMatch(/await confirmTransfer\(id, fd\)/);
    expect(gated).toMatch(/await recordProformaTransfer\(null, fd\)/);
    expect(gated).toMatch(/await confirmTopup\(id\)/);
    expect(gated.match(/runTwoPersonPayment\(/g)).toHaveLength(3);
    expect(gated).toMatch(/can\(s, 'wallet', 'approve'\)/);
    expect(gated).toMatch(/can\(s, 'finance', 'approve'\)/);
  });
  it('refs: top-ups share one ref; proforma = the Invoices drawer ref', () => {
    expect(TOPUP_REF).toBe('wallet_topup');
    expect(PROFORMA_REF).toBe('document');
    expect(read('app/ods/office/accounts/invoices/actions.ts')).toMatch(/refType = target === 'order' \? 'order' : 'document'/);
  });
  it('database two-person actions are called directly (not wrapped)', () => {
    expect(read('app/ods/admin/finance/holds/page.tsx')).toMatch(/financeActOnHoldAction, decideHoldApprovalAction/);
    expect(read('app/ods/admin/finance/credit/page.tsx')).toMatch(/proposeCreditTermsAction, decideCreditTermsAction, generateDropshipStatementAction/);
    expect(read('app/ods/admin/finance/saas/page.tsx')).toMatch(/decideSwitchAction/);
    expect(read('app/ods/admin/finance/transfers/page.tsx')).toMatch(/reject: rejectTransfer/);
    expect(read('app/ods/admin/wallet/page.tsx')).toMatch(/setWallet: setSetting, saveCreditDefault, saveCustomerCredit, saveSettings, confirmTopup: confirmTopupGated/);
  });
});

describe('ODS T9 accounts B · pages replace the T8 re-exports with today’s guards', () => {
  const cases: [string, RegExp][] = [
    ['app/ods/admin/finance/holds/page.tsx', /requireStaff\('finance', 'view', '\/admin\/finance\/holds'\)/],
    ['app/ods/admin/finance/credit/page.tsx', /requireStaff\('finance', 'view', '\/admin\/finance\/credit'\)/],
    ['app/ods/admin/finance/transfers/page.tsx', /requireStaff\('wallet', 'approve', '\/admin\/finance\/transfers'\)/],
    ['app/ods/admin/finance/saas/page.tsx', /requireStaff\('finance', 'view', '\/admin\/finance\/saas'\)/],
    ['app/ods/admin/wallet/page.tsx', /requireStaff\('wallet', 'view', '\/admin\/wallet'\)/],
  ];
  it.each(cases)('%s', (file, guard) => {
    const src = read(file);
    expect(src.startsWith('// ODS T9')).toBe(true);
    expect(src).toMatch(guard);
  });
  it('credit page keeps today’s service-role reads; saas keeps the Dropship v2 redirect', () => {
    expect(read('app/ods/admin/finance/credit/page.tsx')).toMatch(/const sb = createAdminClient\(\)/);
    expect(read('app/ods/admin/finance/saas/page.tsx')).toMatch(/if \(!v2On\) redirect\('\/admin\/finance'\)/);
    expect(read('app/ods/admin/finance/transfers/page.tsx')).toMatch(/createSignedUrl\(t\.slip_path as string, 600\)/);
  });
});

describe('ODS T9 accounts B · SaaS + wallets', () => {
  it('saas decision rules = today', () => {
    expect(saasDecision(false, false, 'note').approve).toMatch(/company-wide Finance/);
    expect(saasDecision(true, true, 'note').approve).toMatch(/second person/);
    expect(saasDecision(true, false, 'ok')).toEqual({ approve: null, reject: 'Write a note first.' });
    expect(saasDecision(true, false, 'long enough')).toEqual({ approve: null, reject: null });
    const f = (d: string | null) => d ?? '—';
    expect(saasStatusLine({ enabled: true, enabled_at: 'X', scheduled_start: null, approved_at: null }, f)).toBe('On since X');
    expect(saasStatusLine({ enabled: false, enabled_at: null, scheduled_start: 'D', approved_at: null }, f)).toBe('Off · starts on D');
    expect(saasStatusLine({ enabled: false, enabled_at: null, scheduled_start: null, approved_at: null }, f)).toBe('Off since launch');
    expect(overrideText({ override: 'extra_trial', extra_trial_days: 30 })).toBe('Trial +30 days');
  });
  it('wallet permissions = today’s checks', () => {
    expect(walletPerms(perm(['wallet:view']))).toEqual({ isAdmin: false, canApproveTopups: false, canSeeRevenue: false });
    expect(walletPerms(perm(['wallet:view', 'wallet:approve', 'dashboard:view']))).toEqual({ isAdmin: false, canApproveTopups: true, canSeeRevenue: true });
    expect(walletPerms(perm([], true)).isAdmin).toBe(true);
    expect(PLATFORM_SETTINGS.map((p) => p.key)).toEqual(['finance_approval_limit_cents', 'deposit_pct', 'quote_validity_days', 'claim_visible_days', 'claim_hidden_days']);
  });
  it('credit source and price list = today', () => {
    expect(creditSource({ override_minor: null, override_currency: null, currency: 'USD', note: null, kyc_status: 'submitted' }, true)).toBe('Default · not verified → no credit');
    expect(creditSource({ override_minor: 250000, override_currency: 'CNY', currency: 'USD', note: 'x', kyc_status: 'verified' }, true)).toBe(`Own limit ${fmtMinor(250000, 'CNY')} (other currency — not applied) · x`);
    const { current, scheduled } = splitPrices(
      [
        { service_code: 'a', amount_minor: 300, currency: 'USD', effective_from: '2027-01-01' },
        { service_code: 'a', amount_minor: 200, currency: 'USD', effective_from: '2026-11-01' },
        { service_code: 'a', amount_minor: 100, currency: 'USD', effective_from: '2026-01-01' },
      ],
      '2026-11-27',
    );
    expect(current.get('a|USD')).toBe(200);
    expect(scheduled.get('a|USD')).toEqual({ amount: 300, from: '2027-01-01' });
    expect(priceFor('a', 'CNY', current, (u) => u * 7)).toEqual({ amount: 1400, converted: true });
    expect(priceFor('a', 'USD', current, (u) => u)).toEqual({ amount: 200, converted: false });
    expect(priceFor('b', 'USD', current, (u) => u)).toBeNull();
  });
  it('totals never add currencies together', () => {
    const t = totalsByCurrency([{ c: 'CNY', m: 5 }, { c: 'USD', m: 1 }, { c: 'USD', m: 2 }], (r) => r.m, (r) => r.c);
    expect(t).toEqual([['USD', 3], ['CNY', 5]]);
    expect(totalsText(t)).toBe('US$ 0.03 + CN¥ 0.05');
  });
});
