'use server';
import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { getEmail } from '@/lib/adapters';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { guard, fail, failAt, ok, str, bool, requireFresh, type Result } from '@/components/admin/server';

const PAGE = '/admin/staff';
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
const AREA_ACTIONS: Record<string, readonly string[]> = { backups: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] };

type Sb = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;
type Admin = ReturnType<typeof createAdminClient>;

async function staffRoleCodes(sb: Sb) {
  const { data } = await sb.from('roles').select('code').eq('is_staff', true);
  return new Set((data ?? []).map((r) => r.code as string));
}

/** Supabase invite / reset links land on the auth-flow agent's set-password page. */
function setPasswordUrl() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/staff/set-password`;
}

/** Does this email already belong to someone? Customers (org members) can never become staff (SPEC §17.3). */
async function emailOwner(admin: Admin, email: string): Promise<{ kind: 'free' } | { kind: 'customer' | 'staff' | 'other'; id: string }> {
  const pattern = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: prof } = await admin.from('profiles').select('id').ilike('email', pattern).limit(1).maybeSingle();
  if (!prof) return { kind: 'free' };
  const [{ count: orgs }, { data: roles }] = await Promise.all([
    admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('user_id', prof.id),
    admin.from('user_roles').select('role_code, roles!inner(is_staff)').eq('user_id', prof.id).eq('roles.is_staff', true),
  ]);
  if ((orgs ?? 0) > 0) return { kind: 'customer', id: prof.id };
  if ((roles ?? []).length) return { kind: 'staff', id: prof.id };
  return { kind: 'other', id: prof.id };
}

async function audit(actor: string, action: string, details: Record<string, unknown>) {
  const meta = await getRequestMeta();
  await createAdminClient().rpc('auth_audit', { p_user: actor, p_action: action, p_ip: meta.ip, p_ua: meta.ua, p_details: details });
}

const Invite = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  office: z.string().trim().max(120).optional(),
});

/** Validate the shared invite / create form: name, email, office, staff roles (admin only by an Admin). */
async function parseNewStaff(g: { sb: Sb; s: { isAdmin: boolean } }, fd: FormData) {
  const p = Invite.safeParse({ full_name: str(fd, 'full_name'), email: str(fd, 'email'), office: str(fd, 'office') || undefined });
  if (!p.success) return { error: fail('Enter a name and a valid work email.') };
  const roles = [...new Set(fd.getAll('roles').map(String))];
  const allowed = await staffRoleCodes(g.sb);
  if (!roles.length || roles.some((r) => !allowed.has(r))) return { error: fail('Pick at least one staff role.') };
  if (roles.includes('admin') && !g.s.isAdmin) return { error: fail('Only an Admin can invite another Admin.') };
  return { data: { ...p.data, roles } };
}

/** Insert roles through the caller's session so RLS (staff:edit + fresh code) applies and the audit trigger records the actor. */
async function grantRoles(sb: Sb, uid: string, roles: string[], by: string) {
  return sb.from('user_roles').insert(roles.map((r) => ({ user_id: uid, role_code: r, created_by: by })));
}

/**
 * Invite a staff member (SPEC §17.3 "Invitation only"): Supabase sends the invite email with a set-password link
 * (link lifetime = the project's email OTP expiry, set to 24 h), then profile (2FA required, office) + roles.
 */
export async function inviteStaff(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'create');
  if ('error' in g) return g.error;
  const v = await parseNewStaff(g, fd);
  if ('error' in v) return v.error!;
  const { email, full_name, office, roles } = v.data;
  const stale = await requireFresh(g.sb, PAGE);   // granting roles is a role change → fresh code
  if (stale) return stale;

  const admin = createAdminClient();
  const owner = await emailOwner(admin, email);
  if (owner.kind === 'customer') return fail('This email belongs to a customer account. Staff must use a separate work email.');
  if (owner.kind === 'staff') return fail('This person is already on the team. Use "Resend invite" in the Team table.');
  if (owner.kind === 'other') return fail('An account with this email already exists. Use a different work email.');

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: setPasswordUrl(), data: { full_name, staff: true } });
  if (error || !data.user) return fail(error?.message ?? 'Could not send the invitation.');
  const uid = data.user.id;
  const now = new Date().toISOString();
  const { error: pe } = await admin.from('profiles').upsert({
    id: uid, full_name, email, office: office ?? null, totp_required: true, active: true, invited_at: now, invited_by: g.s.userId,
  });
  if (pe) { await admin.auth.admin.deleteUser(uid); return fail(pe); }
  const { error: re } = await grantRoles(g.sb, uid, roles, g.s.userId);
  if (re) { await admin.auth.admin.deleteUser(uid); return failAt(re, PAGE); }
  await audit(g.s.userId, 'auth.invite_sent', { target: uid, email, roles, office: office ?? null });
  revalidatePath(PAGE);
  return ok(`Invitation sent to ${email}. The link to set a password is valid for 24 hours; 2FA is set up at first sign-in.`);
}

/** Resend the invitation to someone who has not accepted yet. */
export async function resendInvite(uid: string): Promise<Result> {
  const g = await guard('staff', 'create');
  if ('error' in g) return g.error;
  const admin = createAdminClient();
  const { data: u, error: ue } = await admin.auth.admin.getUserById(uid);
  if (ue || !u.user?.email) return fail('NOT_FOUND');
  if (u.user.email_confirmed_at) return fail('This person has already accepted the invitation. Ask them to use "Forgot password" instead.');
  const email = u.user.email;
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', uid).maybeSingle();
  const redirectTo = setPasswordUrl();
  let via = 'invite';
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: prof?.full_name ?? '', staff: true } });
  if (error) {
    // GoTrue refuses to re-invite some existing users → generate the invite link ourselves and send it through the email adapter
    via = 'generate_link';
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
    const { data: link2, error: le2 } = le ? await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } }) : { data: null, error: null };
    const url = link?.properties?.action_link ?? link2?.properties?.action_link;
    if (!url) return fail(le2?.message ?? le?.message ?? error.message);
    const name = prof?.full_name ? ` ${prof.full_name.split(' ')[0]}` : '';
    try {
      await getEmail().send({
        to: email,
        subject: 'Your Octopus B2B staff invitation',
        html: `<p>Hello${name},</p><p>You have been invited to the Octopus B2B back office. Set your password here (the link is valid for 24 hours):</p><p><a href="${url}">Set my password</a></p><p>You will set up two-step verification at your first sign-in.</p>`,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Could not send the email.');
    }
  }
  await admin.from('profiles').update({ invited_at: new Date().toISOString(), invited_by: g.s.userId }).eq('id', uid);
  await audit(g.s.userId, 'auth.invite_sent', { target: uid, email, resend: true, via });
  revalidatePath(PAGE);
  return ok(`Invitation sent again to ${email}`);
}

/** Admin only: remove someone's authenticator + backup codes and sign them out (lost phone). Logged; needs a fresh code. */
export async function resetTwoFactor(uid: string, reason?: string): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can reset two-step verification.');
  if (!reason?.trim()) return fail('REASON_REQUIRED');
  const { error } = await g.sb.rpc('admin_reset_2fa', { p_user: uid, p_reason: reason.trim() });
  if (error) return failAt(error, PAGE);
  revalidatePath(PAGE);
  return ok('2FA reset. They will scan a new QR code at their next sign-in.');
}

/** Sign someone out of every device (deletes their Supabase sessions). Needs a fresh code. */
export async function endSessions(uid: string, reason?: string): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.rpc('admin_end_sessions', { p_user: uid, p_reason: reason?.trim() || null });
  if (error) return failAt(error, PAGE);
  revalidatePath(PAGE);
  const n = Number(data ?? 0);
  return ok(n ? `Ended ${n} session${n === 1 ? '' : 's'}` : 'No active sessions');
}

/** Clear a lockout (5 wrong passwords / codes) before it expires. */
export async function unlockAccount(email: string): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('admin_unlock_account', { p_email: email });
  if (error) return failAt(error, PAGE);
  revalidatePath(PAGE);
  return ok('Account unlocked');
}

/** Replace a user's staff roles (checkbox set). Role changes need a fresh 2FA code (RLS mfa_fresh()). */
export async function setUserRoles(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const uid = str(fd, 'user_id');
  if (!uid) return fail('NOT_FOUND');
  const back = `${PAGE}?user=${uid}#edit-user`;
  const want = new Set(fd.getAll('roles').map(String));
  const allowed = await staffRoleCodes(g.sb);
  if ([...want].some((r) => !allowed.has(r))) return fail('Unknown role');
  const { data: cur } = await g.sb.from('user_roles').select('role_code').eq('user_id', uid);
  const have = new Set((cur ?? []).map((r) => r.role_code as string).filter((r) => allowed.has(r)));
  const add = [...want].filter((r) => !have.has(r));
  const remove = [...have].filter((r) => !want.has(r));
  if (!add.length && !remove.length) return ok('No changes');
  if ((add.includes('admin') || remove.includes('admin')) && !g.s.isAdmin) return fail('Only an Admin can grant or remove Admin.');
  if (uid === g.s.userId && remove.includes('admin')) return fail('You cannot remove your own Admin role.');
  const stale = await requireFresh(g.sb, back);   // a stale DELETE would be silently filtered by RLS
  if (stale) return stale;
  if (add.length) {
    const { error } = await grantRoles(g.sb, uid, add, g.s.userId);
    if (error) return failAt(error, back);
  }
  if (remove.length) {
    const { data, error } = await g.sb.from('user_roles').delete().eq('user_id', uid).in('role_code', remove).select('role_code');
    if (error) return failAt(error, back);
    if ((data ?? []).length < remove.length) return fail('Some roles could not be removed (permission or fresh 2FA code needed).');
  }
  revalidatePath(PAGE);
  return ok('Roles updated');
}

