import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Session = {
  userId: string;
  email: string | null;
  profile: { full_name: string; phone: string | null; country: string | null; totp_required: boolean } | null;
  roles: string[];
  permissions: Set<string>; // "area:action"
  org: { id: string; name: string; country: string | null; city: string | null; kyc_status: string } | null;
  isStaff: boolean;
  isAdmin: boolean;
  aal: string | null;
};

const STAFF_ROLES = ['admin', 'operations', 'finance', 'support', 'sourcing_agent', 'qc_coordinator', 'content_editor', 'distributor'];

/** Loads the current user, profile, roles, permissions and org once per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const c = claims?.claims;
  if (!c?.sub) return null;
  const userId = c.sub as string;
  const [{ data: profile }, { data: roles }, { data: member }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, country, totp_required').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role_code').eq('user_id', userId),
    supabase.from('org_members').select('organizations(id, name, country, city, kyc_status)').eq('user_id', userId).limit(1).maybeSingle(),
  ]);
  const roleCodes = (roles ?? []).map((r) => r.role_code as string);
  const { data: perms } = roleCodes.length
    ? await supabase.from('role_permissions').select('area, action').in('role_code', roleCodes)
    : { data: [] as { area: string; action: string }[] };
  const isAdmin = roleCodes.includes('admin');
  return {
    userId,
    email: (c.email as string) ?? null,
    profile: profile ?? null,
    roles: roleCodes,
    permissions: new Set((perms ?? []).map((p) => `${p.area}:${p.action}`)),
    org: (member?.organizations as unknown as Session['org']) ?? null,
    isStaff: roleCodes.some((r) => STAFF_ROLES.includes(r)),
    isAdmin,
    aal: (c.aal as string) ?? null,
  };
});

export function can(s: Session | null, area: string, action = 'view') {
  if (!s) return false;
  return s.isAdmin || s.permissions.has(`${area}:${action}`);
}

/** Customer pages: must be logged in and have completed onboarding (profile + org). */
export async function requireCustomer(next = '/account') {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!s.profile || (!s.org && !s.isStaff)) redirect('/onboarding');
  return s;
}

/** Staff pages: require a permission (SPEC §3) on an aal2 (2FA-verified) staff session (SPEC §17.3). */
export async function requireStaff(area: string, action = 'view', next = '/office') {
  const s = await getSession();
  if (!s) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  if (!s.isStaff) redirect('/login'); // customers go to the customer login (SPEC §17.3)
  if (s.aal !== 'aal2') redirect(`/staff/verify?next=${encodeURIComponent(next)}`); // 2FA everywhere for staff
  if (!can(s, area, action)) redirect('/forbidden');
  return s;
}

export async function requireRole(role: string, next: string) {
  const s = await getSession();
  if (!s) redirect(`${STAFF_ROLES.includes(role) ? '/staff/login' : '/login'}?next=${encodeURIComponent(next)}`);
  if (!s.isAdmin && !s.roles.includes(role)) redirect('/forbidden');
  return s;
}

