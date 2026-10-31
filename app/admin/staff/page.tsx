import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { StaffSecurityForm, type StaffSecuritySettings } from '@/components/admin/staff-security';
import { StepUpNote } from '@/components/admin/step-up';
import { nowMs } from '@/components/admin/server';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  inviteStaff, resendInvite, resetTwoFactor, endSessions, unlockAccount, createStaffWithoutEmail, saveStaffSecurity,
  setUserRoles, setStaffActive, savePermissions, assignSupplier, unassignSupplier,
} from './actions';

export const metadata = { title: 'Staff & roles' };

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
/** Area-specific actions (SPEC §16.4: Backups & restore). */
const AREA_ACTIONS: Record<string, readonly string[]> = { backups: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] };

type SecRow = {
  user_id: string; email: string; last_sign_in_at: string | null; totp_factors: number; active_sessions: number; banned_until: string | null;
  invited_at: string | null; email_confirmed: boolean; locked_until: string | null;
};
type AuthEvent = { id: number; actor_id: string | null; action: string; entity_id: string | null; details: Record<string, unknown> | null; created_at: string };

const DEFAULT_SECURITY: StaffSecuritySettings = {
  enforce_aal2: true, lockout_attempts: 5, lockout_minutes: 15, idle_minutes: 30, max_session_hours: 12, step_up_minutes: 10, trust_hours: 12,
  ip_allowlist: [], ip_rule_roles: ['admin', 'finance'], ip_rule_enabled: false, google_domain: 'octopusb2b.com',
};

const EVENT_LABEL: Record<string, string> = {
  'auth.sign_in': 'Signed in', 'auth.sign_in_failed': 'Sign-in failed', 'auth.password_failed': 'Wrong password', 'auth.totp_failed': 'Wrong 2FA code',
  'auth.backup_code_failed': 'Wrong backup code', 'auth.google_failed': 'Google sign-in refused', 'auth.lockout': 'Account locked', 'auth.unlocked': 'Account unlocked',
  'auth.2fa_enrolled': '2FA set up', 'auth.2fa_verified': '2FA verified', 'auth.2fa_reset': '2FA reset by Admin', 'auth.backup_code_used': 'Backup code used',
  'auth.workspace_switch': 'Workspace switch', 'auth.sign_out': 'Signed out', 'auth.session_expired': 'Session expired', 'auth.sessions_ended': 'Sessions ended',
  'auth.password_reset_requested': 'Password reset requested', 'auth.invite_sent': 'Invitation sent', 'auth.security_settings': 'Security settings changed',
};
const EVENT_TONE: Record<string, 'red' | 'amber' | 'green' | 'blue' | 'gray'> = {
  'auth.lockout': 'red', 'auth.2fa_reset': 'amber', 'auth.security_settings': 'amber', 'auth.sessions_ended': 'amber', 'auth.sign_in': 'green', 'auth.invite_sent': 'blue',
};