/** Deactivate (end all sessions + profile inactive + auth ban) or re-enable a staff account. */
export async function setStaffActive(uid: string, active: boolean): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  if (uid === g.s.userId) return fail('You cannot deactivate your own account.');
  const { data: target } = await g.sb.from('user_roles').select('role_code').eq('user_id', uid);
  if ((target ?? []).some((r) => r.role_code === 'admin') && !g.s.isAdmin) return fail('Only an Admin can deactivate an Admin.');
  let ended = 0;
  if (!active) {
    // SPEC §17.3: deactivating ends all their sessions at once (needs a fresh code)
    const { data: n, error: se } = await g.sb.rpc('admin_end_sessions', { p_user: uid, p_reason: 'Account deactivated' });
    if (se) return failAt(se, PAGE);
    ended = Number(n ?? 0);
  }
  const { data, error } = await g.sb.from('profiles').update({ active }).eq('id', uid).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  const { error: be } = await createAdminClient().auth.admin.updateUserById(uid, { ban_duration: active ? 'none' : '876000h' });
  if (be) return fail(be.message);
  revalidatePath(PAGE);
  return ok(active ? 'Account reactivated' : `Account deactivated${ended ? ` and ${ended} session${ended === 1 ? '' : 's'} ended` : ''}`);
}

