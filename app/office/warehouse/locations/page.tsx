import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { LocationsClient, type Location } from './locations-client';

export const metadata = { title: 'Locations · Warehouse' };

/** Multi-warehouse: China locations. Admin only; every change is audit-logged in the database. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/locations');
  if (!access.isAdmin) redirect('/office/warehouse');
  const sb = await createClient();
  const [locs, stock] = await Promise.all([
    sb.from('warehouses').select('code, name, country, province, city, address, email, phone, hours, timezone, status, is_default, updated_at').order('is_default', { ascending: false }).order('name'),
    sb.from('warehouse_stock').select('warehouse_id, on_hand_qty'),
  ]);
  if (locs.error) throw new Error(`Could not load locations: ${locs.error.message}`);
  const units = new Map<string, number>();
  for (const r of (stock.data ?? []) as { warehouse_id: string; on_hand_qty: number }[]) units.set(r.warehouse_id, (units.get(r.warehouse_id) ?? 0) + Number(r.on_hand_qty));
  return (
    <div className="flex flex-col gap-5" data-testid="wh-locations-page">
      <WhHeader access={access} title="Locations" icon="store" subtitle="Warehouses in China. Every location has the same features; closed locations stay as history." />
      <LocationsClient rows={((locs.data ?? []) as Location[]).map((l) => ({ ...l, units: units.get(l.code) ?? 0 }))} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