/** "Chrome · macOS" from a user agent string (audit device column). */
function deviceLabel(ua: unknown): string {
  if (typeof ua !== 'string' || !ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|curl|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Admin → Staff & roles (Staff.png) + SPEC §17: invitations, 2FA / session columns, security actions, Security panel. */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ role?: string; user?: string }> }) {
  const s = await requireStaff('staff', 'view', '/admin/staff');
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: roles }, { data: areas }, { data: userRoles }, { data: perms }, { data: assignments }, { data: suppliers }, secRes] = await Promise.all([
    sb.from('roles').select('code, name, description, is_staff, sort').order('sort'),
    sb.from('permission_areas').select('code, name, sort').order('sort'),
    sb.from('user_roles').select('user_id, role_code'),
    sb.from('role_permissions').select('role_code, area, action'),
    sb.from('distributor_suppliers').select('distributor_id, supplier_id'),
    sb.from('suppliers').select('id, code, legal_name, country').is('archived_at', null).order('code'),
    sb.rpc('admin_staff_security'),
  ]);
  const staffRoles = (roles ?? []).filter((r) => r.is_staff);
  const staffCodes = new Set(staffRoles.map((r) => r.code));
  const byUser = new Map<string, string[]>();
  (userRoles ?? []).filter((r) => staffCodes.has(r.role_code)).forEach((r) => byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role_code]));
  const ids = [...byUser.keys()];
  const { data: profiles } = ids.length ? await sb.from('profiles').select('id, full_name, email, active, office, invited_at, created_at').in('id', ids) : { data: [] };
  const secById = new Map(((secRes.data ?? []) as SecRow[]).map((r) => [r.user_id, r]));
  const now = nowMs();
  const team = (profiles ?? []).sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name));
  const edit = can(s, 'staff', 'edit');
  const create = can(s, 'staff', 'create');
  const roleMembers = (code: string) => [...byUser.values()].filter((r) => r.includes(code)).length;
  const selRole = staffRoles.find((r) => r.code === sp.role) ?? staffRoles.find((r) => r.code !== 'admin') ?? staffRoles[0];
  const have = new Set((perms ?? []).filter((p) => p.role_code === selRole?.code).map((p) => `${p.area}:${p.action}`));
  const selUser = team.find((t) => t.id === sp.user);
  const distributors = team.filter((t) => byUser.get(t.id)?.includes('distributor'));
  const supById = new Map((suppliers ?? []).map((x) => [x.id, x]));
  const nameById = new Map(team.map((t) => [t.id, t.full_name]));
  const offices = [...new Set(team.map((t) => t.office).filter((o): o is string => !!o))].sort();

  // Security panel (admin only): settings + recent auth events
  let security: StaffSecuritySettings = DEFAULT_SECURITY;
  let events: AuthEvent[] = [];
  const eventNames = new Map<string, string>();
  if (s.isAdmin) {
    const [{ data: setting }, { data: ev }] = await Promise.all([
      sb.from('site_settings').select('value').eq('key', 'staff_security').maybeSingle(),
      sb.from('audit_log').select('id, actor_id, action, entity_id, details, created_at').like('action', 'auth.%').order('created_at', { ascending: false }).limit(50),
    ]);
    security = { ...DEFAULT_SECURITY, ...((setting?.value ?? {}) as Partial<StaffSecuritySettings>) };
    events = (ev ?? []) as AuthEvent[];
    const missing = [...new Set(events.map((e) => e.actor_id).filter((x): x is string => !!x && !nameById.has(x)))];
    if (missing.length) {
      const { data: more } = await sb.from('profiles').select('id, full_name, email').in('id', missing);
      (more ?? []).forEach((p) => eventNames.set(p.id, p.full_name || p.email || p.id.slice(0, 8)));
    }
  }
  const who = (id: string | null) => (id ? nameById.get(id) ?? eventNames.get(id) ?? id.slice(0, 8) : null);

  return (
    <>
      <PageHeader title="Staff & roles" subtitle="Invite your team and decide exactly what each role can see and do."
        actions={create && <a href="#invite" className="btn btn-primary">+ Invite staff member</a>} />
      <StepUpNote minutes={security.step_up_minutes} className="-mt-3 mb-4" />
      {secRes.error && <div className="mb-4"><Notice tone="amber">2FA and session details are unavailable: {secRes.error.message}</Notice></div>}

      <Card title="Team" className="mb-6" action={<span className="mono text-xs text-muted">{team.length} accounts</span>}>
        <Table head={['Name', 'Role', 'Office', 'Two-factor', 'Last sign-in', 'Sessions', 'Status', '']} empty={<EmptyState title="No staff yet" body="Invite your first team member below." />}>
          {team.map((t) => {
            const sec = secById.get(t.id);
            const banned = !!sec?.banned_until && new Date(sec.banned_until).getTime() > now;
            const deactivated = !t.active || banned;
            const locked = !deactivated && !!sec?.locked_until;
            const invited = !deactivated && !locked && sec != null && !sec.email_confirmed;
            const twoFa = (sec?.totp_factors ?? 0) > 0;
            const self = t.id === s.userId;
            const targetIsAdmin = byUser.get(t.id)?.includes('admin') ?? false;
            return (
              <tr key={t.id} className={cn(selUser?.id === t.id && 'bg-blue-soft', deactivated && 'opacity-70')}>
                <td className="td">
                  <div className="font-semibold">{t.full_name}{self && <span className="text-xs text-muted"> (you)</span>}</div>
                  <div className="mono text-sm text-muted break-all">{t.email ?? sec?.email}</div>
                </td>
                <td className="td"><span className="flex flex-wrap gap-1">{(byUser.get(t.id) ?? []).map((r) => <StatusBadge key={r} status={r} tone="blue" label={staffRoles.find((x) => x.code === r)?.name ?? r} />)}</span></td>
                <td className="td text-sm">{t.office ?? <span className="text-muted">—</span>}</td>
                <td className="td text-sm">
                  {!sec ? '—' : twoFa ? <StatusBadge status="on" tone="green" label="On" /> : <StatusBadge status="not_set_up" tone="amber" label="Not set up" />}
                </td>
                <td className="td text-sm text-muted">{sec?.last_sign_in_at ? fmtDate(sec.last_sign_in_at, true) : 'Never'}</td>
                <td className="td text-sm mono">{sec ? sec.active_sessions : '—'}</td>
                <td className="td">
                  {deactivated ? <StatusBadge status="off" tone="gray" label="Deactivated" />
                    : locked ? <StatusBadge status="locked" tone="red" label={`Locked until ${fmtDate(sec!.locked_until, true)}`} />
                      : invited ? <span className="flex flex-col items-start gap-0.5"><StatusBadge status="invited" tone="blue" label="Invited" />{t.invited_at && <span className="text-xs text-muted">{fmtDate(t.invited_at)}</span>}</span>
                        : <StatusBadge status="active" label="Active" />}
                </td>
                <td className="td">
                  <span className="flex flex-wrap gap-2 justify-end max-w-[360px] ml-auto">
                    <Link href={`/admin/staff?user=${t.id}${selRole ? `&role=${selRole.code}` : ''}#edit-user`} className="btn btn-ghost btn-sm">Edit</Link>
                    {create && invited && <RunButton confirm={`Send the invitation to ${t.email} again? The new link is valid for 24 hours.`} action={resendInvite.bind(null, t.id)}>Resend invite</RunButton>}
                    {edit && locked && sec && <RunButton confirm={`Unlock ${t.full_name}'s account now?`} action={unlockAccount.bind(null, sec.email)}>Unlock</RunButton>}
                    {s.isAdmin && !self && twoFa && !deactivated && (
                      <RunButton prompt={`Reset 2FA for ${t.full_name}? Their authenticator and backup codes are removed and they are signed out. Reason (required, logged):`} action={resetTwoFactor.bind(null, t.id)}>Reset 2FA</RunButton>
                    )}
                    {edit && !self && (sec?.active_sessions ?? 0) > 0 && (
                      <RunButton confirm={`Sign ${t.full_name} out of every device now?`} action={endSessions.bind(null, t.id)}>End sessions</RunButton>
                    )}
                    {edit && !self && (!targetIsAdmin || s.isAdmin) && (
                      <RunButton className={cn('btn btn-ghost btn-sm', !deactivated && 'text-bad')}
                        confirm={deactivated ? `Reactivate ${t.full_name}? They can sign in again (with 2FA).` : `Deactivate ${t.full_name}? All their sessions end now and they cannot sign in.`}
                        action={setStaffActive.bind(null, t.id, deactivated)}>
                        {deactivated ? 'Reactivate' : 'Deactivate'}
                      </RunButton>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {selUser && (
        <div id="edit-user" className="mb-6">
          <Card title={`Roles · ${selUser.full_name}`} action={<Link href="/admin/staff" className="text-sm text-blue">Close</Link>}>
            <ActionForm key={selUser.id} action={setUserRoles} className="px-6 pb-6" submitLabel="Save roles" hideSubmit={!edit} confirm="Update this person's roles? You may be asked for your 2FA code.">
              <input type="hidden" name="user_id" value={selUser.id} />
              <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <legend className="sr-only">Roles</legend>
                {staffRoles.map((r) => (
                  <label key={r.code} className="flex items-start gap-2 rounded-[8px] border border-line p-3">
                    <input type="checkbox" name="roles" value={r.code} defaultChecked={byUser.get(selUser.id)?.includes(r.code)} disabled={!edit || (r.code === 'admin' && !s.isAdmin)} className="mt-1" />
                    <span><span className="font-semibold block">{r.name}</span><span className="text-xs text-muted">{r.description}</span></span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted mt-3">Role changes ask for your 2FA code again if it is older than {security.step_up_minutes} minutes.</p>
            </ActionForm>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr] mb-6">
        <Card className="self-start overflow-hidden">
          <div className="px-5 py-4 border-b border-line"><h2 className="font-semibold text-lg">Roles</h2></div>
          <ul>
            {staffRoles.map((r) => (
              <li key={r.code}>
                <Link href={`/admin/staff?role=${r.code}`} aria-current={selRole?.code === r.code ? 'true' : undefined}
                  className={cn('block px-5 py-3 border-b border-line last:border-0', selRole?.code === r.code ? 'bg-blue-soft border-l-4 border-l-blue' : 'hover:bg-surface')}>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-muted">{roleMembers(r.code)} member{roleMembers(r.code) === 1 ? '' : 's'} · {r.code === 'admin' ? 'full access' : r.description}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {selRole && (
          <Card>
            <div className="px-6 pt-5">
              <h2 className="text-lg font-semibold">Permissions · {selRole.name}</h2>
              <p className="text-sm text-muted">{selRole.code === 'admin' ? 'Admin always has every permission (implicit).' : 'Tick what this role can do in each area.'}</p>
            </div>
            <ActionForm key={selRole.code} action={savePermissions} className="px-6 pb-6 pt-3" submitLabel="Save permissions" hideSubmit={!edit || selRole.code === 'admin'} confirm={`Save the permission matrix for ${selRole.name}?`}>
              <input type="hidden" name="role" value={selRole.code} />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr><th className="th">Area</th>{ACTIONS.map((a) => <th key={a} className="th text-center">{a}</th>)}</tr></thead>
                  <tbody>
                    {(areas ?? []).filter((ar) => !AREA_ACTIONS[ar.code]).map((ar) => (
                      <tr key={ar.code}>
                        <td className="td font-semibold">{ar.name}</td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="td text-center">
                            <input type="checkbox" name="perm" value={`${ar.code}:${a}`} aria-label={`${ar.name}: ${a}`} className="w-5 h-5"
                              defaultChecked={selRole.code === 'admin' || have.has(`${ar.code}:${a}`)} disabled={!edit || selRole.code === 'admin'} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(areas ?? []).filter((ar) => AREA_ACTIONS[ar.code]).map((ar) => (
                <fieldset key={ar.code} className="mt-5 border border-line rounded-[10px] p-4">
                  <legend className="px-1 font-semibold">{ar.name}</legend>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {AREA_ACTIONS[ar.code].map((a) => (
                      <label key={a} className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" name="perm" value={`${ar.code}:${a}`} className="w-5 h-5"
                          defaultChecked={selRole.code === 'admin' || have.has(`${ar.code}:${a}`)} disabled={!edit || selRole.code === 'admin'} />
                        {a.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <p className="text-xs text-muted mt-3">Permission changes take effect on the staff member&apos;s next page load and are recorded in the audit log. Saving asks for your 2FA code if it is older than {security.step_up_minutes} minutes.</p>
            </ActionForm>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {create && (
          <div id="invite">
            <Card title="Invite staff member">
              <ActionForm action={inviteStaff} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Send invitation" resetOnSuccess confirm="Send this invitation? The person gets an email with a link to set a password (valid 24 hours).">
                <Field label="Full name" htmlFor="inv-name"><input id="inv-name" name="full_name" className="input" required autoComplete="off" /></Field>
                <Field label="Work email" htmlFor="inv-email"><input id="inv-email" name="email" type="email" className="input" required autoComplete="off" placeholder="name@octopusb2b.com" /></Field>
                <Field label="Office" htmlFor="inv-office" hint="e.g. Shenzhen office" className="sm:col-span-2">
                  <input id="inv-office" name="office" className="input" list="inv-offices" maxLength={120} />
                  <datalist id="inv-offices">{offices.map((o) => <option key={o} value={o} />)}</datalist>
                </Field>
                <fieldset className="sm:col-span-2">
                  <legend className="label">Roles</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {staffRoles.map((r) => (
                      <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roles" value={r.code} disabled={r.code === 'admin' && !s.isAdmin} /> {r.name}</label>
                    ))}
                  </div>
                </fieldset>
                <p className="sm:col-span-2 text-xs text-muted">Staff accounts are invitation-only. The invite link expires after 24 hours (use &quot;Resend invite&quot; if it lapses). Two-step verification is set up at first sign-in. Customer emails cannot be invited.</p>
              </ActionForm>
              {s.isAdmin && (
                <details className="px-6 pb-6 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-muted">Advanced: create without email</summary>
                  <p className="text-xs text-muted mt-2">Only for environments where email sending is not set up. You must share the temporary password securely; the person still sets up 2FA at first sign-in.</p>
                  <ActionForm action={createStaffWithoutEmail} className="grid gap-4 sm:grid-cols-2 mt-3" submitLabel="Create account" submitClass="btn btn-ghost" resetOnSuccess confirm="Create this staff account with a temporary password (no invitation email)?">
                    <Field label="Full name" htmlFor="adv-name"><input id="adv-name" name="full_name" className="input" required autoComplete="off" /></Field>
                    <Field label="Work email" htmlFor="adv-email"><input id="adv-email" name="email" type="email" className="input" required autoComplete="off" /></Field>
                    <Field label="Office" htmlFor="adv-office"><input id="adv-office" name="office" className="input" list="inv-offices" maxLength={120} /></Field>
                    <Field label="Temporary password" htmlFor="adv-pass" hint="Optional (12+ chars). Leave empty to generate one."><input id="adv-pass" name="password" type="text" className="input mono" autoComplete="off" minLength={12} maxLength={72} /></Field>
                    <fieldset className="sm:col-span-2">
                      <legend className="label">Roles</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {staffRoles.map((r) => <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roles" value={r.code} /> {r.name}</label>)}
                      </div>
                    </fieldset>
                  </ActionForm>
                </details>
              )}
            </Card>
          </div>
        )}

        <Card title="Distributor ↔ supplier assignments">
          {!can(s, 'suppliers', 'view') ? <div className="px-6 pb-6"><Notice>Needs the Suppliers · view permission.</Notice></div> : (
            <>
              <Table head={['Distributor', 'Supplier', '']} empty={<EmptyState title="No assignments yet" />}>
                {(assignments ?? []).map((a) => {
                  const sup = supById.get(a.supplier_id);
                  return (
                    <tr key={a.distributor_id + a.supplier_id}>
                      <td className="td font-semibold">{nameById.get(a.distributor_id) ?? a.distributor_id.slice(0, 8)}</td>
                      <td className="td">{sup ? `${sup.code} · ${sup.legal_name}` : '—'}</td>
                      <td className="td text-right">{can(s, 'suppliers', 'edit') && <RunButton confirm="Remove this assignment? The distributor loses access to this supplier." action={unassignSupplier.bind(null, a.distributor_id, a.supplier_id)}>Remove</RunButton>}</td>
                    </tr>
                  );
                })}
              </Table>
              {can(s, 'suppliers', 'edit') && (
                <ActionForm action={assignSupplier} className="px-6 py-5 border-t border-line grid gap-3 sm:grid-cols-2" submitLabel="Assign">
                  <Field label="Distributor" htmlFor="as-d">
                    <select id="as-d" name="distributor_id" className="input" required defaultValue=""><option value="" disabled>Select…</option>{distributors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select>
                  </Field>
                  <Field label="Supplier" htmlFor="as-s">
                    <select id="as-s" name="supplier_id" className="input" required defaultValue=""><option value="" disabled>Select…</option>{(suppliers ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.legal_name}</option>)}</select>
                  </Field>
                  {distributors.length === 0 && <p className="sm:col-span-2 text-sm text-muted">No users have the Distributor role yet.</p>}
                </ActionForm>
              )}
            </>
          )}
        </Card>
      </div>

      {s.isAdmin && (
        <div id="security" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Security" action={<span className="text-xs text-muted">Admin only</span>}>
            <p className="px-6 -mt-1 mb-4 text-sm text-muted">Lockout, session and office IP rules for every staff sign-in (SPEC §17.3).</p>
            <StaffSecurityForm settings={security} action={saveStaffSecurity} />
          </Card>
          <Card title="Recent security events" className="self-start" action={<span className="mono text-xs text-muted">last {events.length}</span>}>
            <Table head={['Time', 'User', 'Event', 'IP', 'Device']} empty={<EmptyState title="No sign-in events yet" />}>
              {events.map((e) => {
                const d = e.details ?? {};
                const actor = who(e.actor_id);
                const subject = typeof d.target === 'string' ? who(d.target) : null;
                return (
                  <tr key={e.id}>
                    <td className="td text-sm whitespace-nowrap">{fmtDate(e.created_at, true)}</td>
                    <td className="td text-sm">
                      <div className="font-semibold">{actor ?? <span className="text-muted">Unknown</span>}</div>
                      {!e.actor_id && e.entity_id && <div className="mono text-xs text-muted break-all">{e.entity_id}</div>}
                      {subject && subject !== actor && <div className="text-xs text-muted">→ {subject}</div>}
                    </td>
                    <td className="td"><StatusBadge status={e.action} tone={EVENT_TONE[e.action] ?? (/failed$/.test(e.action) ? 'amber' : 'gray')} label={EVENT_LABEL[e.action] ?? e.action.replace(/^auth\./, '').replace(/_/g, ' ')} /></td>
                    <td className="td mono text-xs">{typeof d.ip === 'string' && d.ip ? d.ip : '—'}</td>
                    <td className="td text-xs text-muted" title={typeof d.device === 'string' ? d.device : undefined}>{deviceLabel(d.device)}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
