'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Lock, UserPlus } from 'lucide-react';
import { Button, Drawer, EmptyState, FilterPills, Icon, OctopusDataGrid, StatusPill, cx, formatDate, type GridColumn } from '@octopus/ui';
import type { StaffData, StaffMember } from '../_lib/admin-c-data';
import { MATRIX_ACTIONS } from '../_lib/admin-c-core';
import { DIVISION_ROLES } from '@/lib/divisions/shared';
import { ConfirmRun, type ActionResult } from './accounts-a-actions';
import { AdminForm as ActionFormOds } from './admin-c-form';
import { LocalTime, Panel } from './dashboard';

/**
 * ODS T9 · /admin/staff — Staff & roles. Team grid + edit drawer (roles, security actions, divisions), roles and the
 * permission matrix, invite, distributor ↔ supplier assignments and (admin) security settings + events. Every change
 * goes through TODAY's server actions in app/admin/staff/actions.ts, unchanged: they keep their guards, the fresh-2FA
 * (step-up) check for role / permission / division changes and the audit log. Inactive people: neutral pill + slate text
 * (token colours), never opacity.
 */

type R = ActionResult;
type FormAction = (prev: R | null, fd: FormData) => Promise<R>;
export type StaffActions = {
  inviteStaff: FormAction; createStaffWithoutEmail: FormAction; setUserRoles: FormAction; savePermissions: FormAction; addToDivisions: FormAction;
  assignSupplier: FormAction; saveStaffSecurity: FormAction;
  resendInvite: (uid: string) => Promise<R>; resetTwoFactor: (uid: string, reason?: string) => Promise<R>; endSessions: (uid: string, reason?: string) => Promise<R>;
  unlockAccount: (email: string) => Promise<R>; setStaffActive: (uid: string, active: boolean) => Promise<R>;
  unassignSupplier: (d: string, s: string) => Promise<R>; removeFromDivision: (uid: string, code: string) => Promise<R>;
};

const inputCls = 'h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 text-ods-body text-ods-text';
const box = 'flex items-start gap-2 rounded-ods-control border border-ods-line px-3 py-2 text-ods-body has-[:checked]:border-ods-blue has-[:checked]:bg-ods-blue-tint';
function F({ id, label, hint, children, wide }: { id: string; label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', wide && 'ods-tablet:col-span-2')}>
      <label htmlFor={id} className="text-ods-label font-semibold text-ods-navy">{label}</label>
      {children}
      {hint ? <p className="m-0 text-ods-small text-ods-slate">{hint}</p> : null}
    </div>
  );
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'invited', label: 'Invited' }, { id: 'locked', label: 'Locked' }, { id: 'deactivated', label: 'Deactivated' },
];