/** Save the permission matrix for one role (admin role is implicit: all permissions). Needs a fresh 2FA code. */
export async function savePermissions(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const role = str(fd, 'role');
  if (!role || role === 'admin') return fail('Admin always has every permission.');
  const back = `${PAGE}?role=${encodeURIComponent(role)}`;
  const { data: areas } = await g.sb.from('permission_areas').select('code');
  const areaSet = new Set((areas ?? []).map((a) => a.code as string));
  const want = new Set(fd.getAll('perm').map(String).filter((k) => {
    const [a, act] = k.split(':');
    return areaSet.has(a) && (AREA_ACTIONS[a] ?? (ACTIONS as readonly string[])).includes(act);
  }));
  const { data: cur, error: ce } = await g.sb.from('role_permissions').select('area, action').eq('role_code', role);
  if (ce) return fail(ce);
  const have = new Set((cur ?? []).map((r) => `${r.area}:${r.action}`));
  const add = [...want].filter((k) => !have.has(k));
  const remove = [...have].filter((k) => !want.has(k));
  if (!add.length && !remove.length) return ok('No changes');
  const stale = await requireFresh(g.sb, back);
  if (stale) return stale;
  if (add.length) {
    const { error } = await g.sb.from('role_permissions').insert(add.map((k) => { const [area, action] = k.split(':'); return { role_code: role, area, action }; }));
    if (error) return failAt(error, back);
  }
  for (const k of remove) {
    const [area, action] = k.split(':');
    const { error } = await g.sb.from('role_permissions').delete().eq('role_code', role).eq('area', area).eq('action', action);
    if (error) return failAt(error, back);
  }
  revalidatePath(PAGE);
  return ok(`Saved: ${add.length} added, ${remove.length} removed. Takes effect on the next page load.`);
}

