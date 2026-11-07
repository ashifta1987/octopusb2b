import { describe, expect, it } from 'vitest';
import { WORKSPACES, workspacesFor, workspaceForPath } from '@/lib/staff/workspaces';
import { ipAllowed, ipMatches, ipRuleBlocks } from '@/lib/staff/ip';
import {
  newStaffCookie, sessionState, staffCookieOptions, DEFAULT_LIMITS, signExpiredMarker, signStaffCookie, verifyExpiredMarker, verifyStaffCookie,
} from '@/lib/staff/session-cookie';
import { isStepUpError, stepUpRedirect } from '@/lib/staff/step-up';
import { hashBackupCode, newBackupCodes, normaliseBackupCode } from '@/lib/staff/backup-codes';
import { passwordProblem } from '@/lib/staff/password';

const sess = (roles: string[], perms: string[] = []) => ({ isAdmin: roles.includes('admin'), roles, permissions: new Set(perms) });

describe('workspacesFor', () => {
  it('returns nothing when signed out', () => {
    expect(workspacesFor(null)).toEqual([]);
  });
  it('admin sees every workspace', () => {
    expect(workspacesFor(sess(['admin'])).map((w) => w.key)).toEqual(WORKSPACES.map((w) => w.key));
  });
  it('filters by permission and role', () => {
    const ops = sess(['operations'], ['dashboard:view', 'orders:view', 'support:view']);
    expect(workspacesFor(ops).map((w) => w.key)).toEqual(['office', 'shipping', 'support']);
    const fin = sess(['finance'], ['finance:view']);
    expect(workspacesFor(fin).map((w) => w.key)).toEqual(['finance']);
    const dist = sess(['distributor']);
    expect(workspacesFor(dist).map((w) => w.key)).toEqual(['distributor']);
  });
  it('edit permission alone does not grant a view workspace', () => {
    expect(workspacesFor(sess(['content_editor'], ['content:edit']))).toEqual([]);
  });
  it('maps a path to its workspace (longest prefix)', () => {
    expect(workspaceForPath('/office/shipping/123')?.key).toBe('shipping');
    expect(workspaceForPath('/office/kyc')?.key).toBe('office');
    expect(workspaceForPath('/admin/finance')?.key).toBe('finance');
    expect(workspaceForPath('/admin/staff')?.key).toBe('admin');
    expect(workspaceForPath('/account')).toBeUndefined();
  });
});

