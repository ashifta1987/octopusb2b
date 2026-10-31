import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getStaffSecurity, isStaffUser, staffAudit } from '@/lib/staff/server';
import { metaFromHeaders } from '@/lib/staff/request-meta';

/** OAuth / magic-link callback: exchanges the code for a session, then routes to onboarding if no profile. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const staffFlow = url.searchParams.get('staff') === '1';
  const fallback = staffFlow ? '/staff/verify' : '/account';
  const next = url.searchParams.get('next') ?? fallback;
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : fallback;

  if (staffFlow) return staffCallback(req, url, code, safeNext);

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
    const { data: u } = await sb.auth.getUser();
    // staff who used the customer Google button continue in the staff flow (SPEC §17: staff ≠ customer)
    if (await isStaffUser(u.user!.id).catch(() => false)) return NextResponse.redirect(new URL('/staff/verify', url.origin));
    const { data: profile } = await sb.from('profiles').select('id').eq('id', u.user!.id).maybeSingle();
    if (!profile) return NextResponse.redirect(new URL('/onboarding', url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}

/** Staff Google sign-in (SPEC §17.2): only the company Google domain, only existing staff (invitation-only). */
async function staffCallback(req: NextRequest, url: URL, code: string | null, next: string) {
  const fail = (msg: string) => NextResponse.redirect(new URL(`/staff/login?error=${encodeURIComponent(msg)}`, url.origin));
  const oauthError = url.searchParams.get('error_description');
  if (oauthError) return fail(oauthError);
  if (!code) return fail('Google sign-in did not complete. Try again.');

  const sb = await createClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user?.email) {
    await sb.auth.signOut();
    return fail('Google did not share an email address.');
  }

  const email = user.email.toLowerCase();
  const sec = await getStaffSecurity();
  const domain = (sec.google_domain || 'octopusb2b.com').toLowerCase();
  const meta = metaFromHeaders(req.headers);
  const admin = createAdminClient();

  const { data: lock } = await admin.rpc('auth_lock_status', { p_email: email });
  if ((lock as { locked?: boolean } | null)?.locked) {
    await sb.auth.signOut();
    return fail('This account is locked after too many wrong attempts. Try again later or ask an Admin.');
  }

  const domainOk = email.endsWith(`@${domain}`);
  const staff = domainOk && (await isStaffUser(user.id));
  if (!staff) {
    await admin.rpc('auth_record_failure', { p_email: email, p_kind: 'google', p_ip: meta.ip, p_ua: meta.ua });
    await sb.auth.signOut(); // no staff role → no staff session (invitation-only)
    return fail(domainOk
      ? 'This Google account has no staff access. Staff accounts are created by an Admin.'
      : `Use your @${domain} Google account. Not Octopus staff? Use Customer login.`);
  }

  await admin.rpc('auth_record_success', { p_email: email });
  await staffAudit(user.id, 'auth.sign_in', { method: 'google' });
  return NextResponse.redirect(new URL(next.startsWith('/staff/verify') ? next : `/staff/verify?next=${encodeURIComponent(next)}`, url.origin));
}
