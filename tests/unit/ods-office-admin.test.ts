import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AREA_ACTIONS, MATRIX_ACTIONS, backupSummary, bytesText, companyChanges, deviceLabel, maskAccount, paymentSettingsAccess, securityEvent, staffActions, staffStatus, type StaffSec,
} from '../../app/ods/office/_lib/admin-c-core';
import { buildOfficeNav, currentNavId, type OfficePerms } from '../../app/ods/office/_lib/nav';

const NOW = Date.UTC(2026, 10, 27, 18, 45);
const sec = (p: Partial<StaffSec> = {}): StaffSec => ({
  user_id: 'u', email: 'u@example.com', last_sign_in_at: null, totp_factors: 1, active_sessions: 1, banned_until: null, invited_at: null, email_confirmed: true, locked_until: null, ...p,
});

describe('ODS T9 admin · staff rules (same as today’s page)', () => {
  it('status order: deactivated → locked → invited → active', () => {
    expect(staffStatus(false, sec(), NOW).key).toBe('deactivated');
    expect(staffStatus(true, sec({ banned_until: new Date(NOW + 1000).toISOString() }), NOW).key).toBe('deactivated');
    expect(staffStatus(true, sec({ banned_until: new Date(NOW - 1000).toISOString() }), NOW).key).toBe('active');
    expect(staffStatus(true, sec({ locked_until: '2026-11-28T00:00:00Z', email_confirmed: false }), NOW).key).toBe('locked');
    expect(staffStatus(true, sec({ email_confirmed: false }), NOW).key).toBe('invited');
    expect(staffStatus(true, null, NOW).key).toBe('active');
    // inactive people use a neutral (token) tone — never opacity
    expect(staffStatus(false, sec(), NOW).tone).toBe('neutral');
  });
  it('row actions follow today’s conditions', () => {
    const base = { canEdit: true, canCreate: true, isAdmin: false, self: false, targetIsAdmin: false, status: 'active' as const, twoFa: true, sessions: 2, hasSec: true };
    expect(staffActions(base)).toEqual({ resendInvite: false, unlock: false, reset2fa: false, endSessions: true, toggleActive: true });
    expect(staffActions({ ...base, isAdmin: true }).reset2fa).toBe(true);
    expect(staffActions({ ...base, isAdmin: true, self: true })).toMatchObject({ reset2fa: false, endSessions: false, toggleActive: false });
    expect(staffActions({ ...base, targetIsAdmin: true }).toggleActive).toBe(false); // only an admin can deactivate an admin
    expect(staffActions({ ...base, targetIsAdmin: true, isAdmin: true }).toggleActive).toBe(true);
    expect(staffActions({ ...base, status: 'invited' }).resendInvite).toBe(true);
    expect(staffActions({ ...base, status: 'invited', canCreate: false }).resendInvite).toBe(false);
    expect(staffActions({ ...base, status: 'locked' }).unlock).toBe(true);
    expect(staffActions({ ...base, status: 'locked', hasSec: false }).unlock).toBe(false);
    expect(staffActions({ ...base, isAdmin: true, status: 'deactivated' }).reset2fa).toBe(false);
    expect(staffActions({ ...base, canEdit: false, canCreate: false })).toEqual({ resendInvite: false, unlock: false, reset2fa: false, endSessions: false, toggleActive: false });
  });
  it('security events, devices, permission matrix shape', () => {
    expect(securityEvent('auth.lockout')).toEqual({ label: 'Account locked', tone: 'danger' });
    expect(securityEvent('auth.totp_failed')).toEqual({ label: 'Wrong 2FA code', tone: 'warning' });
    expect(securityEvent('auth.something_failed')).toEqual({ label: 'something failed', tone: 'warning' });
    expect(securityEvent('auth.other').tone).toBe('neutral');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Chrome/120 Safari/537')).toBe('Chrome · macOS');
    expect(deviceLabel('curl/8.0')).toBe('Script');
    expect(deviceLabel(null)).toBe('—');
    expect(MATRIX_ACTIONS).toEqual(['view', 'create', 'edit', 'delete', 'approve', 'export']);
    expect(AREA_ACTIONS.backups).toContain('approve_restore');
  });
});

