import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { RatesClient, type RateVersion } from './rates-client';

export const metadata = { title: 'Rates and quotes · Warehouse' };

/** Warehouse OS board 28 — client price plans (Standard / Volume / Custom, optional per warehouse) + monthly quote calculator. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/rates');
  const sb = await createClient();
  const [versions, plans, canRes] = await Promise.all([
    sb.rpc('wh_list_rate_versions'),
    sb.from('wh_rate_plans').select('code, name, description').order('sort'),
    sb.rpc('wh_can_manage_clients'),
  ]);
  if (versions.error) throw new Error(`Could not load rates: ${versions.error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-rates-page">
      <WhHeader access={access} title="Rates and quotes" icon="percent" subtitle="What clients pay, by plan and warehouse. Every change needs a second person (an admin) to approve." />
      <RatesClient versions={(versions.data ?? []) as RateVersion[]} plans={(plans.data ?? []) as { code: string; name: string; description: string | null }[]}
        warehouses={access.warehouses.filter((w) => w.status === 'active' || w.status === 'paused').map((w) => ({ code: w.code, name: w.name }))}
        canPropose={canRes.data === true} isAdmin={access.isAdmin} me={access.session.userId} />
    </div>
  );
}
export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
