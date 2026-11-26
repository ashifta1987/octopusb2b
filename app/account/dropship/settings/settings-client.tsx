'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTextarea,
} from '@/components/dropship-ui';
import type { NotificationEvent, SettingsPageData } from '@/lib/dropship-ds12';
import { NOTIFICATION_LABELS, ROLE_LABELS, fmtDate } from '@/lib/dropship-ds12-shared';
import {
  cancelInviteAction, closeDropshippingAction, inviteAction, removeLogoAction, removeMemberAction, saveSettingsAction, savePrefsAction, setRoleAction, uploadLogoAction,
} from '../ds12-actions';

/**
 * Release 5 · Step 13 — Settings screen (screens/Settings.html, mobile/M_Settings.html): Profile · Team · Notifications ·
 * Branding · Policies · Data · Close dropshipping. Every disabled control says why next to it; the database checks the team
 * role again for every action.
 */

const ZONES = ['UTC', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Amsterdam', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'Australia/Sydney'];
const SECTIONS = [['profile', 'Profile'], ['team', 'Team'], ['notifications', 'Notifications'], ['branding', 'Branding'], ['policies', 'Policies'], ['data', 'Data'], ['close', 'Close dropshipping']] as const;

type Notice = { tone: 'ok' | 'bad' | 'warn' | 'info'; title: string; text?: string; where: string } | null;

export function SettingsClient({ data, countryName, emailLive, ordersOn }: { data: SettingsPageData; countryName: string | null; emailLive: boolean; ordersOn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const isOwner = data.my_role === 'owner';
  const canBrand = data.my_role === 'owner' || data.my_role === 'manager';
  const closed = data.dropship_status === 'off';
  const [tz, setTz] = useState(data.profile.time_zone);
  const [returns, setReturns] = useState(data.policies.returns_policy ?? '');
  const [mail, setMail] = useState(data.policies.support_email ?? '');
  const [slip, setSlip] = useState(data.branding.show_logo_slip);
  const [track, setTrack] = useState(data.branding.show_logo_tracking);
  const [prefs, setPrefs] = useState(data.prefs);
  const [inviteMail, setInviteMail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'support'>('manager');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];
  const brandReason = closed ? 'Dropshipping is closed for your company.' : !canBrand ? 'Only the owner or a manager can change this.' : null;

  const show = (where: string, r: { ok: boolean; message?: string }, okTitle: string, okText?: string) =>
    setNotice(r.ok ? { tone: 'ok', title: okTitle, text: okText, where } : { tone: 'bad', title: 'Not saved', text: r.message, where });
  const run = (fn: () => Promise<void>) => { setNotice(null); start(async () => { await fn(); router.refresh(); }); };
  const noticeAt = (where: string) =>
    notice && notice.where === where ? <DsNotice tone={notice.tone} title={notice.title} testId={`settings-notice-${where}`}>{notice.text}</DsNotice> : null;

  function saveAll() {
    run(async () => show('top', await saveSettingsAction({ time_zone: tz, returns_policy: returns, support_email: mail, show_logo_slip: slip, show_logo_tracking: track }), 'Settings saved'));
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-settings-page">
      <DsPageHeader title="Settings" icon="gear" subtitle="Account, team, notifications, branding and policies for dropshipping."
        actions={<DsButton icon="check" loading={pending} disabled={Boolean(brandReason)} disabledReason={brandReason ?? undefined} onClick={saveAll} testId="settings-save">Save changes</DsButton>} />
      {noticeAt('top')}
      {closed && <DsNotice tone="info" title="Dropshipping is closed" testId="settings-closed">Your wallet, invoices, statements, support and data export stay available. Contact support to start again.</DsNotice>}

      <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-line px-3.5 min-h-[44px] inline-flex items-center text-[14px] text-ink no-underline hover:bg-pearl">{label}</a>
        ))}
      </nav>

      <section id="profile" aria-labelledby="profile-h" className="ds-card flex flex-col gap-4" data-testid="settings-profile">
        <h2 id="profile-h" className="m-0 text-[17px] font-semibold text-ink">Profile</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DsInput id="set-company" label="Company" value={data.org.name} readOnly hint="Your company name comes from your Octopus account." />
          <DsInput id="set-country" label="Country" value={countryName ?? 'Not set'} readOnly hint="Set in your company verification (KYC)." />
          <DsSelect id="set-currency" label="Show amounts in" value="USD" onChange={() => undefined} hint="Your wallet is in USD; other currencies come with the daily exchange-rate feed.">
            <option value="USD">USD (wallet currency)</option>
          </DsSelect>
          <DsSelect id="set-tz" label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} disabled={Boolean(brandReason)}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </DsSelect>
        </div>
      </section>

      <section id="team" aria-labelledby="team-h" className="ds-card !p-0 overflow-hidden" data-testid="settings-team">
        <div className="px-5 pt-4 pb-3 flex flex-col gap-1">
          <h2 id="team-h" className="m-0 text-[17px] font-semibold text-ink">Team</h2>
          <p className="m-0 text-[13px] text-muted">Each person signs in with their own login. Nobody shares a password.</p>
        </div>
        {noticeAt('team')}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Team members">
          <table className="w-full min-w-[640px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted">
              <tr><th scope="col" className="px-5 py-2.5 font-medium">Name</th><th scope="col" className="px-3 py-2.5 font-medium">Email</th><th scope="col" className="px-3 py-2.5 font-medium">Role</th><th scope="col" className="px-3 py-2.5 font-medium">Can do</th><th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {data.team.map((m) => (
                <tr key={m.user_id} className="border-t border-divider" data-testid={`member-${m.email ?? m.user_id}`}>
                  <td className="px-5 py-2.5 text-ink">{m.name ?? '—'}{m.is_me ? ' (you)' : ''}</td>
                  <td className="px-3 py-2.5">{m.email ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {isOwner && !m.is_me && !closed ? (
                      <label className="inline-flex items-center gap-2">
                        <span className="sr-only">Role for {m.name ?? m.email}</span>
                        <select className="ds-input min-h-[44px]" value={m.ds_role} onChange={(e) => run(async () => show('team', await setRoleAction(m.user_id, e.target.value as 'owner' | 'manager' | 'support'), 'Role changed'))}>
                          <option value="owner">Owner</option><option value="manager">Manager</option><option value="support">Support</option>
                        </select>
                      </label>
                    ) : ROLE_LABELS[m.ds_role].label}
                  </td>
                  <td className="px-3 py-2.5 text-black">{ROLE_LABELS[m.ds_role].can}</td>
                  <td className="px-5 py-2.5 text-right">
                    {isOwner && !m.is_me && m.ds_role !== 'owner' && !closed
                      ? <DsButton variant="link" onClick={() => run(async () => show('team', await removeMemberAction(m.user_id), 'Removed from your team'))}>Remove<span className="sr-only"> {m.name ?? m.email}</span></DsButton>
                      : <span aria-hidden="true">—</span>}
                  </td>
                </tr>
              ))}
              {data.invites.map((i) => (
                <tr key={i.id} className="border-t border-divider" data-testid={`invite-${i.email}`}>
                  <td className="px-5 py-2.5 text-muted">Invited</td>
                  <td className="px-3 py-2.5">{i.email}</td>
                  <td className="px-3 py-2.5">{ROLE_LABELS[i.ds_role].label}</td>
                  <td className="px-3 py-2.5 text-muted">Waiting until {fmtDate(i.expires_at)}</td>
                  <td className="px-5 py-2.5 text-right"><DsButton variant="link" onClick={() => run(async () => show('team', await cancelInviteAction(i.id), 'Invitation cancelled'))}>Cancel<span className="sr-only"> invitation for {i.email}</span></DsButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="px-5 py-4 border-t border-divider grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end"
          onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await inviteAction(inviteMail, inviteRole); show('team', r, 'Invitation saved', `Ask ${inviteMail} to sign in (or sign up) with this email, then open ${typeof window === 'undefined' ? '' : window.location.origin}/account/dropship/join. Invitation emails start when app email is set up.`); if (r.ok) setInviteMail(''); }); }}>
          <DsInput id="invite-email" type="email" label="Email" value={inviteMail} onChange={(e) => setInviteMail(e.target.value)} disabled={!isOwner || closed} required />
          <DsSelect id="invite-role" label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'manager' | 'support')} disabled={!isOwner || closed}>
            <option value="manager">Manager</option><option value="support">Support</option>
          </DsSelect>
          <DsButton type="submit" variant="secondary" icon="plus" loading={pending} disabled={!isOwner || closed || !inviteMail}
            disabledReason={!isOwner ? 'Only the account owner invites members.' : closed ? 'Dropshipping is closed.' : !inviteMail ? 'Enter an email first.' : undefined} testId="invite-submit">Invite member</DsButton>
        </form>
      </section>

      <section id="notifications" aria-labelledby="notif-h" className="ds-card !p-0 overflow-hidden" data-testid="settings-notifications">
        <h2 id="notif-h" className="m-0 px-5 pt-4 pb-3 text-[17px] font-semibold text-ink">Notifications</h2>
        {noticeAt('notifications')}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Notification choices">
          <table className="w-full min-w-[480px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted">
              <tr><th scope="col" className="px-5 py-2.5 font-medium">Event</th><th scope="col" className="px-3 py-2.5 font-medium">Email</th><th scope="col" className="px-5 py-2.5 font-medium">In the app</th></tr>
            </thead>
            <tbody>
              {prefs.map((p, idx) => (
                <tr key={p.event} className="border-t border-divider">
                  <td className="px-5 py-2 text-ink">{NOTIFICATION_LABELS[p.event]}</td>
                  <td className="px-3 py-2"><DsCheckbox label={<span className="sr-only">Email: {NOTIFICATION_LABELS[p.event]}</span>} checked={p.email} disabled={!emailLive}
                    onChange={(e) => setPrefs(prefs.map((x, j) => (j === idx ? { ...x, email: e.target.checked } : x)))} /></td>
                  <td className="px-5 py-2"><DsCheckbox label={<span className="sr-only">In the app: {NOTIFICATION_LABELS[p.event]}</span>} checked={p.in_app}
                    onChange={(e) => setPrefs(prefs.map((x, j) => (j === idx ? { ...x, in_app: e.target.checked } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-divider flex flex-wrap items-center gap-3">
          <DsButton variant="secondary" loading={pending} testId="prefs-save"
            onClick={() => run(async () => show('notifications', await savePrefsAction(prefs.map((p) => ({ event: p.event as NotificationEvent, email: p.email, in_app: p.in_app }))), 'Notification choices saved'))}>Save notifications</DsButton>
          <p className="m-0 text-[13px] text-muted">{emailLive ? 'Email goes to your sign-in address.' : 'Email starts when app email is set up. Until then, everything arrives in the app.'}</p>
        </div>
      </section>

      <section id="branding" aria-labelledby="brand-h" className="ds-card flex flex-col gap-4" data-testid="settings-branding">
        <h2 id="brand-h" className="m-0 text-[17px] font-semibold text-ink">Branding</h2>
        {noticeAt('branding')}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <DsInput id="brand-name" label="Brand name on parcels" value={data.branding.brand_name ?? ''} readOnly placeholder="Not set yet"
              hint={<>Shown on packing slips and the tracking page. Changing it needs a new staff check: <Link href="/account/dropship/onboarding" className="text-coral-text underline">change in setup</Link>.</>} />
            {data.branding.profile_status && <span><DsBadge tone={data.branding.profile_status === 'approved' ? 'ok' : 'warn'}>{data.branding.profile_status === 'approved' ? 'Approved' : 'Waiting for staff check'}</DsBadge></span>}
          </div>
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => show('branding', await uploadLogoAction(fd), 'Logo uploaded')); }}>
            <label htmlFor="brand-logo" className="text-[14px] font-medium text-ink">Logo</label>
            <input id="brand-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(brandReason)} className="text-[14px] min-h-[44px]" aria-describedby="brand-logo-hint" />
            <p id="brand-logo-hint" className="m-0 text-[13px] text-muted">PNG, JPG or WEBP, up to 1 MB. {data.branding.has_logo ? 'A logo is saved.' : 'No logo yet.'}</p>
            <div className="flex flex-wrap gap-2">
              <DsButton type="submit" variant="secondary" icon="upload" loading={pending} disabled={Boolean(brandReason)} disabledReason={brandReason ?? undefined} testId="logo-upload">Upload</DsButton>
              {data.branding.has_logo && <DsButton variant="link" disabled={Boolean(brandReason)} onClick={() => run(async () => show('branding', await removeLogoAction(), 'Logo removed'))}>Remove logo</DsButton>}
            </div>
          </form>
        </div>
        <div className="flex flex-col gap-2">
          <DsCheckbox label="Show my logo on packing slips" checked={slip} disabled={!data.branding.has_logo || Boolean(brandReason)} onChange={(e) => setSlip(e.target.checked)}
            hint={!data.branding.has_logo ? 'Upload a logo first.' : undefined} />
          <DsCheckbox label="Show my logo on the tracking page" checked={track} disabled={!data.branding.has_logo || Boolean(brandReason)} onChange={(e) => setTrack(e.target.checked)}
            hint={!data.branding.has_logo ? 'Upload a logo first.' : undefined} />
          <p className="m-0 text-[13px] text-muted">Want printed mailers, cards or stickers? <Link href="/account/brand" className="text-coral-text underline">Make it your brand with Make My Brand</Link>.</p>
        </div>
      </section>

      <section id="policies" aria-labelledby="pol-h" className="ds-card flex flex-col gap-4" data-testid="settings-policies">
        <h2 id="pol-h" className="m-0 text-[17px] font-semibold text-ink">Policies shown to buyers</h2>
        <DsTextarea id="pol-returns" label="Returns policy (tracking page and packing slip)" value={returns} onChange={(e) => setReturns(e.target.value)} rows={3} maxLength={1000}
          disabled={Boolean(brandReason)} hint="Your store's words. Don't name Octopus or a supplier." />
        <DsInput id="pol-email" type="email" label="Support email shown to buyers" value={mail} onChange={(e) => setMail(e.target.value)} disabled={Boolean(brandReason)} />
        {!ordersOn && <p className="m-0 text-[13px] text-muted">Buyers see these once store orders are switched on.</p>}
      </section>

      <section id="data" aria-labelledby="data-h" className="ds-card flex flex-col gap-4" data-testid="settings-data">
        <h2 id="data-h" className="m-0 text-[17px] font-semibold text-ink">Data</h2>
        <dl className="m-0 grid grid-cols-1 md:grid-cols-2 gap-4 text-[14px]">
          <div><dt className="font-medium text-ink">Buyer names and addresses</dt>
            <dd className="m-0 text-black" data-testid="data-retention">{data.buyer_data_days != null ? `Deleted ${data.buyer_data_days} days after delivery, except what invoices must keep.` : 'Automatic deletion after delivery starts with the store connection (except what invoices must keep).'}</dd></div>
          <div><dt className="font-medium text-ink">Your data export</dt>
            <dd className="m-0 text-black">CSV of products, orders and invoices</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <DsLinkButton href="/account/dropship/export" variant="secondary" icon="download" testId="dropship-data-export-link">Export my data</DsLinkButton>
          <DsLinkButton href="/account/dropship/export/csv?kind=products" variant="link" icon="download" testId="export-products">Products CSV</DsLinkButton>
          <DsLinkButton href="/account/dropship/export/csv?kind=orders" variant="link" icon="download" testId="export-orders">Orders CSV</DsLinkButton>
          <DsLinkButton href="/account/dropship/export/csv?kind=invoices" variant="link" icon="download" testId="export-invoices">Invoices CSV</DsLinkButton>
        </div>
      </section>

      <section id="close" aria-labelledby="close-h" className="ds-card flex flex-col gap-3" data-testid="settings-close">
        <h2 id="close-h" className="m-0 text-[17px] font-semibold text-ink">Close dropshipping</h2>
        <p className="m-0 text-[14px] text-black">Disconnects your stores and stops syncing. Open orders are finished first. Your wallet balance stays in your Octopus account, and invoices are kept as the law requires.</p>
        {noticeAt('close')}
        {!confirmOpen ? (
          <div><DsButton variant="danger" disabled={!isOwner || closed} disabledReason={closed ? 'Dropshipping is already closed.' : !isOwner ? 'Only the account owner can close dropshipping.' : undefined}
            onClick={() => setConfirmOpen(true)} testId="close-open">Close dropshipping</DsButton></div>
        ) : (
          <div className="rounded-xl border border-bad/30 bg-bad-bg p-4 flex flex-col gap-3" role="group" aria-labelledby="close-confirm-h">
            <h3 id="close-confirm-h" className="m-0 text-[15px] font-semibold text-ink">Close dropshipping for {data.org.name}?</h3>
            <p className="m-0 text-[14px] text-black">New imports, pushes and order charges stop. Paid orders keep shipping. You keep your wallet, statements, invoices, support and data export.</p>
            <DsInput id="close-confirm" label="Type CLOSE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            <div className="flex flex-wrap gap-2">
              <DsButton variant="danger" loading={pending} disabled={confirmText.trim().toUpperCase() !== 'CLOSE'} disabledReason={confirmText.trim().toUpperCase() !== 'CLOSE' ? 'Type CLOSE first.' : undefined}
                testId="close-confirm-submit"
                onClick={() => run(async () => { const r = await closeDropshippingAction(confirmText); show('close', r, 'Dropshipping closed', r.ok ? `${r.data.open_orders} paid order${r.data.open_orders === 1 ? '' : 's'} still finish shipping.` : undefined); if (r.ok) setConfirmOpen(false); })}>Close dropshipping</DsButton>
              <DsButton variant="secondary" onClick={() => { setConfirmOpen(false); setConfirmText(''); }}>Keep dropshipping</DsButton>
            </div>
          </div>
        )}
      </section>

      <DsCard title="Statements and invoices" icon="file">
        <p className="m-0 text-[13px] text-muted mb-3">Weekly STMT-DS statements, OCT-DS invoices and credit notes.</p>
        <DsLinkButton href="/account/invoices" variant="secondary" icon="file">View statements &amp; invoices</DsLinkButton>
      </DsCard>
    </div>
  );
}
