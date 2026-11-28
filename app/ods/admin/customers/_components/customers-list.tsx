'use client';
/**
 * ODS T9 · Customers list grid (Part 7.2 + 7.6 list pattern). Server-side filters exactly as today's /admin/customers:
 * ?q= (name, buyer code or country), ?kyc= (today's KYC values), ?vip=1. Search is debounced into the URL (2.8).
 * Rows open the customer record. Phones: the grid's read-only stacked list.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilterPills, OctopusDataGrid, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import { KYC_FILTERS, type KycFilter } from '../_lib/customer-logic';
import type { CompanyStatusName } from '../_lib/customer-logic';

export type CustomerListRow = {
  id: string;
  name: string;
  city: string | null;
  buyerCode: string | null;
  country: string | null;
  countryName: string | null;
  status: CompanyStatusName;
  kycLabel: string;
  manager: { name: string; team: string | null; outOfOffice: boolean } | null;
  vip: boolean;
  since: string;
};

export type CustomersListProps = {
  rows: CustomerListRow[];
  q: string;
  kyc: KycFilter;
  vip: boolean;
  /** Base URL for filter links (public URL; fixtures pass their own). */
  base: string;
  loading?: boolean;
  error?: boolean;
  /** Fixtures: no navigation. */
  sample?: boolean;
  limit: number;
};

function href(base: string, p: { q?: string; kyc?: string; vip?: boolean }) {
  const u = new URLSearchParams();
  const [path, existing] = base.split('?');
  new URLSearchParams(existing ?? '').forEach((v, k) => { if (!['q', 'kyc', 'vip'].includes(k)) u.set(k, v); });
  if (p.q) u.set('q', p.q);
  if (p.kyc && p.kyc !== 'all') u.set('kyc', p.kyc);
  if (p.vip) u.set('vip', '1');
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

export function CustomersList({ rows, q, kyc, vip, base, loading, error, sample, limit }: CustomersListProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  const first = useRef(true);
  const go = (p: { q?: string; kyc?: string; vip?: boolean }) => {
    if (sample) return;
    start(() => router.replace(href(base, { q: search, kyc, vip, ...p })));
  };
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if (!sample && search !== q) start(() => router.replace(href(base, { q: search, kyc, vip }))); }, 350);
    return () => clearTimeout(t);
  }, [search, q, kyc, vip, base, router, sample]);

  const cols: GridColumn<CustomerListRow>[] = [
    {
      id: 'name', header: 'Customer', accessor: (r) => r.name, width: 260, minWidth: 220,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <a href={`/admin/customers/${r.id}`} className="inline-flex min-h-6 items-center truncate font-semibold text-ods-blue hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</a>
          {r.city ? <span className="truncate text-ods-small text-ods-slate">{r.city}</span> : null}
        </span>
      ),
    },
    { id: 'code', header: 'Buyer code', accessor: (r) => r.buyerCode ?? '', cell: (r) => <span className="font-mono">{r.buyerCode ?? '—'}</span>, width: 130 },
    { id: 'country', header: 'Country', accessor: (r) => r.countryName ?? r.country ?? '', cell: (r) => (r.countryName ? `${r.countryName}${r.country ? ` (${r.country})` : ''}` : '—'), width: 170 },
    { id: 'status', header: 'Status', accessor: (r) => r.status, cell: (r) => <span className="inline-flex items-center gap-2"><StatusPill status={r.status} /><span className="sr-only">KYC {r.kycLabel}</span></span>, width: 180 },
    {
      id: 'manager', header: 'Account manager', accessor: (r) => r.manager?.name ?? '', width: 200,
      cell: (r) => (r.manager ? <span className="flex flex-col leading-tight"><span>{r.manager.name}{r.manager.outOfOffice ? ' · out of office' : ''}</span>{r.manager.team ? <span className="text-ods-small text-ods-slate">{r.manager.team}</span> : null}</span> : <span className="text-ods-slate">Unassigned</span>),
    },
    { id: 'vip', header: 'VIP', accessor: (r) => (r.vip ? 1 : 0), cell: (r) => (r.vip ? <StatusPill tone="indigo">VIP</StatusPill> : <span className="text-ods-slate">—</span>), width: 90 },
    { id: 'since', header: 'Since', accessor: (r) => r.since, cell: (r) => formatDate(r.since), width: 120 },
  ];
  const filtered = !!(q || kyc !== 'all' || vip);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <FilterPills
          label="Filter customers by KYC status"
          mode="single"
          allowEmpty={false}
          value={[kyc]}
          onChange={(ids) => go({ kyc: ids[0] ?? 'all' })}
          items={KYC_FILTERS.map(([id, label]) => ({ id, label }))}
          resultText={loading ? 'Loading…' : `${rows.length} shown${rows.length >= limit ? ` (first ${limit}: refine the search)` : ''}`}
          data-testid="customers-kyc-filter"
        />
        <FilterPills
          label="VIP filter"
          value={vip ? ['vip'] : []}
          onChange={(ids) => go({ vip: ids.includes('vip') })}
          items={[{ id: 'vip', label: 'VIP only' }]}
        />
      </div>
      <OctopusDataGrid
        label="Customers"
        rows={rows}
        columns={cols}
        getRowId={(r) => r.id}
        rowNumber={(r) => r.buyerCode ?? r.name}
        loading={loading || pending}
        error={error ? "We couldn't load the customers." : undefined}
        onRetry={sample ? undefined : () => router.refresh()}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        searchPlaceholder="Name, buyer code or country"
        filters={[
          ...(kyc !== 'all' ? [{ id: 'kyc', label: `KYC: ${KYC_FILTERS.find(([k]) => k === kyc)?.[1] ?? kyc}` }] : []),
          ...(vip ? [{ id: 'vip', label: 'VIP only' }] : []),
        ]}
        onRemoveFilter={(fid) => go(fid === 'kyc' ? { kyc: 'all' } : { vip: false })}
        onClearFilters={filtered ? () => { setSearch(''); go({ q: '', kyc: 'all', vip: false }); } : undefined}
        emptyTitle={filtered ? 'No customers found' : 'No customers yet'}
        emptyDescription={q ? 'Try a different search.' : 'Customers appear here after onboarding.'}
        onOpenRow={(r, o) => (o.newTab ? window.open(`/admin/customers/${r.id}`, '_blank') : sample ? undefined : router.push(`/admin/customers/${r.id}`))}
        defaultSort={{ id: 'since', desc: true }}
        pagination
        headingLevel={2}
        data-testid="customers-grid"
      />
    </div>
  );
}
