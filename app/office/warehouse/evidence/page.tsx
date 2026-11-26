import { Suspense } from 'react';
import Link from 'next/link';
import { DsBadge, DsCard, DsEmptyState, DsSkeleton, DsTableCard } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { fmtWh } from '@/lib/warehouse-inbound';
import { EVIDENCE_KINDS, grams, type EvidenceBoard } from '@/lib/warehouse-orders';
import { WhHeader } from '../wh-header';

export const metadata = { title: 'Evidence · Warehouse' };

/** Warehouse OS board 4 (list) — packed orders with their photos, weight check and how long the proof is kept. */
async function Content({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/evidence');
  const q = ((await searchParams).q ?? '').trim().slice(0, 64);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_evidence_board', { p_warehouse: access.current?.code ?? null, p_q: q || null });
  if (error) throw new Error(`Could not load evidence: ${error.message}`);
  const board = data as EvidenceBoard;
  return (
    <div className="flex flex-col gap-5" data-testid="wh-evidence-page">
      <WhHeader access={access} title="Evidence" icon="image"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · contents, sealed and scale photos, scan log and weights for every packed parcel.`} />
      <DsCard testId="wh-evidence-retention">
        <p className="m-0 text-[13.5px]">
          Packing photos are kept for {board.retention.map((r) => `${r.days} days at ${r.name}`).join(', ') || 'the set period'}, then removed. Clients see the photos of their own orders in the portal.
        </p>
        <form method="get" className="mt-3 flex flex-wrap gap-2 items-end">
          <label className="flex flex-col"><span className="ds-label">Order number</span>
            <input name="q" defaultValue={q} placeholder="WO-000123 or client ref" className="ds-input min-h-[44px]" autoComplete="off" />
          </label>
          <button type="submit" className="ds-btn ds-btn-secondary min-h-[44px]">Find</button>
        </form>
      </DsCard>
      {board.orders.length === 0 ? (
        <DsEmptyState icon="image" title="No packed parcels yet" description="Every parcel closed at the packing station shows here with its proof." testId="wh-evidence-empty" />
      ) : (
        <DsTableCard title="Packed parcels" icon="image" testId="wh-evidence-table" minWidth={860}
          headers={['Order', 'Owner', 'Packed', 'Weight', 'Photos', 'Kept until']}>
          {board.orders.map((o) => {
            const diff = o.expected_weight_g != null && o.measured_weight_g != null ? o.measured_weight_g - o.expected_weight_g : null;
            return (
              <tr key={o.id} data-testid={`wh-evidence-row-${o.code}`}>
                <td><Link href={`/office/warehouse/evidence/${o.code}`} className="font-mono font-semibold text-[#2559B8] underline">{o.code}</Link>
                  {o.external_ref && <div className="text-[12px] text-[#5B6478]">{o.external_ref}</div>}</td>
                <td>{o.owner}</td>
                <td>{fmtWh(o.packed_at)}</td>
                <td>{grams(o.measured_weight_g)}{o.expected_weight_g != null ? <div className="text-[12px] text-[#5B6478]">expected {grams(o.expected_weight_g)}{diff != null ? ` (${diff > 0 ? '+' : ''}${diff} g)` : ''}</div> : null}
                  {o.override && <DsBadge tone="warn">Supervisor approved</DsBadge>}</td>
                <td>{o.photos} · {EVIDENCE_KINDS.every((k) => o.kinds.includes(k)) ? <DsBadge tone="ok">Complete</DsBadge> : <DsBadge tone="bad">Missing</DsBadge>}</td>
                <td>{fmtWh(o.retention_until)}</td>
              </tr>
            );
          })}
        </DsTableCard>
      )}
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ q?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
