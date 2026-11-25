import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { UsersClient, type StaffRow, type Capability } from './users-client';

export const metadata = { title: 'Users and roles · Warehouse' };

/** Warehouse OS board 31 — staff per warehouse, suspend / restore, add a person with a role, what each role can do. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/users');
  const sb = await createClient();
  const [staffRes, capRes, canRes] = await Promise.all([
    sb.rpc('wh_list_staff', { p_warehouse: access.current?.code ?? null }),
    sb.from('wh_role_capabilities').select('role, action, label, sort').order('sort'),
    Promise.all(access.warehouses.map(async (w) => [w.code, (await sb.rpc('wh_can', { p_action: 'manage_staff', p_warehouse: w.code })).data === true] as const)),
  ]);
  if (staffRes.error) throw new Error(`Could not load staff: ${staffRes.error.message}`);
  const manageable = canRes.filter(([, ok]) => ok).map(([code]) => code);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-users-page">
      <WhHeader access={access} title="Users and roles" icon="user"
        subtitle="Who works in each warehouse and what their role allows. Only warehouse admins add, suspend or restore people." />
      <UsersClient
        rows={(staffRes.data ?? []) as StaffRow[]}
        capabilities={(capRes.data ?? []) as Capability[]}
        warehouses={access.warehouses.filter((w) => manageable.includes(w.code) && w.status !== 'closed' && w.status !== 'legacy')}
        manageable={manageable}
        me={access.session.userId}
        isCompanyAdmin={access.isAdmin}
      />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
