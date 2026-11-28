/**
 * SAMPLE data for the staging-only Admin batch C fixtures (/dev/ui/screens/office-staff, office-divisions,
 * office-company, office-settings-payment, office-backups). Labelled sample; never used by real pages.
 */
import type { CompanyData, DivisionCard, StaffData, StaffMember } from '@/app/ods/office/_lib/admin-c-data';
import { staffActions, staffStatus, type StaffSec } from '@/app/ods/office/_lib/admin-c-core';
import type { ActionResult } from '@/app/ods/office/_components/accounts-a-actions';
import type { PaymentOptionMatrixRow, PaymentProviderSettingRow } from '@/lib/payments';
import type { BackupRow, BackupSettings, ExportRow, RestoreRow } from '@/components/admin/backups/shared';
import { SAMPLE_NOW } from '../office-dashboard/sample-data';

const iso = (hoursAgo: number) => new Date(SAMPLE_NOW - hoursAgo * 3_600_000).toISOString();
const ROLES = [
  { code: 'admin', name: 'Admin', description: 'Full access' },
  { code: 'finance', name: 'Finance', description: 'Money, approvals, reports' },
  { code: 'account_manager', name: 'Account manager', description: 'Own customers, quotes' },
  { code: 'operations', name: 'Operations', description: 'Orders, shipping, warehouse' },
  { code: 'distributor', name: 'Distributor', description: 'Assigned suppliers only' },
];
const roleName = (c: string) => ROLES.find((r) => r.code === c)?.name ?? c;

function member(id: string, name: string, email: string, roles: string[], o: { active?: boolean; sec?: Partial<StaffSec> | null; office?: string; self?: boolean; divisions?: StaffMember['divisions'] } = {}, perms = { edit: true, create: true, admin: true }): StaffMember {
  const sec: StaffSec | null = o.sec === null ? null : { user_id: id, email, last_sign_in_at: iso(3), totp_factors: 1, active_sessions: 1, banned_until: null, invited_at: null, email_confirmed: true, locked_until: null, ...(o.sec ?? {}) };
  const st = staffStatus(o.active ?? true, sec, SAMPLE_NOW);
  return {
    id, name, email, office: o.office ?? 'Shenzhen office', roles, roleNames: roles.map(roleName), active: o.active ?? true, self: !!o.self,
    status: st.key, statusLabel: st.label, statusTone: st.tone, lockedUntil: sec?.locked_until ?? null, invitedAt: sec?.email_confirmed === false ? iso(30) : null,
    twoFa: sec ? sec.totp_factors > 0 : null, lastSignIn: sec?.last_sign_in_at ?? null, sessions: sec ? sec.active_sessions : null, secEmail: sec?.email ?? null,
    actions: staffActions({ canEdit: perms.edit, canCreate: perms.create, isAdmin: perms.admin, self: !!o.self, targetIsAdmin: roles.includes('admin'), status: st.key, twoFa: (sec?.totp_factors ?? 0) > 0, sessions: sec?.active_sessions ?? 0, hasSec: !!sec }),
    divisions: o.divisions ?? [], companyWide: roles.some((r) => ['admin', 'finance', 'support'].includes(r)),
  };
}

