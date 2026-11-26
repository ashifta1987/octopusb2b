import { Suspense } from 'react';
import { DsLinkButton, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../../wh-header';
import { BinsClient, type BinAdminRow } from './bins-client';

export const metadata = { title: 'Bins · Warehouse' };

/** Warehouse OS board 10 (bin admin) — create bins one by one or as a rack-row-bin range; block, unblock and archive. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/putaway/bins');
  const sb = await createClient();
  let q = sb.from('wh_bins').select('id, code, warehouse_code, zone, status, block_reason, created_at').order('warehouse_code').order('code').limit(5000);
  if (access.current) q = q.eq('warehouse_code', access.current.code);
  const [{ data: bins, error }, { data: stock, error: e2 }] = await Promise.all([
    q,
    (access.current ? sb.from('wh_bin_stock').select('bin_id, qty').eq('warehouse_code', access.current.code) : sb.from('wh_bin_stock').select('bin_id, qty')).limit(20000),
  ]);
  if (error || e2) throw new Error(`Could not load bins: ${(error ?? e2)!.message}`);
  const units = new Map<string, number>();
  for (const s of (stock ?? []) as { bin_id: string; qty: number }[]) units.set(s.bin_id, (units.get(s.bin_id) ?? 0) + s.qty);
  const rows: BinAdminRow[] = ((bins ?? []) as Omit<BinAdminRow, 'units'>[]).map((b) => ({ ...b, units: units.get(b.id) ?? null }));
  // capability 'putaway' belongs to receivers, supervisors and admins (W0 role table); the database checks it again
  const manageable = access.warehouses.filter((w) => ['active', 'paused'].includes(w.status) && ['receiver', 'supervisor', 'admin'].includes(w.role ?? ''))
    .filter((w) => !access.current || w.code === access.current.code).map((w) => ({ code: w.code, name: w.name }));
  return (
    <div className="flex flex-col gap-5" data-testid="wh-bins-page">
      <WhHeader access={access} title="Bins" icon="grid"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · every bin is rack-row-bin (A-01-03) and has its own location label.`}
        actions={<>
          <DsLinkButton href="/office/warehouse/labels?kind=bin" variant="secondary" icon="file">Bin labels</DsLinkButton>
          <DsLinkButton href="/office/warehouse/putaway" variant="secondary" icon="box">Putaway</DsLinkButton>
        </>} />
      <BinsClient rows={rows} manageable={manageable} warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
