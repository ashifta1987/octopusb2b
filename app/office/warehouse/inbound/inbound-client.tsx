'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DsBadge, DsCard, DsChip, DsEmptyState } from '@/components/dropship-ui';
import { ASN_STATUS, SOURCE_LABEL, fmtDay, fmtWh, loadText, type AsnRow } from '@/lib/warehouse-inbound';

const FILTERS: [string, string, string[]][] = [
  ['open', 'Coming in', ['submitted', 'booked']],
  ['dock', 'At the dock', ['arrived', 'receiving']],
  ['received', 'Received', ['received']],
  ['cancelled', 'Cancelled', ['cancelled']],
];

export function InboundClient({ asns, warehouseNames }: { asns: AsnRow[]; warehouseNames: Record<string, string> }) {
  const [filter, setFilter] = useState('open');
  const statuses = FILTERS.find((f) => f[0] === filter)?.[2] ?? [];
  const list = asns.filter((a) => statuses.includes(a.status));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter stock notices">
        {FILTERS.map(([k, label, st]) => (
          <DsChip key={k} pressed={filter === k} onClick={() => setFilter(k)} testId={`wh-inbound-filter-${k}`}>
            {label} ({asns.filter((a) => st.includes(a.status)).length})
          </DsChip>
        ))}
      </div>
      <DsCard title="Stock notices" icon="list" noPadding testId="wh-inbound-list">
        {list.length === 0 ? (
          <div className="p-5"><DsEmptyState icon="download" title="No stock notices here" description="Clients send notices from the Send stock tab of their portal." /></div>
        ) : (
          <div className="ds-scroll" tabIndex={0}>
            <table className="ds-tbl min-w-[860px]">
              <thead>
                <tr>
                  <th scope="col">Notice</th><th scope="col">Owner</th><th scope="col">Warehouse</th><th scope="col">Arrives</th>
                  <th scope="col">Load</th><th scope="col">Products</th><th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const [label, tone] = ASN_STATUS[a.status] ?? [a.status, 'neutral'];
                  return (
                    <tr key={a.id} data-testid={`wh-inbound-row-${a.code}`}>
                      <td>
                        <Link href={`/office/warehouse/receive/${a.code}`} className="font-mono font-semibold text-coral-text underline-offset-2 hover:underline">{a.code}</Link>
                        {a.client_note && <div className="text-[12px] text-muted max-w-[220px] truncate" title={a.client_note}>{a.client_note}</div>}
                      </td>
                      <td>{a.org_name ?? SOURCE_LABEL[a.source] ?? a.source}</td>
                      <td>{warehouseNames[a.warehouse_code] ?? a.warehouse_code}</td>
                      <td>{fmtDay(a.expected_date)}{a.booked_slot_at && <div className="text-[12px] text-muted">Slot {fmtWh(a.booked_slot_at)} China time</div>}</td>
                      <td>{loadText(a.cartons, a.pallets) || '—'}</td>
                      <td>{a.lines} · {a.units == null ? '—' : Number(a.units).toLocaleString('en-US')} units</td>
                      <td className="whitespace-nowrap">
                        <DsBadge tone={tone}>{label}</DsBadge>
                        {a.attention > 0 && <div className="mt-1"><DsBadge tone="warn">{a.attention} to check</DsBadge></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>
    </div>
  );
}