describe('IP allow-list', () => {
  it('matches exact IPs', () => {
    expect(ipMatches('198.51.100.7', '198.51.100.7')).toBe(true);
    expect(ipMatches('198.51.100.8', '198.51.100.7')).toBe(false);
    expect(ipMatches('::ffff:198.51.100.7', '198.51.100.7')).toBe(true);
    expect(ipMatches('2001:db8::1', '2001:DB8::1')).toBe(true);
  });
  it('matches IPv4 CIDR ranges', () => {
    expect(ipMatches('203.0.113.42', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('203.0.114.1', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(ipMatches('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(ipMatches('203.0.113.42', '203.0.113.42/32')).toBe(true);
    expect(ipMatches('203.0.113.43', '203.0.113.42/32')).toBe(false);
  });
  it('rejects malformed input', () => {
    expect(ipMatches('203.0.113.300', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('203.0.113.1', '203.0.113.0/33')).toBe(false);
    expect(ipMatches('2001:db8::1', '203.0.113.0/24')).toBe(false);
    expect(ipAllowed(null, ['1.2.3.4'])).toBe(false);
    expect(ipAllowed('1.2.3.4', [])).toBe(false);
  });
  it('rule only blocks configured roles outside the list', () => {
    const sec = { ip_rule_enabled: true, ip_rule_roles: ['admin', 'finance'], ip_allowlist: ['203.0.113.0/24'] };
    expect(ipRuleBlocks(sec, ['finance'], '8.8.8.8')).toBe(true);
    expect(ipRuleBlocks(sec, ['finance'], '203.0.113.9')).toBe(false);
    expect(ipRuleBlocks(sec, ['support'], '8.8.8.8')).toBe(false);
    expect(ipRuleBlocks({ ...sec, ip_rule_enabled: false }, ['admin'], '8.8.8.8')).toBe(false);
  });
});

describe('staff session cookie', () => {
  const KEY = 'unit-test-key';
  it('round-trips and rejects tampering', () => {
    const v = newStaffCookie(false, 'u1', 1_000);
    const raw = signStaffCookie(v, KEY);
    expect(verifyStaffCookie(raw, KEY)).toEqual({ start: 1_000, last: 1_000, trusted: false, uid: 'u1' });
    expect(verifyStaffCookie(raw, 'other-key')).toBeNull();
    const [body, sig] = raw.split('.');
    const forged = Buffer.from(JSON.stringify({ ...v, trusted: true })).toString('base64url');
    expect(verifyStaffCookie(`${forged}.${sig}`, KEY)).toBeNull();
    expect(verifyStaffCookie(`${body}.`, KEY)).toBeNull();
    expect(verifyStaffCookie('garbage', KEY)).toBeNull();
    expect(verifyStaffCookie(undefined, KEY)).toBeNull();
  });
  it('uses the env secret by default', () => {
    const raw = signStaffCookie(newStaffCookie(true, 'u2'));
    expect(verifyStaffCookie(raw)?.trusted).toBe(true);
  });
  it('expires after 30 idle minutes unless trusted, and always after 12 hours', () => {
    const t0 = 0;
    const min = 60_000;
    const hr = 60 * min;
    const plain = newStaffCookie(false, 'u', t0);
    expect(sessionState(plain, t0 + 29 * min)).toBe('ok');
    expect(sessionState(plain, t0 + 31 * min)).toBe('idle');
    expect(sessionState({ ...plain, last: t0 + 11 * hr + 50 * min }, t0 + 12 * hr - min)).toBe('ok');
    expect(sessionState({ ...plain, last: t0 + 12 * hr }, t0 + 12 * hr + min)).toBe('max');
    const trusted = newStaffCookie(true, 'u', t0);
    expect(sessionState(trusted, t0 + 5 * hr)).toBe('ok');
    expect(sessionState(trusted, t0 + 12 * hr + 1)).toBe('max');
    expect(sessionState(plain, t0 + 45 * min, { idleMinutes: 60, maxHours: 12, trustHours: 12 })).toBe('ok');
  });
  it('"trust this computer" for 30 days: no idle timeout or 12 h maximum until the signed expiry', () => {
    const t0 = 1_700_000_000_000; const hr = 3600_000; const day = 24 * hr;
    const t = newStaffCookie(true, 'u', t0, 720);
    expect(t.until).toBe(t0 + 30 * day);
    expect(sessionState(t, t0 + 3 * day)).toBe('ok');                // idle for days, still signed in
    expect(sessionState(t, t0 + 30 * day - 1)).toBe('ok');
    expect(sessionState(t, t0 + 30 * day + 1)).toBe('max');
    expect(newStaffCookie(false, 'u', t0, 720).until).toBeUndefined();   // not trusted → normal limits
    const raw = signStaffCookie(t, KEY);
    expect(verifyStaffCookie(raw, KEY)?.until).toBe(t0 + 30 * day);
    const forged = Buffer.from(JSON.stringify({ ...t, until: t0 + 365 * day })).toString('base64url') + '.' + raw.split('.')[1];
    expect(verifyStaffCookie(forged, KEY)).toBeNull();               // the expiry cannot be extended by editing the cookie
    expect(staffCookieOptions(DEFAULT_LIMITS, t.until, t0).maxAge).toBe(30 * 24 * 3600);
  });
  it('expiry marker is signed and short-lived', () => {
    const raw = signExpiredMarker({ uid: 'u', reason: 'idle', at: 10_000 }, KEY);
    expect(verifyExpiredMarker(raw, KEY, 10_000 + 60_000)?.reason).toBe('idle');
    expect(verifyExpiredMarker(raw, KEY, 10_000 + 11 * 60_000)).toBeNull();
    expect(verifyExpiredMarker(raw, 'x', 10_000)).toBeNull();
  });
});

describe('step-up detection', () => {
  it('detects step-up errors', () => {
    expect(isStepUpError({ message: 'STEP_UP_REQUIRED' })).toBe(true);
    expect(isStepUpError(new Error('MFA_REQUIRED: verify again'))).toBe(true);
    expect(isStepUpError({ message: 'new row violates row-level security policy for table "user_roles"' })).toBe(true);
    expect(isStepUpError({ message: 'new row violates row-level security policy for table "role_permissions"', code: '42501' })).toBe(true);
    expect(isStepUpError('STEP_UP_REQUIRED')).toBe(true);
  });
  it('ignores other errors', () => {
    expect(isStepUpError(null)).toBe(false);
    expect(isStepUpError({ message: 'FORBIDDEN' })).toBe(false);
    expect(isStepUpError({ message: 'new row violates row-level security policy for table "orders"' })).toBe(false);
  });
  it('builds the verify redirect', () => {
    expect(stepUpRedirect('/admin/finance?id=1')).toBe('/staff/verify?next=%2Fadmin%2Ffinance%3Fid%3D1&reason=step_up');
    expect(stepUpRedirect('//evil.example')).toBe('/staff/verify?next=%2Fstaff%2Fworkspace&reason=step_up');
  });
});

describe('backup codes + password policy', () => {
  it('creates 10 unique, readable codes and hashes them case-insensitively', () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/));
    expect(normaliseBackupCode(' k7qx-m2pa ')).toBe('K7QXM2PA');
    expect(hashBackupCode('k7qx m2pa')).toBe(hashBackupCode('K7QX-M2PA'));
    expect(hashBackupCode('K7QX-M2PA')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('requires 10+ chars with a letter and a number', () => {
    expect(passwordProblem('short1')).not.toBeNull();
    expect(passwordProblem('longpassword')).not.toBeNull();
    expect(passwordProblem('1234567890')).not.toBeNull();
    expect(passwordProblem('octopus2026x')).toBeNull();
    expect(passwordProblem('octopus2026x', 'octopus2026y')).toMatch(/match/);
  });
});