export function sampleStaff(opts: { readOnly?: boolean; empty?: boolean } = {}): StaffData {
  const pm = opts.readOnly ? { edit: false, create: false, admin: false } : { edit: true, create: true, admin: true };
  const team = opts.empty ? [] : [
    member('u1', 'Ashif Abdul', 'ashif@example.com', ['admin'], { self: true }, pm),
    member('u2', 'Priya Shah', 'priya@example.com', ['finance'], { sec: { active_sessions: 2 } }, pm),
    member('u3', 'Omar Khalid', 'omar@example.com', ['account_manager'], { divisions: [{ code: 'SRC', name: 'Sourcing', role: 'manager' }] }, pm),
    member('u4', 'Li Wei', 'li@example.com', ['operations'], { sec: { locked_until: iso(-1), active_sessions: 0 }, divisions: [{ code: '3PL', name: '3PL & Shipping', role: 'staff' }] }, pm),
    member('u5', 'Sara Lind', 'sara@example.com', ['account_manager'], { sec: { email_confirmed: false, totp_factors: 0, active_sessions: 0, last_sign_in_at: null } }, pm),
    member('u6', 'Ravi Menon', 'ravi@example.com', ['distributor'], { active: false, sec: { active_sessions: 0, last_sign_in_at: iso(900) } }, pm),
  ];
  return {
    team,
    roles: ROLES.map((r) => ({ ...r, members: team.filter((t) => t.roles.includes(r.code)).length })),
    selectedRole: 'finance',
    matrix: {
      areas: [
        { code: 'dashboard', name: 'Dashboard' }, { code: 'customers', name: 'Customers' }, { code: 'orders', name: 'Orders' }, { code: 'finance', name: 'Finance' },
        { code: 'wallet', name: 'Wallets' }, { code: 'staff', name: 'Staff & roles' },
      ],
      special: [{ code: 'backups', name: 'Backups & restore', actions: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] }],
      have: ['dashboard:view', 'customers:view', 'orders:view', 'finance:view', 'finance:approve', 'finance:export', 'wallet:view', 'wallet:approve', 'backups:view'],
    },
    divisions: [{ code: 'SRC', name: 'Sourcing', active: true }, { code: 'DS', name: 'Dropship', active: true }, { code: '3PL', name: '3PL & Shipping', active: true }, { code: 'MMB', name: 'Make My Brand', active: false }],
    offices: ['Dubai office', 'Shenzhen office'],
    distributors: [{ id: 'u6', name: 'Ravi Menon' }],
    suppliers: [{ id: 's1', label: 'SUP-0012 · Sample Supplier Co.' }],
    assignments: opts.empty ? [] : [{ distributorId: 'u6', distributor: 'Ravi Menon', supplierId: 's1', supplier: 'SUP-0012 · Sample Supplier Co.' }],
    secError: null,
    security: {
      enforce_aal2: true, lockout_attempts: 5, lockout_minutes: 15, idle_minutes: 30, max_session_hours: 12, step_up_minutes: 10, trust_hours: 12,
      ip_allowlist: [], ip_rule_roles: ['admin', 'finance'], ip_rule_enabled: false, google_domain: 'octopusb2b.com',
    },
    events: opts.empty ? [] : [
      { id: 1, at: iso(1), actor: 'Priya Shah', subject: null, entity: null, label: 'Signed in', tone: 'success', ip: '203.0.113.10', device: 'Chrome · macOS', deviceRaw: null },
      { id: 2, at: iso(5), actor: null, subject: null, entity: 'li@example.com', label: 'Account locked', tone: 'danger', ip: '198.51.100.7', device: 'Safari · iOS', deviceRaw: null },
      { id: 3, at: iso(26), actor: 'Ashif Abdul', subject: 'Ravi Menon', entity: null, label: 'Sessions ended', tone: 'warning', ip: '203.0.113.2', device: 'Chrome · Windows', deviceRaw: null },
    ],
    perms: { canEdit: !opts.readOnly, canCreate: !opts.readOnly, isAdmin: !opts.readOnly, canSuppliersView: true, canSuppliersEdit: !opts.readOnly },
  };
}

const ok = (message: string) => async (): Promise<ActionResult> => {
  await new Promise((r) => setTimeout(r, 150));
  return { ok: true, message };
};
export const SAMPLE_STAFF_ACTIONS = {
  inviteStaff: ok('Invitation sent'), createStaffWithoutEmail: ok('Account created'), setUserRoles: ok('Roles updated'), savePermissions: ok('Permissions saved'),
  addToDivisions: ok('Added to divisions'), assignSupplier: ok('Assigned'), saveStaffSecurity: ok('Security settings saved'),
  resendInvite: ok('Invitation sent again'), resetTwoFactor: ok('2FA reset'), endSessions: ok('Sessions ended'), unlockAccount: ok('Account unlocked'),
  setStaffActive: ok('Saved'), unassignSupplier: ok('Removed'), removeFromDivision: ok('Removed from division'),
};
export const sampleFormOk = ok('Saved');

export const SAMPLE_DIVISIONS: DivisionCard[] = [
  { code: 'SRC', name: 'Sourcing', sortOrder: 1, logoKey: 'octopus-b2b', active: true, people: 4 },
  { code: 'DS', name: 'Dropship', sortOrder: 2, logoKey: 'octopus-dropship', active: true, people: 2 },
  { code: '3PL', name: '3PL & Shipping', sortOrder: 3, logoKey: 'octopus-b2b', active: true, people: 1 },
  { code: 'MMB', name: 'Make My Brand', sortOrder: 4, logoKey: 'octopus-b2b', active: false, people: 0 },
];

export function sampleCompany(opts: { empty?: boolean } = {}): CompanyData {
  return {
    values: {
      legal_name: 'Shenzhen Octopus Trading Co., Ltd.', legal_name_cn: opts.empty ? '' : '深圳八爪鱼贸易有限公司', registration_no: opts.empty ? '' : '91440300MA5SAMPLE', tax_id: '',
      address: 'Sample Road 1, Futian District, Shenzhen, China', address_cn: '', registered_in: 'Shenzhen, Guangdong, China',
    },
    updatedAt: iso(48), brand: 'Octopus B2B',
    banks: opts.empty ? [] : [
      { id: 'b1', currency: 'USD', bank: 'Sample Bank (Hong Kong)', holder: 'Shenzhen Octopus Trading Co., Ltd.', account: '•••• 4021', swift: 'SAMPHKHH', active: true },
      { id: 'b2', currency: 'CNY', bank: 'Sample Bank (Shenzhen)', holder: 'Shenzhen Octopus Trading Co., Ltd.', account: '•••• 7788', swift: null, active: false },
    ],
    divisions: SAMPLE_DIVISIONS.map((d) => ({ code: d.code, name: d.name, active: d.active })),
    rule: 'on_full_payment',
    history: opts.empty ? [] : [{ id: 1, at: iso(48), who: 'Ashif Abdul', what: 'Registration no., Registered address' }, { id: 2, at: iso(400), who: 'System', what: '' }],
  };
}