describe('ODS T9 admin · company, payment, backups', () => {
  it('company change list and masked accounts', () => {
    expect(companyChanges({ old: { legal_name: 'A', tax_id: null }, new: { legal_name: 'B', tax_id: null } })).toEqual(['legal_name']);
    expect(companyChanges({})).toEqual([]);
    expect(maskAccount('123456789')).toBe('•••• 6789');
    expect(maskAccount(null)).toBe('—');
  });
  it('payment settings: company-wide Admin or Finance role; edit = admin or finance:edit', () => {
    expect(paymentSettingsAccess({ isAdmin: true, roles: [], canFinanceEdit: false })).toEqual({ allowed: true, canEdit: true });
    expect(paymentSettingsAccess({ isAdmin: false, roles: ['finance'], canFinanceEdit: false })).toEqual({ allowed: true, canEdit: false });
    expect(paymentSettingsAccess({ isAdmin: false, roles: ['finance'], canFinanceEdit: true })).toEqual({ allowed: true, canEdit: true });
    expect(paymentSettingsAccess({ isAdmin: false, roles: ['account_manager'], canFinanceEdit: true })).toEqual({ allowed: false, canEdit: false });
  });
  it('backup summary and sizes', () => {
    const s = backupSummary([
      { status: 'running', created_at: '2026-11-27T10:00:00Z' },
      { status: 'completed', created_at: '2026-11-26T18:00:00Z', finished_at: '2026-11-26T18:20:00Z', size_bytes: 2048 },
      { status: 'failed', created_at: '2026-11-25T18:00:00Z' },
      { status: 'completed', created_at: '2026-11-24T18:00:00Z' },
    ]);
    expect(s).toEqual({ lastAt: '2026-11-26T18:20:00Z', lastSize: 2048, completed: 2, failed: 1, running: true });
    expect(backupSummary([]).lastAt).toBeNull();
    expect(bytesText(2_480_000_000)).toBe('2.3 GB');
    expect(bytesText(512)).toBe('512 B');
    expect(bytesText(null)).toBe('—');
  });
});

describe('ODS T9 admin · nav + static', () => {
  const perms = (p: Partial<OfficePerms>): OfficePerms => ({
    isAdmin: false, roles: [], permissions: [], canOpenDropship: false, canSeeRates: false, canSeeFeesDuty: false, canEditDropship: false,
    canSeeSaas: false, warehouseMember: false, dropshipV2Ui: false, ...p,
  });
  it('Admin group items keep today’s rules; recovery stays under Backup and restore', () => {
    const admin = buildOfficeNav(perms({ permissions: ['staff:view', 'finance:view', 'backups:view'] })).groups.find((g) => g.id === 'admin')!;
    const vis = admin.items.filter((i) => !i.hidden).map((i) => i.id);
    expect(vis).toEqual(expect.arrayContaining(['staff', 'currency', 'backups']));
    expect(vis).not.toContain('company');
    expect(vis).not.toContain('divisions');
    expect(currentNavId('/admin/backups/recovery')).toBe('backups');
    expect(currentNavId('/admin/settings/payment')).toBe('payment-settings');
  });
  it('the ODS pages are marked ODS T9, keep today’s guards and call today’s actions; /admin/integrations untouched', () => {
    const root = join(__dirname, '../..');
    const src = (p: string) => readFileSync(join(root, p), 'utf8');
    const pages: [string, string, string | null][] = [
      ['app/ods/admin/staff/page.tsx', "requireStaff('staff', 'view', '/admin/staff')", "from '@/app/admin/staff/actions'"],
      ['app/ods/admin/divisions/page.tsx', "requireStaff('staff', 'view', '/admin/divisions')", "from '@/app/admin/divisions/actions'"],
      ['app/ods/admin/company/page.tsx', "requireStaff('staff', 'view', '/admin/company')", "from '@/app/admin/company/actions'"],
      ['app/ods/admin/settings/payment/page.tsx', "requireStaff('finance', 'view', '/admin/settings/payment')", "from '@/app/admin/settings/payment/matrix-client'"],
      ['app/ods/admin/settings/dropship/page.tsx', "requireStaff('staff', 'view', '/admin/settings/dropship')", "from '@/app/admin/settings/dropship/features-client'"],
      ['app/ods/admin/backups/page.tsx', "requireStaff('backups', 'view', '/admin/backups')", null],
      ['app/ods/admin/backups/recovery/page.tsx', "requireStaff('backups', 'view', '/admin/backups/recovery')", "from '@/components/admin/backups/recovery'"],
    ];
    for (const [f, guard, imp] of pages) {
      const s = src(f);
      expect(s.startsWith('// ODS T9'), f).toBe(true);
      expect(s, f).toContain(guard);
      if (imp) expect(s, f).toContain(imp);
    }
    for (const f of ['app/ods/admin/divisions/page.tsx', 'app/ods/admin/company/page.tsx']) expect(src(f)).toContain("if (!s.isAdmin) redirect('/forbidden')");
    expect(src('app/ods/office/_components/admin-c-backups.tsx')).toContain('canApprove={perms.approveRestore}');
    expect(src('app/ods/office/_components/admin-c-staff.tsx')).not.toMatch(/opacity-\d/);
    const integ = join(root, 'app/ods/admin/integrations/page.tsx');
    if (existsSync(integ)) expect(src('app/ods/admin/integrations/page.tsx')).not.toContain('ODS T9 batch 5');
    for (const f of ['office-staff', 'office-divisions', 'office-company', 'office-settings-payment', 'office-backups']) expect(existsSync(join(root, 'app/dev/ui/screens', f, 'page.tsx')), f).toBe(true);
  });
});
