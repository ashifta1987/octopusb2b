import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { createStaff, setUserRoles, setStaffActive, setForce2fa, savePermissions, assignSupplier, unassignSupplier } from './actions';

export const metadata = { title: 'Staff & roles' };

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
/** Area-specific actions (SPEC §16.4: Backups & restore). */
const AREA_ACTIONS: Record<string, readonly string[]> = { backups: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] };

/** Admin → Staff & roles (Staff.png). */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ role?: string; user?: string }> }) {
  const s = await requireStaff('staff', 'view', '/admin/staff');
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: roles }, { data: areas }, { data: userRoles }, { data: perms }, { data: assignments }, { data: suppliers }] = await Promise.all([
    sb.from('roles').select('code, name, description, is_staff, sort').order('sort'),
    sb.from('permission_areas').select('code, name, sort').order('sort'),
    sb.from('user_roles').select('user_id, role_code'),
    sb.from('role_permissions').select('role_code, area, action'),
    sb.from('distributor_suppliers').select('distributor_id, supplier_id'),
    sb.from('suppliers').select('id, code, legal_name, country').is('archived_at', null).order('code'),
  ]);
  const staffRoles = (roles ?? []).filter((r) => r.is_staff);
  const staffCodes = new Set(staffRoles.map((r) => r.code));
  const byUser = new Map<string, string[]>();
  (userRoles ?? []).filter((r) => staffCodes.has(r.role_code)).forEach((r) => byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role_code]));
  const ids = [...byUser.keys()];
  const { data: profiles } = ids.length ? await sb.from('profiles').select('id, full_name, email, active, totp_required, created_at').in('id', ids) : { data: [] };
  // last sign-in from Supabase Auth (admin API, server only)
  const lastSeen = new Map<string, string | null>();
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    data.users.forEach((u) => lastSeen.set(u.id, u.last_sign_in_at ?? null));
  } catch { /* service key missing: column shows — */ }
  const team = (profiles ?? []).sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name));
  const edit = can(s, 'staff', 'edit');
  const roleMembers = (code: string) => [...byUser.values()].filter((r) => r.includes(code)).length;
  const selRole = staffRoles.find((r) => r.code === sp.role) ?? staffRoles.find((r) => r.code !== 'admin') ?? staffRoles[0];
  const have = new Set((perms ?? []).filter((p) => p.role_code === selRole?.code).map((p) => `${p.area}:${p.action}`));
  const selUser = team.find((t) => t.id === sp.user);
  const distributors = team.filter((t) => byUser.get(t.id)?.includes('distributor'));
  const supById = new Map((suppliers ?? []).map((x) => [x.id, x]));
  const nameById = new Map(team.map((t) => [t.id, t.full_name]));

  return (
    <>
      <PageHeader title="Staff & roles" subtitle="Create accounts for your team and decide exactly what each role can see and do."
        actions={can(s, 'staff', 'create') && <a href="#add-staff" className="btn btn-primary">+ Add staff member</a>} />

      <Card title="Team" className="mb-6" action={<span className="mono text-xs text-muted">{team.length} accounts</span>}>
        <Table head={['Name', 'Email', 'Role', 'Two-factor', 'Last active', 'Status', '']} empty={<EmptyState title="No staff yet" />}>
          {team.map((t) => (
            <tr key={t.id} className={cn(selUser?.id === t.id && 'bg-blue-soft')}>
              <td className="td font-semibold">{t.full_name}{t.id === s.userId && <span className="text-xs text-muted"> (you)</span>}</td>
              <td className="td mono text-sm">{t.email}</td>
              <td className="td"><span className="flex flex-wrap gap-1">{(byUser.get(t.id) ?? []).map((r) => <StatusBadge key={r} status={r} tone="blue" label={staffRoles.find((x) => x.code === r)?.name ?? r} />)}</span></td>
              <td className="td text-sm">
                {edit ? <RunButton className="btn btn-ghost btn-sm" confirm={t.totp_required ? 'Stop forcing 2FA for this user?' : 'Force 2FA for this user?'} action={setForce2fa.bind(null, t.id, !t.totp_required)}>{t.totp_required ? 'Required' : 'Off'}</RunButton> : (t.totp_required ? 'Required' : 'Off')}
              </td>
              <td className="td text-sm text-muted">{lastSeen.get(t.id) ? fmtDate(lastSeen.get(t.id), true) : '—'}</td>
              <td className="td"><StatusBadge status={t.active ? 'active' : 'off'} label={t.active ? 'Active' : 'Disabled'} /></td>
              <td className="td">
                <span className="flex gap-2 justify-end">
                  <Link href={`/admin/staff?user=${t.id}${selRole ? `&role=${selRole.code}` : ''}#edit-user`} className="btn btn-ghost btn-sm">Edit</Link>
                  {edit && t.id !== s.userId && (
                    <RunButton className="btn btn-ghost btn-sm" confirm={t.active ? `Disable ${t.full_name}? They will be blocked from signing in.` : `Enable ${t.full_name}?`} action={setStaffActive.bind(null, t.id, !t.active)}>
                      {t.active ? 'Disable' : 'Enable'}
                    </RunButton>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {selUser && (
        <div id="edit-user" className="mb-6">
          <Card title={`Roles · ${selUser.full_name}`} action={<Link href="/admin/staff" className="text-sm text-blue">Close</Link>}>
            <ActionForm key={selUser.id} action={setUserRoles} className="px-6 pb-6" submitLabel="Save roles" hideSubmit={!edit} confirm="Update this person's roles?">
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
              <p className="text-xs text-muted mt-3">Permission changes take effect on the staff member&apos;s next page load and are recorded in the audit log.</p>
            </ActionForm>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {can(s, 'staff', 'create') && (
          <div id="add-staff">
            <Card title="Add staff member">
              <ActionForm action={createStaff} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Create account" resetOnSuccess confirm="Create this staff account?">
                <Field label="Full name" htmlFor="st-name"><input id="st-name" name="full_name" className="input" required /></Field>
                <Field label="Work email" htmlFor="st-email"><input id="st-email" name="email" type="email" className="input" required /></Field>
                <Field label="Temporary password" htmlFor="st-pass" hint="Optional (12+ chars). Leave empty to generate one." className="sm:col-span-2"><input id="st-pass" name="password" type="text" className="input mono" autoComplete="off" minLength={12} /></Field>
                <fieldset className="sm:col-span-2">
                  <legend className="label">Roles</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {staffRoles.map((r) => (
                      <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roles" value={r.code} disabled={r.code === 'admin' && !s.isAdmin} /> {r.name}</label>
                    ))}
                  </div>
                </fieldset>
                <p className="sm:col-span-2 text-xs text-muted">The account is email-confirmed and must set up two-factor authentication at first sign-in.</p>
              </ActionForm>
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
    </>
  );
}
