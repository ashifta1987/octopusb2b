import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { LabelBoard } from '@/lib/warehouse-putaway';
import { WhHeader } from '../wh-header';
import { LabelsClient, type LabelKind } from './labels-client';

export const metadata = { title: 'Label centre · Warehouse' };
const KINDS: LabelKind[] = ['carton', 'pallet', 'bin', 'parcel'];

/** Warehouse OS board 11 — print and reprint carton, pallet and bin location labels (parcel labels arrive with packing, W3). */
async function Content({ searchParams }: { searchParams: Promise<{ kind?: string; ref?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/labels');
  const sp = await searchParams;
  const kind = KINDS.includes(sp.kind as LabelKind) ? (sp.kind as LabelKind) : 'bin';
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_label_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load labels: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-labels-page">
      <div className="print:hidden">
        <WhHeader access={access} title="Label centre" icon="file"
          subtitle={`${access.current ? access.current.name : 'All warehouses'} · every print and reprint is logged.`} />
      </div>
      <LabelsClient board={data as LabelBoard} initialKind={kind} initialRef={typeof sp.ref === 'string' ? sp.ref.toUpperCase() : null}
        current={access.current?.code ?? null} warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ kind?: string; ref?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