export const SAMPLE_MATRIX: PaymentOptionMatrixRow[] = (['sourcing', 'brand', 'pools', 'dropship'] as const).flatMap((service) =>
  (['pay_now', 'payment_protection', 'pay_later'] as const).map((option) => ({
    service, option, enabled: option !== 'pay_later' || service === 'sourcing', min_amount_cents: 0, max_amount_cents: null,
    release_rule: option === 'payment_protection' ? 'delivery_plus_days' : null, auto_release_days: option === 'payment_protection' ? 14 : null, pay_later_invoice_trigger: option === 'pay_later' ? 'shipment' : null,
  })) as unknown as PaymentOptionMatrixRow[],
);
export const SAMPLE_PROVIDERS: PaymentProviderSettingRow[] = [
  { provider: 'stripe', display_name: 'Stripe', enabled: true, methods: ['card'], priority: 1, legal_entity_id: 'le1', fee_mode: 'absorb', fee_bp: 290, fee_fixed_cents: 30 },
  { provider: 'mock', display_name: 'Mock (staging)', enabled: true, methods: ['card'], priority: 9, legal_entity_id: 'le1', fee_mode: 'absorb', fee_bp: 0, fee_fixed_cents: 0 },
] as unknown as PaymentProviderSettingRow[];
export const SAMPLE_ENTITIES = [
  { id: 'le1', code: 'SZ', legal_name: 'Shenzhen Octopus Trading Co., Ltd.', registration_no: '91440300MA5SAMPLE', tax_id: null, address: 'Sample Road 1, Shenzhen', registered_in: 'CN', default_currency: 'USD', active_from: '2026-01-01', is_default: true, status: 'active' },
];

/* ───────── backups ───────── */

const bk = (n: number, status: string, trigger: string, hoursAgo: number, size: number | null): BackupRow => ({
  id: `bk${n}`, code: `BK-2026-11${String(27 - Math.floor(hoursAgo / 24)).padStart(2, '0')}-${n}`, kind: 'full', trigger, retention_class: 'daily', status, progress: status === 'completed' ? 100 : 0,
  includes: { database: true, buckets: ['documents', 'product-images'] }, size_bytes: size, checksum_ok: status === 'completed' ? true : null, manifest: null, note: null,
  error: status === 'failed' ? 'Upload to off-site storage timed out' : null, created_at: iso(hoursAgo), started_at: iso(hoursAgo), finished_at: status === 'completed' ? iso(hoursAgo - 0.4) : null, created_by: trigger === 'manual' ? 'u1' : null,
});
export const SAMPLE_BACKUPS: BackupRow[] = [bk(1, 'completed', 'scheduled', 20, 2_480_000_000), bk(2, 'completed', 'manual', 30, 2_470_000_000), bk(3, 'failed', 'scheduled', 44, null), bk(4, 'completed', 'scheduled', 68, 2_455_000_000)];
export const SAMPLE_RESTORES: RestoreRow[] = [{
  id: 'rs1', code: 'RS-0007', backup_id: 'bk1', restore_type: 'full_staging', target: 'staging', modules: [], records: {}, reason: 'Monthly check of the restore path', touches_money: false,
  status: 'pending_approval', requested_by: 'u2', approved_by: null, approved_at: null, started_at: null, finished_at: null, report: null, error: null, created_at: iso(2),
}];
export const SAMPLE_EXPORTS: ExportRow[] = [{ id: 'ex1', code: 'EX-0012', title: 'October accounting export', modules: ['ledger', 'payments'], format: 'xlsx', status: 'completed', size_bytes: 1_240_000, date_from: '2026-10-01', date_to: '2026-10-31', created_at: iso(200), error: null }];
export const SAMPLE_BACKUP_SETTINGS: BackupSettings = { schedule: '0 18 * * *', schedule_label: 'Every night at 02:00 China time', timezone: 'Asia/Shanghai', keep_daily: 14, keep_weekly: 8, keep_monthly: 12, keep_exports_months: 24, monthly_drill: true, alert_missing_hours: 26, require_mfa: true, offsite: { provider: 'r2', bucket: 'octopus-backups' } };
export const SAMPLE_NAMES: Record<string, string> = { u1: 'Ashif Abdul', u2: 'Priya Shah' };