/**
 * Advanced (Admin only, for environments without email/SMTP): create the account with a temporary password instead of
 * an invitation. The person still has to set up 2FA at first sign-in.
 */
export async function createStaffWithoutEmail(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'create');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can create accounts without an invitation email.');
  const v = await parseNewStaff(g, fd);
  if ('error' in v) return v.error!;
  const { email, full_name, office, roles } = v.data;
  const typed = str(fd, 'password');
  if (typed && typed.length < 12) return fail('Temporary password must be at least 12 characters (or leave empty to generate one).');
  if (typed.length > 72) return fail('Temporary password is too long (max 72 characters).');
  const password = typed || `Oct-${crypto.randomBytes(9).toString('base64url')}!`;
  const stale = await requireFresh(g.sb, PAGE);
  if (stale) return stale;

  const admin = createAdminClient();
  const owner = await emailOwner(admin, email);
  if (owner.kind === 'customer') return fail('This email belongs to a customer account. Staff must use a separate work email.');
  if (owner.kind !== 'free') return fail('An account with this email already exists.');
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, staff: true } });
  if (error || !created.user) return fail(error?.message ?? 'Could not create user');
  const uid = created.user.id;
  const { error: pe } = await admin.from('profiles').upsert({ id: uid, full_name, email, office: office ?? null, totp_required: true, active: true, invited_at: new Date().toISOString(), invited_by: g.s.userId });
  if (pe) { await admin.auth.admin.deleteUser(uid); return fail(pe); }
  const { error: re } = await grantRoles(g.sb, uid, roles, g.s.userId);
  if (re) { await admin.auth.admin.deleteUser(uid); return failAt(re, PAGE); }
  await audit(g.s.userId, 'auth.invite_sent', { target: uid, email, roles, office: office ?? null, method: 'temporary_password' });
  revalidatePath(PAGE);
  return ok(`Created ${email}. Temporary password: ${password} — share it securely; 2FA is required at first sign-in.`);
}

/* ───────── Security panel (SPEC §17.3) ───────── */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function validIpOrCidr(v: string): boolean {
  const [ip, bits, extra] = v.split('/');
  if (extra !== undefined) return false;
  if (IPV4.test(ip)) return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  if (ip.includes(':') && /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45) return bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= 128);
  return false;
}

