/** Staging fixtures (T9 batch 3 · Accounts part B): SAMPLE data only, for design review. Never used by the live pages. */
import type { HoldApproval, HoldRow } from '@/app/ods/admin/finance/holds/_components/holds-screen';
import type { CreditRow, OrgOption, StatementRow } from '@/app/ods/admin/finance/credit/_components/credit-screen';
import type { DecidedTransfer, PendingTransfer } from '@/app/ods/admin/finance/transfers/_components/transfers-screen';
import type { WalletData } from '@/app/ods/admin/wallet/_components/wallet-screen';
import type { SaasPageData } from '@/lib/dropship-ds12';

export const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
export const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
export const SAMPLE_LIMIT = 250_000;
const id = (n: number) => `5a5a5a5a-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const HOLDS: HoldRow[] = [
  { id: id(1), org_id: id(101), org_name: 'Anna Home Trading', division_code: 'SRC', service: 'sourcing', target_type: 'order', target_id: id(201), order_code: 'OCT-SRC-2026-0207', funding_method: 'bank_transfer', amount_cents: 552_000, released_cents: 0, refunded_cents: 0, currency: 'USD', release_rule: 'milestone', milestone_label: 'Production start confirmed', status: 'held', dispute_reason: null, invoice_number: null, created_at: '2026-11-21T09:30:00Z' },
  { id: id(2), org_id: id(102), org_name: 'Nour Beauty FZE', division_code: 'MMB', service: 'brand', target_type: 'order', target_id: id(202), order_code: 'OCT-BR-2026-0044', funding_method: 'wallet', amount_cents: 1_476_000, released_cents: 738_000, refunded_cents: 0, currency: 'USD', release_rule: 'milestone', milestone_label: 'QC passed', status: 'partially_released', dispute_reason: null, invoice_number: 'OCT-2026-0391', created_at: '2026-11-12T10:00:00Z' },
  { id: id(3), org_id: id(103), org_name: 'Mobile Hub Trading', division_code: 'SRC', service: 'sourcing', target_type: 'order', target_id: id(203), order_code: 'OCT-SRC-2026-0139', funding_method: 'bank_transfer', amount_cents: 336_000, released_cents: 0, refunded_cents: 0, currency: 'USD', release_rule: 'milestone', milestone_label: 'Delivered, no claim in 7 days', status: 'disputed', dispute_reason: 'Wrong colour on 300 cases', invoice_number: null, created_at: '2026-11-05T13:45:00Z' },
  { id: id(4), org_id: id(104), org_name: 'Cafe Republic', division_code: 'PL', service: 'pools', target_type: 'order', target_id: id(204), order_code: 'OCT-POOL-2026-0019', funding_method: 'wallet', amount_cents: 207_000, released_cents: 207_000, refunded_cents: 0, currency: 'USD', release_rule: 'pool_filled', milestone_label: 'Pool filled', status: 'released', dispute_reason: null, invoice_number: 'OCT-2026-0377', created_at: '2026-10-30T08:00:00Z' },
  { id: id(5), org_id: id(105), org_name: 'Saffron Kitchens', division_code: 'TK', service: 'turnkey', target_type: 'project', target_id: id(205), order_code: null, funding_method: 'bank_transfer', amount_cents: 980_000, released_cents: 0, refunded_cents: 980_000, currency: 'CNY', release_rule: 'milestone', milestone_label: 'Design sign-off', status: 'refunded', dispute_reason: null, invoice_number: null, created_at: '2026-10-21T08:00:00Z' },
];
export const HOLD_APPROVALS: HoldApproval[] = [
  { id: id(11), hold_id: id(2), action: 'release', amount_cents: 738_000, refund_destination: null, reason: 'Final QC passed, photos on file', status: 'pending', proposed_by: OTHER, created_at: '2026-11-26T09:00:00Z' },
];
export const HOLD_APPROVALS_SELF: HoldApproval[] = [
  { id: id(12), hold_id: id(1), action: 'release', amount_cents: 552_000, refund_destination: null, reason: 'Production started (supplier photos)', status: 'pending', proposed_by: ME, created_at: '2026-11-27T08:00:00Z' },
];

export const CREDIT: CreditRow[] = [
  { id: id(21), org_id: id(101), org_name: 'Anna Home Trading', kyc_status: 'verified', division_id: null, division_code: 'ALL', credit_limit_cents: 2_500_000, currency: 'USD', net_days: 30, status: 'active', overdue_blocked: false, proposed_by: OTHER, approved_by: ME, note: 'Two years of on-time payments', unpaid_invoices_cents: 640_000, reserved_cents: 120_000, updated_at: '2026-11-10T10:00:00Z' },
  { id: id(22), org_id: id(106), org_name: 'Gulf Living LLC', kyc_status: 'verified', division_id: id(301), division_code: 'SRC', credit_limit_cents: 1_000_000, currency: 'USD', net_days: 45, status: 'pending_approval', overdue_blocked: false, proposed_by: OTHER, approved_by: null, note: 'Requested by account manager', unpaid_invoices_cents: 0, reserved_cents: 0, updated_at: '2026-11-26T15:00:00Z' },
  { id: id(23), org_id: id(107), org_name: 'Desert Office Supply', kyc_status: 'verified', division_id: null, division_code: 'ALL', credit_limit_cents: 500_000, currency: 'USD', net_days: 15, status: 'pending_approval', overdue_blocked: false, proposed_by: ME, approved_by: null, note: null, unpaid_invoices_cents: 0, reserved_cents: 0, updated_at: '2026-11-27T07:00:00Z' },
  { id: id(24), org_id: id(108), org_name: 'Paws & Co', kyc_status: 'verified', division_id: id(302), division_code: 'DS', credit_limit_cents: 300_000, currency: 'USD', net_days: 7, status: 'active', overdue_blocked: true, proposed_by: OTHER, approved_by: ME, note: null, unpaid_invoices_cents: 310_000, reserved_cents: 0, updated_at: '2026-11-20T10:00:00Z' },
];
export const ORGS: OrgOption[] = [
  { id: id(101), name: 'Anna Home Trading', kyc_status: 'verified', credit_eligible: false },
  { id: id(106), name: 'Gulf Living LLC', kyc_status: 'verified', credit_eligible: false },
  { id: id(108), name: 'Paws & Co', kyc_status: 'verified', credit_eligible: true },
];
export const DIVISIONS = [{ id: id(301), code: 'SRC', name: 'Sourcing' }, { id: id(302), code: 'DS', name: 'Dropshipping' }];
export const STATEMENTS: StatementRow[] = [
  { id: id(31), number: 'STMT-DS-2026-W47-0008', org_name: 'Paws & Co', legal_entity_code: 'SZ-OCTOPUS', legal_entity_name: 'Shenzhen Octopus Trading Co., Ltd.', invoice_count: 14, sample_count: 2, amount_cents: 186_400, paid_cents: 0, currency: 'USD', status: 'issued', created_at: '2026-11-24T02:00:00Z' },
];

export const PENDING_TRANSFERS: PendingTransfer[] = [
  { id: id(41), org_name: 'Anna Home Trading', amount_cents: 552_000, reference: 'TT-OCT-2026-0142', bank_ref: 'FT2611AE0091', slip_url: '#slip', created_at: '2026-11-26T11:00:00Z' },
  { id: id(42), org_name: 'Gulf Living LLC', amount_cents: 120_000, reference: 'TT-OCT-2026-0143', bank_ref: null, slip_url: null, created_at: '2026-11-27T06:20:00Z' },
];
export const DECIDED_TRANSFERS: DecidedTransfer[] = [
  { id: id(43), org_name: 'Cafe Republic', amount_cents: 207_000, amount_received_cents: 206_500, reference: 'TT-OCT-2026-0139', bank_ref: 'HK26110043', status: 'credited', reject_reason: null, received_reason: 'bank_charges', received_reason_text: null, received_note: 'SCB fee', confirmed_at: '2026-11-25T09:00:00Z' },
  { id: id(44), org_name: 'FitLife Stores', amount_cents: 80_000, amount_received_cents: null, reference: 'TT-OCT-2026-0137', bank_ref: null, status: 'failed', reject_reason: 'Not on the statement after 5 working days', received_reason: null, received_reason_text: null, received_note: null, confirmed_at: '2026-11-24T09:00:00Z' },
];

export function sampleSaas(state: string): SaasPageData {
  const pendingMine = state === 'second-approver';
  return {
    can_decide: true,
    me: ME,
    settings: {
      enabled: false, enabled_at: null, scheduled_start: null, trial_days: 30, grace_days: 7, trial_start_mode: 'on_switch', one_trial_per_org: true,
      pending_enabled: pendingMine ? true : null, pending_scheduled_start: pendingMine ? '2027-01-01T00:00:00Z' : null, proposal_reason: pendingMine ? 'Owner decision: start fees in January' : null,
      proposed_by: pendingMine ? ME : null, proposed_by_name: pendingMine ? 'Priya Shah' : null, proposed_at: pendingMine ? '2026-11-27T08:00:00Z' : null, approved_by_name: null, approved_at: null, updated_at: '2026-11-27T08:00:00Z',
    },
    counts: { merchants: 42, free_off: 39, trial: 0, paying: 0, grace: 0, paused: 0, free_forever: 3 },
    merchants: [
      { org_id: id(108), name: 'Paws & Co', credit_eligible: true, plan_name: 'Growth', status: 'free_forever', override: 'free_forever', extra_trial_days: null, reason: 'Octopus group test store', set_by_name: 'Ashif Abdul', set_at: '2026-11-01T10:00:00Z' },
      { org_id: id(109), name: 'Bloom Candles', credit_eligible: false, plan_name: 'Starter', status: 'free', override: null, extra_trial_days: null, reason: null, set_by_name: null, set_at: null },
      { org_id: id(110), name: 'Urban Threads', credit_eligible: false, plan_name: 'Growth', status: 'free', override: 'extra_trial', extra_trial_days: 30, reason: 'Migration from another app', set_by_name: 'Priya Shah', set_at: '2026-11-15T10:00:00Z' },
    ],
    plans: [
      { code: 'starter', name: 'Starter', description: null, price_cents: null, live_products_limit: 100, stores_limit: 1, orders_month_limit: 300, features: ['import_push', 'order_sync'], sort_order: 10, active: false },
      { code: 'growth', name: 'Growth', description: null, price_cents: null, live_products_limit: 1000, stores_limit: 3, orders_month_limit: null, features: ['import_push', 'order_sync', 'auto_sync'], sort_order: 20, active: false },
    ],
    plan_changes: state === 'plans' ? [{ id: id(51), plan_code: 'starter', proposal: { name: 'Starter', price_cents: 1900 }, reason: 'Owner confirmed US$ 19', proposed_by: OTHER, proposed_by_name: 'Omar Khalid', proposed_at: '2026-11-26T10:00:00Z' }] : [],
    history: [
      { action: 'saas_billing.override_set', created_at: '2026-11-15T10:00:00Z', details: { reason: 'Migration from another app' }, actor_name: 'Priya Shah' },
      { action: 'saas_billing.override_set', created_at: '2026-11-01T10:00:00Z', details: { reason: 'Octopus group test store' }, actor_name: 'Ashif Abdul' },
    ],
  };
}

export const WALLET: WalletData = {
  walletOn: true,
  wallets: [
    { org_id: id(101), org_name: 'Anna Home Trading', country: 'AE', kyc_status: 'verified', balance_cents: 1_250_000, last_activity: '2026-11-26T10:00:00Z', currency: 'USD' },
    { org_id: id(104), org_name: 'Cafe Republic', country: 'KW', kyc_status: 'verified', balance_cents: 206_500, last_activity: '2026-11-25T09:00:00Z', currency: 'USD' },
    { org_id: id(108), org_name: 'Paws & Co', country: 'AE', kyc_status: 'verified', balance_cents: -45_000, last_activity: '2026-11-27T05:00:00Z', currency: 'USD' },
    { org_id: id(111), org_name: 'Shenzhen Demo Buyer', country: 'CN', kyc_status: 'submitted', balance_cents: 880_000, last_activity: '2026-11-20T05:00:00Z', currency: 'CNY' },
  ],
  walletTotals: [['USD', 1_411_500], ['CNY', 880_000]],
  convertedTotal: { minor: 1_533_700, currency: 'USD', rateLabel: '7.20 CNY per US$ (approved 1 Nov)' },
  topups: [
    { id: id(61), org_name: 'Gulf Living LLC', country: 'AE', amount_cents: 300_000, currency: 'USD', method: 'bank_transfer', reference: 'TT-OCT-2026-0144', status: 'pending', created_at: '2026-11-27T07:00:00Z' },
    { id: id(62), org_name: 'Cafe Republic', country: 'KW', amount_cents: 206_500, currency: 'USD', method: 'bank_transfer', reference: 'TT-OCT-2026-0139', status: 'credited', created_at: '2026-11-25T09:00:00Z' },
    { id: id(63), org_name: 'Bloom Candles', country: 'AE', amount_cents: 50_000, currency: 'USD', method: 'card', reference: null, status: 'pending', created_at: '2026-11-27T08:00:00Z' },
  ],
  topupsThisMonth: { totals: [['USD', 1_706_500]], count: 9 },
  spent: [['USD', 84_200]],
  credit: [
    { org_id: id(101), org_name: 'Anna Home Trading', country: 'AE', kyc_status: 'verified', currency: 'USD', balance_minor: 1_250_000, credit_limit_minor: 100_000, available_minor: 1_350_000, override_minor: null, override_currency: null, note: null },
    { org_id: id(108), org_name: 'Paws & Co', country: 'AE', kyc_status: 'verified', currency: 'USD', balance_minor: -45_000, credit_limit_minor: 250_000, available_minor: 205_000, override_minor: 250_000, override_currency: 'USD', note: 'Group company' },
    { org_id: id(111), org_name: 'Shenzhen Demo Buyer', country: 'CN', kyc_status: 'submitted', currency: 'USD', balance_minor: 0, credit_limit_minor: 0, available_minor: 0, override_minor: null, override_currency: null, note: null },
  ],
  creditDefault: { amount_minor: 100_000, currency: 'USD', verified_only: true },
  creditUsedMinor: 45_000,
  prices: [
    { code: 'rfq_fee', name: 'Sourcing request fee', unit: 'per request', active: true, price: { amount: 2_500, converted: false }, scheduled: { amount: 2_900, from: '2027-01-01T00:00:00Z' } },
    { code: 'qc_visit', name: 'QC inspection visit', unit: 'per visit', active: true, price: { amount: 18_000, converted: false }, scheduled: null },
    { code: 'photo_pack', name: 'Product photo pack', unit: 'per product', active: false, price: null, scheduled: null },
  ],
  settings: { finance_approval_limit_cents: '100000', deposit_pct: '30', quote_validity_days: '14', claim_visible_days: '7', claim_hidden_days: '90' },
  platformCurrency: 'USD',
  currencies: ['USD', 'CNY'],
};
