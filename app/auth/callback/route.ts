import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';
import { metaFromHeaders } from '@/lib/staff/request-meta';

/**
 * OAuth / email-link callback: exchanges the code for a session, then routes to onboarding if there is no profile.
 * Google sign-in is for CUSTOMERS only (owner decision 5 Nov 2026); staff sign in with work email + password + 2FA.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const via = url.searchParams.get('via');
  const next = url.searchParams.get('next') ?? '/account';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  const to = (p: string) => NextResponse.redirect(new URL(p, url.origin));

  // the old staff Google entry point is closed — staff use email + password (SPEC §17, §22)
  if (url.searchParams.get('staff') === '1') {
    return to(`/staff/login?error=${encodeURIComponent('Google sign-in is not available for staff. Use your work email and password.')}`);
  }

  const oauthError = url.searchParams.get('error_description');
  if (oauthError) return to(`/login?error=${encodeURIComponent(oauthError)}`);

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return to(`/login?error=${encodeURIComponent(error.message)}`);
    const { data: u } = await sb.auth.getUser();
    const user = u.user!;
    const email = (user.email ?? '').toLowerCase();
    const isGoogle = via === 'google' || user.app_metadata?.provider === 'google';

    if (isGoogle) {
      const admin = createAdminClient();
      const meta = metaFromHeaders(req.headers);
      const staff = await isStaffUser(user.id).catch(() => false);
      // staff accounts and staff-domain emails can never use the customer Google button (SPEC §17.3 staff ≠ customer)
      if (staff || (email && (await emailIsStaff(email).catch(() => false)))) {
        await admin.rpc('auth_audit', { p_user: user.id, p_action: 'auth.sign_in_failed', p_ip: meta.ip, p_ua: meta.ua, p_details: { provider: 'google', reason: 'staff_email' } });
        await sb.auth.signOut();
        // a brand-new Google user with a staff email (no profile) is removed again so no customer account remains
        if (!staff) {
          const { data: prof } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle();
          if (!prof) await admin.auth.admin.deleteUser(user.id).catch(() => null);
        }
        return to(`/staff/login?error=${encodeURIComponent('This is an Octopus staff email. Staff sign in here with work email and password.')}`);
      }
      const isNew = !!user.created_at && Date.now() - new Date(user.created_at).getTime() < 5 * 60 * 1000;
      await admin.rpc('auth_audit', {
        p_user: user.id, p_action: isNew ? 'auth.sign_up' : 'auth.sign_in', p_ip: meta.ip, p_ua: meta.ua,
        p_details: { method: 'oauth', provider: 'google', portal: 'customer' },
      });
    } else if (await isStaffUser(user.id).catch(() => false)) {
      // staff who confirmed an email link continue in the staff flow
      return to('/staff/verify');
    }

    const { data: profile } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (!profile) return to('/onboarding');
  }
  return to(safeNext);
}
