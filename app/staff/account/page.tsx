import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PortalShell } from '@/components/portal-shell';
import { DISTRIBUTOR_NAV, OFFICE_NAV } from '@/lib/nav';
import { PageHeader } from '@/components/ui';
import { fmtDate, humanize } from '@/lib/format';
import { staffSignOut } from '@/lib/staff/actions';
import { ToggleSetting } from '@/components/admin/client';
import { ProfileForm, PasswordForm, BackupCodesButton, SignOutEverywhere, AuthenticatorDevices } from './account-forms';
import { setMyOutOfOffice } from './actions';

export const metadata = { title: 'My account · Staff' };

async function AccountBody() {
  const s = await getSession();
  if (!s) redirect('/staff/login?next=/staff/account');
  if (!s.isStaff) redirect('/login');
  const sb = await createClient();
  const [{ data: prof }, { data: factors }, { count: unused }, { data: sessions }] = await Promise.all([
    sb.from('profiles').select('full_name, phone, office, email, team, out_of_office').eq('id', s.userId).maybeSingle(),
    sb.auth.mfa.listFactors(),
    sb.from('staff_backup_codes').select('id', { count: 'exact', head: true }).eq('user_id', s.userId).is('used_at', null),
    sb.rpc('my_active_sessions'),
  ]);
  const totp = (factors?.totp ?? []).filter((f) => f.status === 'verified');
  const nav = s.roles.every((r) => r === 'distributor') ? DISTRIBUTOR_NAV : OFFICE_NAV;

  return (
    <PortalShell session={s} nav={nav} roleLabel={s.roles.map((r) => humanize(r)).join(', ')} searchPlaceholder="Search orders, RFQs, tickets">
      <PageHeader title="My account" subtitle={`${s.email ?? ''}${prof?.office ? ` · ${prof.office}` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6 scroll-mt-6" id="profile">
          <h2 className="text-lg font-semibold mb-4">Profile</h2>
          <ProfileForm fullName={prof?.full_name ?? ''} phone={prof?.phone ?? ''} />
          <p className="text-[13px] text-muted mt-4">Role: {s.roles.map((r) => humanize(r)).join(', ') || '—'}. Roles and office are set by an Admin in Staff &amp; roles.</p>
        </section>

        <section className="card p-6 scroll-mt-6" id="availability">
          <h2 className="text-lg font-semibold mb-1">Availability</h2>
          <p className="text-[13px] text-muted mb-4">
            While you are out of office, customers Octo hands over to you go to the {prof?.team ? `${prof.team} team` : 'team'} queue instead. You get them back when you turn this off.
          </p>
          <span className="inline-flex items-center gap-3">
            <span className="font-semibold text-sm">Out of office</span>
            <ToggleSetting checked={!!prof?.out_of_office} label="Out of office" onToggle={setMyOutOfOffice} showText />
          </span>
        </section>

        <section className="card p-6 scroll-mt-6" id="password">
          <h2 className="text-lg font-semibold mb-1">Change password</h2>
          <p className="text-[13px] text-muted mb-4">You will be asked for a fresh 6-digit code if your last one is older than 10 minutes.</p>
          <PasswordForm />
        </section>

        <section className="card p-6 scroll-mt-6" id="2fa">
          <h2 className="text-lg font-semibold mb-1">Two-step verification</h2>
          <p className="text-[13px] text-muted mb-4">Required for every staff sign-in. You can link more than one phone. Lost your phone? Use a backup code or ask an Admin to reset it.</p>
          {totp.length === 0 ? (
            <p className="text-sm mb-4">No authenticator set up yet. You will be asked to set one up at your next sign-in.</p>
          ) : (
            <div className="mb-4">
              <AuthenticatorDevices devices={totp.map((f) => ({ id: f.id, name: f.friendly_name || 'Authenticator app', added: fmtDate(f.created_at) }))} />
              <p className="text-[12.5px] text-muted mt-2">Each phone gets its own entry, so you can remove a lost phone without touching the others. Up to 5 phones.</p>
            </div>
          )}
          <p className="text-sm mb-3">Backup codes left: <strong>{unused ?? 0}</strong> of 10</p>
          <BackupCodesButton email={s.email ?? ''} disabled={totp.length === 0} />
        </section>

        <section className="card p-6 scroll-mt-6" id="sessions">
          <h2 className="text-lg font-semibold mb-1">Sessions</h2>
          <p className="text-[13px] text-muted mb-4">Sessions end after 30 minutes idle or 12 hours in total.</p>
          <p className="text-sm mb-4">Active sessions: <strong>{typeof sessions === 'number' ? sessions : '—'}</strong></p>
          <div className="flex flex-wrap gap-3">
            <SignOutEverywhere />
            <form action={staffSignOut}><button type="submit" className="btn btn-ghost">Sign out</button></form>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}

/** Staff account (SPEC §17): profile, change password (step-up), 2FA devices + backup codes, sessions. */
export default function StaffAccountPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-pearl" />}>
      <AccountBody />
    </Suspense>
  );
}
