'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, UserRound } from 'lucide-react';
import { Breadcrumbs, KpiStrip, OctopusDataGrid, StatusPill, Tabs, formatDate, formatNumber, type ContextMenuItem, type GridColumn } from '@octopus/ui';
import { BRAND_METHOD, BRAND_PACK, brandDestination, type BrandRow } from '@/lib/brand-projects';
import { BRAND_TABS, brandLabel, brandTabHref, brandTone, type BrandTab } from '../_lib/brand-core';

export type BrandListResult = { kind: 'ok'; rows: BrandRow[]; counts: Record<BrandTab, number> } | { kind: 'error'; error: string } | { kind: 'loading' };

/**
 * ODS T9 · Back Office › Services › Make My Brand projects (today's Admin › Brand projects): KpiStrip, status tabs
 * (today's ?status=), grid. Rows = today's admin_brand_projects() RPC (account managers see only their own customers).
 */
export function BrandListScreen({ basePath = '/admin/brand-projects', extraParams, tab, result, recordHref }: {
  basePath?: string; extraParams?: Record<string, string>; tab: BrandTab; result: BrandListResult; recordHref?: (r: BrandRow) => string;
}) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const all = result.kind === 'ok' ? result.rows : [];
  const rows = tab === 'all' ? all : all.filter((r) => r.status === tab);
  const counts = result.kind === 'ok' ? result.counts : null;
  const href = (r: BrandRow) => (recordHref ? recordHref(r) : `/admin/brand-projects/${r.id}`);

  const columns: GridColumn<BrandRow>[] = [
    {
      id: 'ref', header: 'Number', width: 112, accessor: (r) => r.ref,
      cell: (r) => <a href={href(r)} data-testid="brand-row" onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-ods-navy hover:underline">{r.ref}</a>,
    },
    {
      id: 'company', header: 'Customer', width: 180, accessor: (r) => r.company,
      cell: (r) => <a href={`/admin/customers/${r.org_id}`} onClick={(e) => e.stopPropagation()} className="truncate font-semibold text-ods-blue hover:underline">{r.company}</a>,
    },
    { id: 'product', header: 'Product', width: 200, accessor: (r) => r.product_title ?? r.product_link ?? '', cell: (r) => <span className="truncate" title={r.product_title ?? r.product_link ?? ''}>{r.product_title ?? r.product_link ?? '—'}</span> },
    { id: 'qty', header: 'Qty', width: 80, numeric: true, accessor: (r) => r.quantity ?? -1, cell: (r) => (r.quantity ? formatNumber(r.quantity) : '—') },
    { id: 'branding', header: 'Branding · packaging', width: 190, sortable: false, accessor: (r) => [BRAND_METHOD[r.method ?? ''], BRAND_PACK[r.packaging ?? '']].filter(Boolean).join(' · ') || '—' },
    { id: 'dest', header: 'Stock goes to', width: 140, accessor: (r) => brandDestination(r), defaultHidden: true },
    { id: 'logos', header: 'Logos', width: 70, numeric: true, accessor: (r) => r.logo_paths.length, cell: (r) => r.logo_paths.length || '—', defaultHidden: true },
    { id: 'status', header: 'Status', width: 122, accessor: (r) => brandLabel(r.status), cell: (r) => <StatusPill tone={brandTone(r.status)}>{brandLabel(r.status)}</StatusPill> },
    {
      id: 'manager', header: 'Account manager', width: 140, accessor: (r) => r.manager_name ?? '',
      cell: (r) => (r.manager_name ? <span className="truncate">{r.manager_name}</span> : <span className="font-semibold text-ods-danger" data-testid="unassigned">Unassigned</span>),
    },
    { id: 'created', header: 'Submitted', width: 100, accessor: (r) => r.created_at, cell: (r) => formatDate(r.created_at, { short: true }) },
  ];
  const rowActions = (r: BrandRow): ContextMenuItem[] => [
    { id: 'open', label: 'Open project', icon: ExternalLink, onSelect: () => router.push(href(r)) },
    { id: 'customer', label: `Open customer ${r.company}`, icon: UserRound, onSelect: () => router.push(`/admin/customers/${r.org_id}`) },
  ];
  const unassigned = all.filter((r) => !r.manager_name && r.status !== 'closed').length;
  const grid = (
    <OctopusDataGrid<BrandRow>
      label="Brand projects"
      data-testid="brand-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.ref}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={tab !== 'all' ? 'No projects with this status' : 'No brand projects yet'}
      emptyDescription="New Make My Brand requests appear here as soon as a customer submits them."
      headingLevel={2}
      onOpenRow={(r) => router.push(href(r))}
      rowActions={rowActions}
      pagination
      defaultPageSize={50}
      searchPlaceholder="Search number, customer or product"
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );
  return (
    <div data-testid="brand-page" className="flex min-w-0 flex-col gap-4">
      <header>
        <Breadcrumbs items={[{ label: 'Services', href: '/office' }, { label: 'Make My Brand' }]} />
        <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">Brand projects</h1>
        <p className="m-0 text-ods-small text-ods-slate">Make My Brand requests from customers (MB-…). The account manager is the customer’s own; change it on the customer record.</p>
      </header>
      <KpiStrip
        data-testid="brand-kpis"
        label="Brand project figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          { label: 'Submitted', value: counts ? formatNumber(counts.submitted) : '—', hint: 'New, not started' },
          { label: 'Proof · sample', value: counts ? formatNumber(counts.proof + counts.sample) : '—' },
          { label: 'Quoted', value: counts ? formatNumber(counts.quoted) : '—' },
          { label: 'In production', value: counts ? formatNumber(counts.production) : '—' },
          { label: 'Unassigned', value: counts ? formatNumber(unassigned) : '—', hint: 'Open projects without an account manager' },
        ]}
      />
      <Tabs
        data-testid="brand-tabs"
        label="Project status"
        value={tab}
        onChange={(t) => startNav(() => router.push(brandTabHref(basePath, t as BrandTab, extraParams), { scroll: false }))}
        items={BRAND_TABS.map(([t, label]) => ({ id: t, label, count: counts?.[t], testId: `brand-tab-${t}`, panel: () => (t === tab ? <div className="pt-3">{grid}</div> : null) }))}
      />
    </div>
  );
}