export function StaffAdmin({ data, actions, initialUser, securityForm, roleHref = (c: string) => `/admin/staff?role=${c}` }: {
  data: StaffData; actions: StaffActions; initialUser?: string | null; securityForm?: ReactNode; roleHref?: (code: string) => string;
}) {
  const p = data.perms;
  const [filter, setFilter] = useState('all');
  const [userId, setUserId] = useState<string | null>(initialUser && data.team.some((t) => t.id === initialUser) ? initialUser : null);
  const user = data.team.find((t) => t.id === userId) ?? null;
  const shown = filter === 'all' ? data.team : data.team.filter((t) => t.status === filter);
  const role = data.roles.find((r) => r.code === data.selectedRole) ?? null;
  const have = useMemo(() => new Set(data.matrix.have), [data.matrix.have]);
  const active = data.team.filter((t) => t.active);

  const columns: GridColumn<StaffMember>[] = [
    {
      id: 'name', header: 'Name', accessor: (t) => `${t.name} ${t.email}`, width: 240,
      cell: (t) => (
        <span className={cx('flex min-w-0 flex-col leading-tight', t.status === 'deactivated' && 'text-ods-slate')} data-testid="staff-row" data-status={t.status}>
          <span className="truncate font-semibold">{t.name}{t.self ? <span className="font-normal text-ods-slate"> (you)</span> : null}</span>
          <span className="truncate font-ods text-ods-small text-ods-slate">{t.email}</span>
        </span>
      ),
    },
    { id: 'roles', header: 'Role', accessor: (t) => t.roleNames.join(', '), width: 200, cell: (t) => <span className="flex flex-wrap gap-1">{t.roleNames.map((r) => <StatusPill key={r} tone="info">{r}</StatusPill>)}</span> },
    { id: 'office', header: 'Office', accessor: (t) => t.office ?? '', width: 140, cell: (t) => t.office ?? <span className="text-ods-slate">—</span> },
    { id: '2fa', header: 'Two-factor', accessor: (t) => (t.twoFa == null ? '' : t.twoFa ? 'On' : 'Not set up'), width: 120, cell: (t) => (t.twoFa == null ? '—' : <StatusPill tone={t.twoFa ? 'success' : 'warning'}>{t.twoFa ? 'On' : 'Not set up'}</StatusPill>) },
    { id: 'last', header: 'Last sign-in', accessor: (t) => t.lastSignIn ?? '', width: 150, cell: (t) => (t.lastSignIn ? <span>{formatDate(t.lastSignIn)} <LocalTime iso={t.lastSignIn} /></span> : <span className="text-ods-slate">Never</span>) },
    { id: 'sessions', header: 'Sessions', numeric: true, accessor: (t) => t.sessions ?? -1, width: 100, cell: (t) => (t.sessions == null ? '—' : t.sessions) },
    {
      id: 'status', header: 'Status', accessor: (t) => t.statusLabel, width: 170,
      cell: (t) => <StatusPill tone={t.statusTone}>{t.status === 'locked' && t.lockedUntil ? `Locked until ${formatDate(t.lockedUntil)}` : t.statusLabel}</StatusPill>,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="staff-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-ods-small text-ods-slate">Admin › Users and roles</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Staff &amp; roles</h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">Invite your team and decide exactly what each role can see and do.</p>
          <p className="m-0 mt-1 inline-flex items-center gap-1 text-ods-small text-ods-slate"><Icon icon={Lock} size="xs" />Sensitive actions ask for your 2FA code again if it is older than {data.security.step_up_minutes} minutes.</p>
        </div>
        {p.canCreate ? <Button href="#invite" iconStart={UserPlus}>Invite staff member</Button> : null}
      </div>
      {data.secError ? <p role="status" className="m-0 rounded-ods-control bg-ods-warning-tint px-3 py-2 text-ods-small">2FA and session details are unavailable: {data.secError}</p> : null}

      <section aria-labelledby="team-h" className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="team-h" className="m-0 text-ods-h2 font-bold text-ods-navy">Team <span className="text-ods-small font-normal text-ods-slate">· {data.team.length} accounts</span></h2>
          <FilterPills mode="single" allowEmpty={false} label="Status" value={[filter]} onChange={(ids) => setFilter(ids[0] ?? 'all')}
            items={STATUS_FILTERS.map((f) => ({ id: f.id, label: f.label, count: f.id === 'all' ? data.team.length : data.team.filter((t) => t.status === f.id).length }))} data-testid="staff-status-filter" />
        </div>
        <OctopusDataGrid<StaffMember>
          label="Team"
          data-testid="staff-grid"
          rows={shown}
          columns={columns}
          getRowId={(t) => t.id}
          rowNumber={(t) => t.email}
          emptyTitle={data.team.length ? 'Nobody with this status' : 'No staff yet'}
          emptyDescription={data.team.length ? undefined : 'Invite your first team member below.'}
          onClearFilters={filter !== 'all' ? () => setFilter('all') : undefined}
          onOpenRow={(t) => setUserId(t.id)}
          onOpenInDrawer={(t) => setUserId(t.id)}
          pageSizes={[25, 50, 100]}
          defaultPageSize={25}
        />
        <p className="m-0 text-ods-small text-ods-slate">Open a person to change roles, divisions or security.</p>
      </section>

      <Panel title="Divisions" testId="staff-divisions" actions={<span className="text-ods-small text-ods-slate">One person can work in several divisions · one role in each</span>}>
        {active.length === 0 ? <EmptyState title="No staff yet" /> : (
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {active.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`div-row-${t.email || t.id}`}>
                <span className="min-w-0"><span className="block font-semibold">{t.name}</span><span className="block text-ods-small text-ods-slate">{t.roleNames.join(', ')}</span></span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {t.companyWide ? <StatusPill tone="info">All divisions (company-wide)</StatusPill> : null}
                  {t.divisions.map((d) => <StatusPill key={d.code} tone="neutral">{d.name} · {d.role}</StatusPill>)}
                  {!t.companyWide && !t.divisions.length ? <span className="text-ods-small text-ods-slate">No division yet: sees no division work</span> : null}
                  {p.canEdit ? <Button size="sm" variant="ghost" onClick={() => setUserId(t.id)}>Edit<span className="sr-only"> divisions for {t.name}</span></Button> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Roles" testId="staff-roles">
          <ul className="m-0 flex list-none flex-col p-0">
            {data.roles.map((r) => (
              <li key={r.code}>
                <a href={roleHref(r.code)} aria-current={role?.code === r.code ? 'true' : undefined}
                  className={cx('block rounded-ods-control px-3 py-2 no-underline', role?.code === r.code ? 'bg-ods-blue-tint text-ods-navy' : 'text-ods-text hover:bg-ods-canvas')}>
                  <span className="block font-semibold">{r.name}</span>
                  <span className="block text-ods-small text-ods-slate">{r.members} member{r.members === 1 ? '' : 's'} · {r.code === 'admin' ? 'full access' : r.description}</span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        {role ? (
          <Panel title={`Permissions · ${role.name}`} testId="staff-permissions">
            <p className="m-0 mb-2 text-ods-small text-ods-slate">{role.code === 'admin' ? 'Admin always has every permission (implicit).' : 'Tick what this role can do in each area.'}</p>
            <ActionFormOds key={role.code} action={actions.savePermissions} submitLabel="Save permissions" hideSubmit={!p.canEdit || role.code === 'admin'} confirm={`Save the permission matrix for ${role.name}?`}>
              <input type="hidden" name="role" value={role.code} />
              <div className="-mx-ods-pad-card overflow-x-auto" tabIndex={0} role="region" aria-label="Permission matrix">
                <table className="w-full border-collapse text-ods-table">
                  <thead><tr className="text-ods-label text-ods-slate"><th scope="col" className="px-3 py-1.5 text-start">Area</th>{MATRIX_ACTIONS.map((a) => <th key={a} scope="col" className="px-2 py-1.5 text-center capitalize">{a}</th>)}</tr></thead>
                  <tbody>
                    {data.matrix.areas.map((ar) => (
                      <tr key={ar.code} className="border-t border-ods-line">
                        <th scope="row" className="px-3 py-1.5 text-start font-semibold">{ar.name}</th>
                        {MATRIX_ACTIONS.map((a) => (
                          <td key={a} className="px-2 py-1.5 text-center">
                            <input type="checkbox" name="perm" value={`${ar.code}:${a}`} aria-label={`${ar.name}: ${a}`} className="size-4 accent-[var(--color-ods-blue)]"
                              defaultChecked={role.code === 'admin' || have.has(`${ar.code}:${a}`)} disabled={!p.canEdit || role.code === 'admin'} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.matrix.special.map((ar) => (
                <fieldset key={ar.code} className="mt-3 rounded-ods-control border border-ods-line p-3">
                  <legend className="px-1 font-semibold">{ar.name}</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {ar.actions.map((a) => (
                      <label key={a} className="inline-flex items-center gap-2 text-ods-body">
                        <input type="checkbox" name="perm" value={`${ar.code}:${a}`} className="size-4 accent-[var(--color-ods-blue)]" defaultChecked={role.code === 'admin' || have.has(`${ar.code}:${a}`)} disabled={!p.canEdit || role.code === 'admin'} />
                        {a.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <p className="m-0 mt-2 text-ods-small text-ods-slate">Permission changes take effect on the staff member&apos;s next page load and are recorded in the audit log. Saving asks for your 2FA code if it is older than {data.security.step_up_minutes} minutes.</p>
            </ActionFormOds>
          </Panel>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        {p.canCreate ? (
          <div id="invite" className="scroll-mt-24">
            <Panel title="Invite staff member" testId="staff-invite">
              <ActionFormOds action={actions.inviteStaff} submitLabel="Send invitation" resetOnSuccess confirm="Send this invitation? The person gets an email with a link to set a password (valid 24 hours)." className="grid gap-3 ods-tablet:grid-cols-2">
                <F id="inv-name" label="Full name"><input id="inv-name" name="full_name" className={inputCls} required autoComplete="off" /></F>
                <F id="inv-email" label="Work email"><input id="inv-email" name="email" type="email" className={inputCls} required autoComplete="off" placeholder="name@octopusb2b.com" /></F>
                <F id="inv-office" label="Office" hint="e.g. Shenzhen office" wide>
                  <input id="inv-office" name="office" className={inputCls} list="inv-offices" maxLength={120} />
                  <datalist id="inv-offices">{data.offices.map((o) => <option key={o} value={o} />)}</datalist>
                </F>
                <fieldset className="m-0 border-0 p-0 ods-tablet:col-span-2">
                  <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Roles</legend>
                  <div className="grid gap-2 ods-tablet:grid-cols-2">
                    {data.roles.map((r) => <label key={r.code} className={box}><input type="checkbox" name="roles" value={r.code} disabled={r.code === 'admin' && !p.isAdmin} className="mt-0.5 size-4" /> {r.name}</label>)}
                  </div>
                </fieldset>
                <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">Staff accounts are invitation-only. The invite link expires after 24 hours (use &quot;Resend invite&quot; if it lapses). Two-step verification is set up at first sign-in. Customer emails cannot be invited.</p>
              </ActionFormOds>
              {p.isAdmin ? (
                <details className="mt-3 border-t border-ods-line pt-3">
                  <summary className="cursor-pointer text-ods-small font-semibold text-ods-slate">Advanced: create without email</summary>
                  <p className="m-0 mt-2 text-ods-small text-ods-slate">Only for environments where email sending is not set up. You must share the temporary password securely; the person still sets up 2FA at first sign-in.</p>
                  <ActionFormOds action={actions.createStaffWithoutEmail} submitLabel="Create account" submitVariant="secondary" resetOnSuccess confirm="Create this staff account with a temporary password (no invitation email)?" className="mt-2 grid gap-3 ods-tablet:grid-cols-2">
                    <F id="adv-name" label="Full name"><input id="adv-name" name="full_name" className={inputCls} required autoComplete="off" /></F>
                    <F id="adv-email" label="Work email"><input id="adv-email" name="email" type="email" className={inputCls} required autoComplete="off" /></F>
                    <F id="adv-office" label="Office"><input id="adv-office" name="office" className={inputCls} list="inv-offices" maxLength={120} /></F>
                    <F id="adv-pass" label="Temporary password" hint="Optional (12+ chars). Leave empty to generate one."><input id="adv-pass" name="password" type="text" className={cx(inputCls, 'font-ods')} autoComplete="off" minLength={12} maxLength={72} /></F>
                    <fieldset className="m-0 border-0 p-0 ods-tablet:col-span-2">
                      <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Roles</legend>
                      <div className="grid gap-2 ods-tablet:grid-cols-2">{data.roles.map((r) => <label key={r.code} className={box}><input type="checkbox" name="roles" value={r.code} className="mt-0.5 size-4" /> {r.name}</label>)}</div>
                    </fieldset>
                  </ActionFormOds>
                </details>
              ) : null}
            </Panel>
          </div>
        ) : null}

        <Panel title="Distributor ↔ supplier assignments" testId="staff-assignments">
          {!p.canSuppliersView ? <p className="m-0 rounded-ods-control bg-ods-info-tint px-3 py-2 text-ods-small">Needs the Suppliers · view permission.</p> : (
            <>
              {data.assignments.length === 0 ? <EmptyState title="No assignments yet" /> : (
                <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
                  {data.assignments.map((a) => (
                    <li key={a.distributorId + a.supplierId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><span className="font-semibold">{a.distributor}</span> <span className="text-ods-slate">→ {a.supplier}</span></span>
                      {p.canSuppliersEdit ? <ConfirmRun action={() => actions.unassignSupplier(a.distributorId, a.supplierId)} confirmTitle="Remove this assignment?" confirmText="The distributor loses access to this supplier." confirmLabel="Remove" destructive>Remove</ConfirmRun> : null}
                    </li>
                  ))}
                </ul>
              )}
              {p.canSuppliersEdit ? (
                <ActionFormOds action={actions.assignSupplier} submitLabel="Assign" className="mt-3 grid gap-3 border-t border-ods-line pt-3 ods-tablet:grid-cols-2">
                  <F id="as-d" label="Distributor">
                    <select id="as-d" name="distributor_id" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{data.distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  </F>
                  <F id="as-s" label="Supplier">
                    <select id="as-s" name="supplier_id" className={inputCls} required defaultValue=""><option value="" disabled>Select…</option>{(data.suppliers ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
                  </F>
                  {data.distributors.length === 0 ? <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">No users have the Distributor role yet.</p> : null}
                </ActionFormOds>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      {p.isAdmin ? (
        <div id="security" className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
          <Panel title="Security" testId="staff-security" actions={<span className="text-ods-small text-ods-slate">Admin only</span>}>
            <p className="m-0 mb-2 text-ods-small text-ods-slate">Lockout, session and office IP rules for every staff sign-in.</p>
            {securityForm}
          </Panel>
          <Panel title="Recent security events" testId="staff-events" actions={<span className="text-ods-small text-ods-slate">last {data.events.length}</span>}>
            {data.events.length === 0 ? <EmptyState title="No sign-in events yet" /> : (
              <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
                {data.events.map((e) => (
                  <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{e.actor ?? <span className="text-ods-slate">Unknown</span>}</span>
                      {e.subject && e.subject !== e.actor ? <span className="text-ods-slate"> → {e.subject}</span> : null}
                      {e.entity ? <span className="block break-all font-ods text-ods-small text-ods-slate">{e.entity}</span> : null}
                    </span>
                    <StatusPill tone={e.tone}>{e.label}</StatusPill>
                    <span className="col-span-2 text-ods-small text-ods-slate">{formatDate(e.at)} <LocalTime iso={e.at} /> · {e.ip ?? '—'} · <span title={e.deviceRaw ?? undefined}>{e.device}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      <Drawer open={!!user} onClose={() => setUserId(null)} title={user ? user.name : 'Staff member'} description={user ? <StatusPill tone={user.statusTone}>{user.statusLabel}</StatusPill> : null} width={460} data-testid="staff-drawer">
        {user ? <EditBody key={user.id} t={user} data={data} actions={actions} /> : <span />}
      </Drawer>
    </div>
  );
}

function EditBody({ t, data, actions }: { t: StaffMember; data: StaffData; actions: StaffActions }) {
  const p = data.perms;
  const a = t.actions;
  return (
    <div className="flex flex-col gap-5">
      <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ods-body">
        <dt className="text-ods-slate">Email</dt><dd className="m-0 break-all font-ods">{t.email}</dd>
        <dt className="text-ods-slate">Office</dt><dd className="m-0">{t.office ?? '—'}</dd>
        <dt className="text-ods-slate">Two-factor</dt><dd className="m-0">{t.twoFa == null ? '—' : t.twoFa ? 'On' : 'Not set up'}</dd>
        <dt className="text-ods-slate">Last sign-in</dt><dd className="m-0">{t.lastSignIn ? formatDate(t.lastSignIn) : 'Never'}</dd>
        <dt className="text-ods-slate">Sessions</dt><dd className="m-0">{t.sessions ?? '—'}</dd>
      </dl>

      <section aria-labelledby="ed-roles">
        <h3 id="ed-roles" className="m-0 mb-1 text-ods-body font-bold">Roles</h3>
        <ActionFormOds action={actions.setUserRoles} submitLabel="Save roles" hideSubmit={!p.canEdit} confirm="Update this person's roles? You may be asked for your 2FA code.">
          <input type="hidden" name="user_id" value={t.id} />
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">Roles</legend>
            {data.roles.map((r) => (
              <label key={r.code} className={box}>
                <input type="checkbox" name="roles" value={r.code} defaultChecked={t.roles.includes(r.code)} disabled={!p.canEdit || (r.code === 'admin' && !p.isAdmin)} className="mt-0.5 size-4" />
                <span><span className="block font-semibold">{r.name}</span><span className="block text-ods-small text-ods-slate">{r.description}</span></span>
              </label>
            ))}
          </fieldset>
          <p className="m-0 mt-1 text-ods-small text-ods-slate">Role changes ask for your 2FA code again if it is older than {data.security.step_up_minutes} minutes.</p>
        </ActionFormOds>
      </section>

      {a.resendInvite || a.unlock || a.reset2fa || a.endSessions || a.toggleActive ? (
        <section aria-labelledby="ed-sec">
          <h3 id="ed-sec" className="m-0 mb-1 text-ods-body font-bold">Account</h3>
          <div className="flex flex-wrap gap-2" data-testid="staff-actions">
            {a.resendInvite ? <ConfirmRun action={() => actions.resendInvite(t.id)} confirmTitle={`Send the invitation to ${t.email} again?`} confirmText="The new link is valid for 24 hours." confirmLabel="Resend">Resend invite</ConfirmRun> : null}
            {a.unlock && t.secEmail ? <ConfirmRun action={() => actions.unlockAccount(t.secEmail!)} confirmTitle={`Unlock ${t.name}'s account now?`} confirmLabel="Unlock">Unlock</ConfirmRun> : null}
            {a.reset2fa ? <ConfirmRun action={(r) => actions.resetTwoFactor(t.id, r)} confirmTitle={`Reset 2FA for ${t.name}?`} confirmText="Their authenticator and backup codes are removed and they are signed out." reason="Reason (required, logged)" confirmLabel="Reset 2FA" destructive testId="reset-2fa">Reset 2FA</ConfirmRun> : null}
            {a.endSessions ? <ConfirmRun action={() => actions.endSessions(t.id)} confirmTitle={`Sign ${t.name} out of every device now?`} confirmLabel="End sessions">End sessions</ConfirmRun> : null}
            {a.toggleActive ? (
              <ConfirmRun
                action={() => actions.setStaffActive(t.id, t.status === 'deactivated')}
                confirmTitle={t.status === 'deactivated' ? `Reactivate ${t.name}?` : `Deactivate ${t.name}?`}
                confirmText={t.status === 'deactivated' ? 'They can sign in again (with 2FA).' : 'All their sessions end now and they cannot sign in.'}
                confirmLabel={t.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                destructive={t.status !== 'deactivated'}
                variant={t.status === 'deactivated' ? 'secondary' : 'danger'}
                testId="toggle-active"
              >
                {t.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
              </ConfirmRun>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="ed-div">
        <h3 id="ed-div" className="m-0 mb-1 text-ods-body font-bold">Divisions</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.companyWide ? <StatusPill tone="info">All divisions (company-wide)</StatusPill> : null}
          {t.divisions.map((d) => (
            <span key={d.code} className="inline-flex items-center gap-1 rounded-ods-pill border border-ods-line py-0.5 ps-2.5 pe-1 text-ods-small">
              <b>{d.name}</b> <span className="text-ods-slate">· {d.role}</span>
              {p.canEdit && d.code ? <ConfirmRun action={() => actions.removeFromDivision(t.id, d.code)} variant="ghost" confirmTitle={`Remove ${t.name} from ${d.name}?`} confirmText="Their other divisions stay." confirmLabel="Remove" destructive><span aria-hidden>×</span><span className="sr-only">Remove from {d.name}</span></ConfirmRun> : null}
            </span>
          ))}
          {!t.companyWide && !t.divisions.length ? <span className="text-ods-small text-ods-slate">No division yet: sees no division work</span> : null}
        </div>
        {p.canEdit && t.active ? (
          <ActionFormOds action={actions.addToDivisions} submitLabel="Add to divisions" submitVariant="secondary" confirm="Add this person to the ticked divisions? You may be asked for your 2FA code." className="mt-2 grid gap-2">
            <input type="hidden" name="user_id" value={t.id} />
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Divisions (tick one or more)</legend>
              <div className="grid gap-1.5 ods-tablet:grid-cols-2">{data.divisions.filter((d) => d.active).map((d) => <label key={d.code} className={box}><input type="checkbox" name="divisions" value={d.code} className="mt-0.5 size-4" /> {d.name}</label>)}</div>
            </fieldset>
            <F id={`dv-role-${t.id}`} label="Role in these divisions">
              <select id={`dv-role-${t.id}`} name="role" className={inputCls} required defaultValue="staff">
                {DIVISION_ROLES.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
              </select>
            </F>
            <p className="m-0 text-ods-small text-ods-slate">Already in a division? Adding it again changes the role there. Admin, Finance and Support are company-wide roles and already see every division.</p>
          </ActionFormOds>
        ) : null}
      </section>
    </div>
  );
}
