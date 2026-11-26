'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtDate } from '@/lib/format';
import type { WarehouseOption } from '@/lib/warehouse';
import { addStaffAction, restoreAction, setRoleAction, suspendAction } from '../actions';

export type StaffRow = {
  user_id: string; full_name: string | null; email: string | null; warehouse_code: string; warehouse_name: string;
  role: string; suspended_at: string | null; suspend_reason: string | null; created_at: string;
};
export type Capability = { role: string; action: string; label: string; sort: number };

const ROLES = ['packer', 'receiver', 'supervisor', 'admin'] as const;
const LABEL: Record<string, string> = { packer: 'Packer', receiver: 'Receiver', supervisor: 'Supervisor', admin: 'Admin' };

export function UsersClient({ rows, capabilities, warehouses, manageable, me, isCompanyAdmin }: {
  rows: StaffRow[]; capabilities: Capability[]; warehouses: WarehouseOption[]; manageable: string[]; me: string; isCompanyAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.();
  });
  const actions = [...new Map(capabilities.map((c) => [c.action, c])).values()].sort((a, b) => a.sort - b.sort);

  return (
    <div className="flex flex-col gap-5">
      <DsCard title="People" icon="users" noPadding testId="wh-staff">
        {rows.length === 0 ? (
          <div className="p-5"><DsEmptyState icon="users" title="No one added yet" description="Add the first person below. Company admins can open every warehouse without being added." /></div>
        ) : (
          <div className="ds-scroll" tabIndex={0}>
            <table className="ds-tbl min-w-[860px]">
              <thead><tr><th scope="col">Name</th><th scope="col">Warehouse</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.user_id}:${r.warehouse_code}`;
                  const can = manageable.includes(r.warehouse_code) && r.user_id !== me && (r.role !== 'admin' || isCompanyAdmin);
                  return (
                    <tr key={key} data-testid={`wh-staff-${r.email}`}>
                      <td><div className="font-semibold">{r.full_name ?? '—'}</div><div className="text-[12px] text-muted">{r.email}</div></td>
                      <td>{r.warehouse_name}</td>
                      <td>
                        {can && !r.suspended_at ? (
                          <DsSelect label={<span className="sr-only">Role for {r.email}</span>} value={r.role} disabled={pending}
                            onChange={(e) => run(setRoleAction(r.user_id, r.warehouse_code, e.target.value))}>
                            {ROLES.filter((x) => x !== 'admin' || isCompanyAdmin || r.role === 'admin').map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}
                          </DsSelect>
                        ) : LABEL[r.role] ?? r.role}
                      </td>
                      <td>{r.suspended_at
                        ? <><DsBadge tone="bad">Suspended</DsBadge><div className="text-[12px] text-muted">{fmtDate(r.suspended_at)} · {r.suspend_reason}</div></>
                        : <DsBadge tone="ok">Active</DsBadge>}</td>
                      <td>
                        {can && (r.suspended_at ? (
                          <DsButton variant="secondary" disabled={pending} onClick={() => run(restoreAction(r.user_id, r.warehouse_code))}>Restore</DsButton>
                        ) : suspending === key ? (
                          <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(suspendAction(r.user_id, r.warehouse_code, reason), () => setSuspending(null)); }}>
                            <DsInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                            <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>Suspend</DsButton>
                            <DsButton variant="link" onClick={() => setSuspending(null)}>Cancel</DsButton>
                          </form>
                        ) : (
                          <DsButton variant="secondary" disabled={pending} onClick={() => { setSuspending(key); setReason(''); }}>Suspend</DsButton>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>

      {warehouses.length > 0 ? (
        <DsCard title="Add a person" icon="plus" testId="wh-add-staff" subtitle="They need a staff account first (Admin › Staff & roles). A person can be added once per warehouse.">
          <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={(e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget); run(addStaffAction(fd));
          }}>
            <DsInput label="Work email" name="email" type="email" required />
            <DsSelect label="Warehouse" name="warehouse" defaultValue={warehouses[0]?.code}>
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </DsSelect>
            <DsSelect label="Role" name="role" defaultValue="packer">
              {ROLES.filter((x) => x !== 'admin' || isCompanyAdmin).map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}
            </DsSelect>
            <DsButton type="submit" disabled={pending} testId="wh-add-submit">Add person</DsButton>
          </form>
        </DsCard>
      ) : (
        <p className="m-0 text-[13px] text-muted">Only warehouse admins can add or change people.</p>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-users-msg" className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

      <DsCard title="What each role can do" icon="shield" noPadding testId="wh-roles-table">
        <div className="ds-scroll" tabIndex={0}>
          <table className="ds-tbl min-w-[640px]">
            <thead><tr><th scope="col">Action</th>{ROLES.map((r) => <th key={r} scope="col">{LABEL[r]}</th>)}</tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.action}>
                  <td>{a.label}</td>
                  {ROLES.map((r) => {
                    const yes = capabilities.some((c) => c.role === r && c.action === a.action);
                    return <td key={r}>{yes ? <span className="text-ok font-semibold">Yes<span className="sr-only">, {LABEL[r]} can {a.label.toLowerCase()}</span></span> : <span className="text-muted">No</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 px-5 py-3 text-[12.5px] text-muted">Rate and carrier-rule changes always need a second person to approve.</p>
      </DsCard>
    </div>
  );
}
