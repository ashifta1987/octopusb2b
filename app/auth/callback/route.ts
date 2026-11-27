import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';
import { metaFromHeaders } from '@/lib/staff/request-meta';
import { friendlyAuthError } from '@/lib/auth-errors';
import { safeNext as safeSameSiteNext } from '@/lib/safe-next';
import { isShopEnabled, customerHome } from '@/lib/shop/flag';
import { ODS_PREVIEW_COOKIE } from '@/lib/ods-flag';
import { odsOnForPublicRequest } from '@/lib/ods-request';
import { callbackDestination } from '@/lib/ods-auth';

/**
 * OAuth / email-link callback: exchanges the code for a session, then routes to first-time setup or `next`.
 * Google sign-in is for CUSTOMERS only (owner decision 5 Nov 2026); staff sign in with work email + password + 2FA.
 *
 * ODS T3 (Part 4.4): when the new theme is on for this visitor (same rule as proxy.ts: staging preview cookie, else
 * ods_theme_v1; staff/beta modes → staff only), a person with NO company membership (org_members) goes to
 * /welcome/setup?next=…, or to the invite page when a teammate invited this e-mail. With the theme off nothing changes:
 * no profile → /onboarding. The decision itself is pure: lib/ods-auth.ts callbackDestination() (unit tested).
 *
 * Identity linking: one person per verified e-mail. Supabase Auth links a Google identity to an existing user with the
 * same VERIFIED e-mail by itself (automatic linking, on by default) — this route never creates or merges a person.
 * Audit: auth.sign_in / auth.sign_up for Google AND e-mail code exchanges, auth.sign_in_failed on errors (never tokens,
 * codes or raw provider text in details).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const via = url.searchParams.get('via');
  const home = customerHome(await isShopEnabled());
  // CH-1: customers land on the Shop; strict same-site check (lib/safe-next.ts)
  const safeNext = safeSameSiteNext(url.searchParams.get('next'), home);
  const to = (p: string) => NextResponse.redirect(new URL(p, url.origin));
  const meta = metaFromHeaders(req.headers);
  const audit = async (uid: string | null, action: string, details: Record<string, unknown>) => {
    try {
      await createAdminClient().rpc('auth_audit', { p_user: uid, p_action: action, p_ip: meta.ip, p_ua: meta.ua, p_details: details });
    } catch {
      // audit must never block the sign-in
    }
  };

  // the old staff Google entry point is closed — staff use email + password (SPEC §17, §22)
  if (url.searchParams.get('staff') === '1') {
    return to(`/staff/login?error=${encodeURIComponent('Google sign-in is not available for staff. Use your work email and password.')}`);
  }

  const oauthError = url.searchParams.get('error_description');
  if (oauthError) {
    const msg = friendlyAuthError(oauthError);
    await audit(null, 'auth.sign_in_failed', { method: via === 'google' ? 'oauth' : 'email', provider: via === 'google' ? 'google' : 'email', reason: /cancel/i.test(msg) ? 'cancelled' : 'provider_error' });
    return to(/staff sign in at Back office/.test(msg) ? `/staff/login?error=${encodeURIComponent(msg)}` : `/login?error=${encodeURIComponent(msg)}`);
  }

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      await audit(null, 'auth.sign_in_failed', { method: via === 'google' ? 'oauth' : 'email', provider: via === 'google' ? 'google' : 'email', reason: 'code_exchange_failed' });
      return to(`/login?error=${encodeURIComponent(friendlyAuthError(error.message))}`);
    }
    const { data: u } = await sb.auth.getUser();
    const user = u.user!;
    const email = (user.email ?? '').toLowerCase();
    const isGoogle = via === 'google' || user.app_metadata?.provider === 'google';
    const isNew = !!user.created_at && Date.now() - new Date(user.created_at).getTime() < 5 * 60 * 1000;

    if (isGoogle) {
      const admin = createAdminClient();
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
      await admin.rpc('auth_audit', {
        p_user: user.id, p_action: isNew ? 'auth.sign_up' : 'auth.sign_in', p_ip: meta.ip, p_ua: meta.ua,
        p_details: { method: 'oauth', provider: 'google', portal: 'customer' },
      });
    } else if (await isStaffUser(user.id).catch(() => false)) {
      // staff who confirmed an email link continue in the staff flow
      await audit(user.id, 'auth.sign_in', { method: 'email', provider: 'email', portal: 'staff_link' });
      return to('/staff/verify');
    } else {
      // e-mail confirmation link / magic code exchange (customers)
      await audit(user.id, isNew ? 'auth.sign_up' : 'auth.sign_in', { method: 'email', provider: 'email', portal: 'customer' });
    }

    // ODS on for this visitor? Staff never reach here (handled above), so the staff/beta modes are simply "off" for them.
    const odsOn = await odsOnForPublicRequest(req.cookies.get(ODS_PREVIEW_COOKIE)?.value, false);
    const [{ data: profile }, member] = await Promise.all([
      sb.from('profiles').select('id').eq('id', user.id).maybeSingle(),
      odsOn ? sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    ]);
    let hasInvites = false;
    if (odsOn && !member) {
      // a teammate invited this confirmed e-mail → the invite page instead of setting up a new company (Part 4.5)
      const { data: inv } = await sb.rpc('ds_team_invites_for_me');
      hasInvites = Array.isArray(inv) && inv.length > 0;
    }
    return to(callbackDestination({ next: url.searchParams.get('next'), home, odsOn, isMember: !!member, hasProfile: !!profile, hasInvites }));
  }
  return to(safeNext);
}
