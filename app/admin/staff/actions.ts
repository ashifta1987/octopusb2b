'use server';
import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { guard, fail, ok, str, type Result } from '@/components/admin/server';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
const AREA_ACTIONS: Record<string, readonly string[]> = { backups: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] };

async function staffRoleCodes(sb: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>) {
  const { data } = await sb.from('roles').select('code').eq('is_staff', true);
  return new Set((data ?? []).map((r) => r.code as string));
}

const NewStaff = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().max(72).optional(),
});

/** Create a staff user (Supabase Auth admin API), profile with forced 2FA and roles. */
export async function createStaff(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'create');
  if ('error' in g) return g.error;
  const p = NewStaff.safeParse({ full_name: str(fd, 'full_name'), email: str(fd, 'email'), password: str(fd, 'password') || undefined });
  if (!p.success) return fail('Enter a name and a valid email.');
  const roles = fd.getAll('roles').map(String);
  const allowed = await staffRoleCodes(g.sb);
  if (!roles.length || roles.some((r) => !allowed.has(r))) return fail('Pick at least one staff role.');
  if (roles.includes('admin') && !g.s.isAdmin) return fail('Only an Admin can create another Admin.');
  const password = p.data.password && p.data.password.length >= 12 ? p.data.password : `Oct-${crypto.randomBytes(9).toString('base64url')}!`;
  if (p.data.password && p.data.password.length < 12) return fail('Temporary password must be at least 12 characters (or leave empty to generate one).');

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: p.data.email, password, email_confirm: true, user_metadata: { full_name: p.data.full_name, staff: true },
  });
  if (error || !created.user) return fail(error?.message ?? 'Could not create user');
  const uid = created.user.id;
  const { error: pe } = await admin.from('profiles').upsert({ id: uid, full_name: p.data.full_name, email: p.data.email, totp_required: true, active: true });
  if (pe) { await admin.auth.admin.deleteUser(uid); return fail(pe); }
  // roles through the caller's session so RLS (staff:edit) applies and the audit trigger records the actor
  const { error: re } = await g.sb.from('user_roles').insert(roles.map((r) => ({ user_id: uid, role_code: r, created_by: g.s.userId })));
  if (re) {
    const { error: re2 } = await admin.from('user_roles').insert(roles.map((r) => ({ user_id: uid, role_code: r, created_by: g.s.userId })));
    if (re2) return fail(re2);
  }
  revalidatePath('/admin/staff');
  return ok(`Created ${p.data.email}. Temporary password: ${password} — share it securely; 2FA is required at first sign-in.`);
}

/** Replace a user's staff roles (checkbox set). */
export async function setUserRoles(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const uid = str(fd, 'user_id');
  if (!uid) return fail('NOT_FOUND');
  const want = new Set(fd.getAll('roles').map(String));
  const allowed = await staffRoleCodes(g.sb);
  if ([...want].some((r) => !allowed.has(r))) return fail('Unknown role');
  const { data: cur } = await g.sb.from('user_roles').select('role_code').eq('user_id', uid);
  const have = new Set((cur ?? []).map((r) => r.role_code as string).filter((r) => allowed.has(r)));
  const add = [...want].filter((r) => !have.has(r));
  const remove = [...have].filter((r) => !want.has(r));
  if ((add.includes('admin') || remove.includes('admin')) && !g.s.isAdmin) return fail('Only an Admin can grant or remove Admin.');
  if (uid === g.s.userId && remove.includes('admin')) return fail('You cannot remove your own Admin role.');
  if (add.length) {
    const { error } = await g.sb.from('user_roles').insert(add.map((r) => ({ user_id: uid, role_code: r, created_by: g.s.userId })));
    if (error) return fail(error);
  }
  if (remove.length) {
    const { error } = await g.sb.from('user_roles').delete().eq('user_id', uid).in('role_code', remove);
    if (error) return fail(error);
  }
  revalidatePath('/admin/staff');
  return ok(add.length || remove.length ? 'Roles updated' : 'No changes');
}

/** Deactivate (profile inactive + auth ban) or re-enable a staff account. */
export async function setStaffActive(uid: string, active: boolean): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  if (uid === g.s.userId) return fail('You cannot deactivate your own account.');
  const { data: target } = await g.sb.from('user_roles').select('role_code').eq('user_id', uid);
  if ((target ?? []).some((r) => r.role_code === 'admin') && !g.s.isAdmin) return fail('Only an Admin can deactivate an Admin.');
  const { data, error } = await g.sb.from('profiles').update({ active }).eq('id', uid).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  const { error: be } = await createAdminClient().auth.admin.updateUserById(uid, { ban_duration: active ? 'none' : '876000h' });
  if (be) return fail(be.message);
  revalidatePath('/admin/staff');
  return ok(active ? 'Account enabled' : 'Account deactivated and signed out of new sessions');
}

export async function setForce2fa(uid: string, required: boolean): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('profiles').update({ totp_required: required }).eq('id', uid).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath('/admin/staff');
  return ok(required ? '2FA required' : '2FA no longer forced');
}

/** Save the permission matrix for one role (admin role is implicit: all permissions). */
export async function savePermissions(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('staff', 'edit');
  if ('error' in g) return g.error;
  const role = str(fd, 'role');
  if (!role || role === 'admin') return fail('Admin always has every permission.');
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
  if (add.length) {
    const { error } = await g.sb.from('role_permissions').insert(add.map((k) => { const [area, action] = k.split(':'); return { role_code: role, area, action }; }));
    if (error) return fail(error);
  }
  for (const k of remove) {
    const [area, action] = k.split(':');
    const { error } = await g.sb.from('role_permissions').delete().eq('role_code', role).eq('area', area).eq('action', action);
    if (error) return fail(error);
  }
  revalidatePath('/admin/staff');
  return ok(`Saved: ${add.length} added, ${remove.length} removed. Takes effect on the next page load.`);
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
  revalidatePath('/admin/staff');
  return ok('Supplier assigned');
}

export async function unassignSupplier(distributorId: string, supplierId: string): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const { data, error } = await g.sb.from('distributor_suppliers').delete().eq('distributor_id', distributorId).eq('supplier_id', supplierId).select('supplier_id');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath('/admin/staff');
  return ok('Assignment removed');
}

