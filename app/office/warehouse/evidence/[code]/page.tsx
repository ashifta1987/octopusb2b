import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DsBadge, DsCard, DsSkeleton, DsTableCard } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signEvidence } from '@/lib/warehouse-evidence';
import { fmtWh } from '@/lib/warehouse-inbound';
import { SCAN_RESULT, grams, type OrderDetail } from '@/lib/warehouse-orders';
import { WhHeader } from '../../wh-header';
import { DgBadge, EvidenceGallery, OrderStatusBadge } from '../../orders/order-bits';

export const metadata = { title: 'Packing evidence · Warehouse' };

/** Warehouse OS board 4 — one order's packing proof: photos, scan log, weights, supervisor approval and retention. */
async function Content({ params }: { params: Promise<{ code: string }> }) {
  const ref = decodeURIComponent((await params).code);
  const access = await requireWarehouseStaff(`/office/warehouse/evidence/${encodeURIComponent(ref)}`);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_order_detail', { p_ref: ref });
  if (error) {
    if (/NOT_FOUND/.test(error.message)) notFound();
    throw new Error(`Could not load the evidence: ${error.message}`);
  }
  const d = data as OrderDetail;
  const o = d.order;
  const urls = await signEvidence(sb, d.evidence.map((e) => e.path));
  const photos = d.evidence.map((e) => ({ ...e, url: urls.get(e.path) ?? null }));
  const packScans = d.scans.filter((s) => s.station === 'pack').reverse();
  const diff = o.expected_weight_g != null && o.measured_weight_g != null ? o.measured_weight_g - o.expected_weight_g : null;
  const kept = d.evidence.length ? d.evidence.map((e) => e.retention_until).sort()[0] : null;
  return (
    <div className="flex flex-col gap-4" data-testid="wh-evidence-detail">
      <WhHeader access={access} title={`Evidence ${o.code}`} icon="image" subtitle={`${o.owner}${o.external_ref ? ` · ref ${o.external_ref}` : ''}${o.store_order ? ` · ${o.store_order}` : ''}`} />
      <DsCard title="Weight check" icon="scale" testId="wh-evidence-weights" actions={<><OrderStatusBadge status={o.status} /><DgBadge kinds={o.dg_kinds} /></>}>
        <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <dt className="text-[#5B6478]">Box</dt><dd className="m-0">{o.box ? `${o.box.name} · empty ${grams(o.box.tare_g)}` : '—'}</dd>
          <dt className="text-[#5B6478]">Expected</dt><dd className="m-0">{o.expected_weight_g == null ? 'Unknown' : `${grams(o.expected_weight_g)} ± ${o.tolerance_g} g`}</dd>
          <dt className="text-[#5B6478]">Measured</dt><dd className="m-0" data-testid="wh-evidence-measured">{grams(o.measured_weight_g)}{diff != null ? ` (${diff > 0 ? '+' : ''}${diff} g)` : ''}</dd>
          <dt className="text-[#5B6478]">Result</dt>
          <dd className="m-0">{o.override_by_name ? <DsBadge tone="warn">Approved by {o.override_by_name}: “{o.override_reason}”</DsBadge> : o.measured_weight_g != null ? <DsBadge tone="ok">Inside tolerance</DsBadge> : '—'}</dd>
          {o.has_dangerous_goods && <><dt className="text-[#5B6478]">Battery mark</dt><dd className="m-0">{o.battery_mark ? 'Applied' : 'Not applied'}</dd></>}
          <dt className="text-[#5B6478]">Packed</dt><dd className="m-0">{fmtWh(o.packed_at)}{o.packed_by_name ? ` · ${o.packed_by_name}` : ''}</dd>
          <dt className="text-[#5B6478]">Proof kept until</dt><dd className="m-0" data-testid="wh-evidence-kept">{kept ? fmtWh(kept) : '—'} ({d.settings.retention_days} days at this warehouse)</dd>
        </dl>
        <p className="mt-3 mb-0"><Link href={`/office/warehouse/orders/${o.code}`} className="text-[13px] font-semibold text-[#2559B8] underline">Order detail and history</Link></p>
      </DsCard>
      <DsCard title="Photos" icon="image" testId="wh-evidence-photos"><EvidenceGallery items={photos} /></DsCard>
      <DsTableCard title="Packing scan log" icon="activity" testId="wh-evidence-scans" minWidth={520} headers={['When', 'Scanned', 'Result', 'By']}>
        {packScans.length === 0 ? <tr><td colSpan={4}>No scans.</td></tr> : packScans.map((s, i) => (
          <tr key={i}><td>{fmtWh(s.at)}</td><td className="font-mono">{s.code}</td>
            <td>{s.result === 'ok' ? <DsBadge tone="ok">{SCAN_RESULT.ok}</DsBadge> : <DsBadge tone="bad">{SCAN_RESULT[s.result] ?? s.result}</DsBadge>}</td><td>{s.by_name ?? '—'}</td></tr>
        ))}
      </DsTableCard>
    </div>
  );
}

export default function Page(props: { params: Promise<{ code: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