function intIn(fd: FormData, key: string, min: number, max: number): number | null {
  const n = Number(str(fd, key));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Admin: save lockout, session, step-up, trust, IP allow-list, 2FA enforcement and Google domain (rpc update_staff_security). */
export async function saveStaffSecurity(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can change security settings.');
  const nums = {
    lockout_attempts: intIn(fd, 'lockout_attempts', 3, 20),
    lockout_minutes: intIn(fd, 'lockout_minutes', 1, 1440),
    idle_minutes: intIn(fd, 'idle_minutes', 5, 720),
    max_session_hours: intIn(fd, 'max_session_hours', 1, 168),
    step_up_minutes: intIn(fd, 'step_up_minutes', 1, 120),
    trust_hours: intIn(fd, 'trust_hours', 0, 720),
  };
  const bad = Object.entries(nums).find(([, v]) => v == null);
  if (bad) {
    const label: Record<string, string> = {
      lockout_attempts: 'Lockout attempts (3–20)', lockout_minutes: 'Lockout minutes (1–1440)', idle_minutes: 'Idle timeout (5–720 minutes)',
      max_session_hours: 'Maximum session (1–168 hours)', step_up_minutes: 'Step-up window (1–120 minutes)', trust_hours: 'Trust this computer (0–720 hours)',
    };
    return fail(`Check ${label[bad[0]]}.`);
  }
  if ((nums.idle_minutes as number) > (nums.max_session_hours as number) * 60) return fail('Idle timeout cannot be longer than the maximum session.');
  const ips = [...new Set(str(fd, 'ip_allowlist').split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean))];
  const badIp = ips.find((x) => !validIpOrCidr(x));
  if (badIp) return fail(`"${badIp}" is not a valid IP address or CIDR range.`);
  const ipRoles = fd.getAll('ip_rule_roles').map(String).filter((r) => ['admin', 'finance'].includes(r));
  const ipEnabled = bool(fd, 'ip_rule_enabled');
  if (ipEnabled && !ips.length) return fail('Add at least one office IP address before turning the IP rule on.');
  if (ipEnabled && !ipRoles.length) return fail('Pick at least one role for the IP rule.');
  const enforce = bool(fd, 'enforce_aal2');
  const { data: cur } = await g.sb.from('site_settings').select('value').eq('key', 'staff_security').maybeSingle();
  const wasEnforced = (cur?.value as { enforce_aal2?: boolean } | null)?.enforce_aal2 !== false;
  if (!enforce && wasEnforced && str(fd, 'confirm_disable_2fa') !== 'CONFIRM') return fail('To turn off required 2FA, type CONFIRM in the box.');
  const domain = str(fd, 'google_domain').toLowerCase().replace(/^@/, '');
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return fail('Enter a valid Google Workspace domain, e.g. octopusb2b.com');

  const settings = { ...nums, ip_allowlist: ips, ip_rule_roles: ipRoles, ip_rule_enabled: ipEnabled, enforce_aal2: enforce, google_domain: domain || null };
  const { error } = await g.sb.rpc('update_staff_security', { p_settings: settings });
  if (error) return failAt(error, `${PAGE}#security`);
  revalidatePath(PAGE);
  return ok(enforce ? 'Security settings saved' : 'Saved — WARNING: 2FA is no longer required for staff.');
}


/** Distributor ↔ supplier assignment. */
export async function assignSupplier(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const distributor_id = str(fd, 'distributor_id');
  const supplier_id = str(fd, 'supplier_id');
  if (!distributor_id || !supplier_id) return fail('Choose a distributor and a supplier.');
  const { error } = await g.sb.from('distributor_suppliers').insert({ distributor_id, supplier_id });
  if (error) return fail(error);
  revalidatePath(PAGE);
  return ok('Supplier assigned');
}

export async function unassignSupplier(distributorId: string, supplierId: string): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('distributor_suppliers').delete().eq('distributor_id', distributorId).eq('supplier_id', supplierId).select('supplier_id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath(PAGE);
  return ok('Assignment removed');
}

