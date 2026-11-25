import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { ClientsClient, type Application, type Client } from './clients-client';

export const metadata = { title: 'Clients and applications · Warehouse' };

/** Warehouse OS board 26 — review applications (checks, plan, approve / decline) and the approved clients. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/clients');
  const sb = await createClient();
  const [apps, clients, plans, canRes] = await Promise.all([
    sb.from('wh_applications').select('id, code, company, contact_name, email, phone, country, sells, orders_band, channels, stock_route, has_batteries, has_liquids, preferred_warehouse, status, check_documents, check_dangerous_goods, check_terms_sent, plan_code, decline_reason, decided_at, org_id, created_at').order('created_at', { ascending: false }).limit(300),
    sb.from('wh_clients').select('org_id, plan_code, preferred_warehouse, status, created_at, organizations(name)').order('created_at', { ascending: false }),
    sb.from('wh_rate_plans').select('code, name').order('sort'),
    sb.rpc('wh_can_manage_clients'),
  ]);
  if (apps.error) throw new Error(`Could not load applications: ${apps.error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-clients-page">
      <WhHeader access={access} title="Clients and applications" icon="users" subtitle="Review new applications, tick the checks, choose a plan, then approve or decline." />
      <ClientsClient apps={(apps.data ?? []) as Application[]} clients={(clients.data ?? []) as unknown as Client[]}
        plans={(plans.data ?? []) as { code: string; name: string }[]} canManage={canRes.data === true}
        warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}
export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
