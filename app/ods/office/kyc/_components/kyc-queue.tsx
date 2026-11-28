'use client';
// ODS T9
/**
 * ODS T9 · KYC queue (Part 7.6 list pattern: KpiStrip + status tabs + grid). Same `?f=` values as today's /office/kyc
 * (open · verified · rejected · suppliers) plus `paused`; inside "Verification pending" a raw-state filter (?raw=).
 * Rows open the review record (customer submissions) or the supplier application. Phones: the grid's stacked list.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilterPills, KpiStrip, OctopusDataGrid, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import {
  KYC_RAW_FILTERS, KYC_TABS, kycKpis, kycQueueHref, kycRawLabel, supplierStatusName, SUPPLIER_RAW_LABEL, waitingDays,
  type KycQueueRow, type KycRawFilter, type KycTab, type SupplierQueueRow,
} from '../_lib/kyc-core';
import { InlineNotice } from '../../_components/sales-bits';

export type KycQueueProps = {
  tab: KycTab;
  raw: KycRawFilter | null;
  rows: KycQueueRow[];
  supplierRows: SupplierQueueRow[];
  /** suppliers:view (today's Supplier applications tab rule). */
  canViewSuppliers: boolean;
  base: string;
  nowIso: string;
  loading?: boolean;
  error?: string | null;
  /** Fixtures: no navigation. */
  sample?: boolean;
};

export function KycQueue({ tab, raw, rows, supplierRows, canViewSuppliers, base, nowIso, loading, error, sample }: KycQueueProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => { if (!sample) start(() => router.push(href)); };
  const open = (href: string, newTab: boolean) => (newTab ? window.open(href, '_blank') : go(href));
  const shown = tab === 'open' && raw ? rows.filter((r) => r.status === raw) : rows;
  const k = kycKpis(rows, nowIso);

  const cols: GridColumn<KycQueueRow>[] = [
    {
      id: 'company', header: 'Customer', accessor: (r) => r.company, width: 220, minWidth: 200,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <a href={`/office/kyc/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-6 items-center truncate font-semibold text-ods-blue hover:underline">{r.company}</a>
          {r.account && r.account !== r.company ? <span className="truncate text-ods-small text-ods-slate">{r.account}</span> : null}
        </span>
      ),
    },
    {
      id: 'status', header: 'Status', accessor: (r) => r.companyStatus, width: 270,
      cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><StatusPill status={r.companyStatus} /><span className="text-ods-small text-ods-slate">{kycRawLabel(r.status)}</span></span>,
    },
    { id: 'place', header: 'Country', accessor: (r) => r.place, cell: (r) => <span className="truncate">{r.place || '—'}</span>, width: 160 },
    { id: 'reg', header: 'Registration', accessor: (r) => r.registrationNo ?? '', cell: (r) => <span className="font-mono">{r.registrationNo ?? '—'}</span>, width: 150, defaultHidden: true },
    { id: 'docs', header: 'Documents', accessor: (r) => r.documents, numeric: true, width: 110, cell: (r) => (r.documents ? String(r.documents) : <span className="text-ods-warning">None</span>) },
    {
      id: 'submitted', header: 'Submitted', accessor: (r) => r.submittedAt ?? '', width: 150,
      cell: (r) => {
        const d = waitingDays(r.submittedAt, nowIso);
        return <span className="flex flex-col leading-tight"><span>{r.submittedAt ? formatDate(r.submittedAt) : '—'}</span>{tab === 'open' && d !== null ? <span className={`text-ods-small ${d > 2 ? 'text-ods-warning' : 'text-ods-slate'}`}>{d === 0 ? 'today' : `${d} d waiting`}</span> : null}</span>;
      },
    },
    { id: 'assignee', header: 'Reviewer', accessor: (r) => r.assignee ?? '', width: 150, cell: (r) => r.assignee ?? <span className="text-ods-slate">Not started</span> },
  ];

  const supCols: GridColumn<SupplierQueueRow>[] = [
    { id: 'ref', header: 'Reference', accessor: (r) => r.reference, width: 130, cell: (r) => <a href={`/office/kyc/supplier/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-6 items-center font-mono font-semibold text-ods-blue hover:underline">{r.reference}</a> },
    { id: 'company', header: 'Company', accessor: (r) => r.company, width: 240, cell: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-semibold">{r.company}</span>{r.email ? <span className="truncate text-ods-small text-ods-slate">{r.email}</span> : null}</span> },
    {
      id: 'status', header: 'Status', accessor: (r) => supplierStatusName(r.status), width: 230,
      cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><StatusPill status={supplierStatusName(r.status)} /><span className="text-ods-small text-ods-slate">{r.firstApproved && r.status !== 'approved' ? '1 of 2 approvals' : SUPPLIER_RAW_LABEL[r.status] ?? r.status}</span></span>,
    },
    { id: 'place', header: 'City', accessor: (r) => r.place, cell: (r) => r.place || '—', width: 170 },
    { id: 'cats', header: 'Categories', accessor: (r) => r.categories.join(', '), width: 220, cell: (r) => <span className="truncate">{r.categories.join(', ') || '—'}</span> },
    { id: 'created', header: 'Submitted', accessor: (r) => r.createdAt, cell: (r) => formatDate(r.createdAt), width: 130 },
  ];

  return (
    <div className="grid min-w-0 gap-3">
      <FilterPills
        label="KYC status"
        mode="single"
        allowEmpty={false}
        value={[tab]}
        onChange={(ids) => go(kycQueueHref(base, (ids[0] as KycTab) ?? 'open'))}
        items={KYC_TABS.filter((t) => t.id !== 'suppliers' || canViewSuppliers).map((t) => ({ id: t.id, label: t.label, testId: `kyc-tab-${t.id}` }))}
        data-testid="kyc-tabs"
      />
      {tab === 'open' && !error ? (
        <>
          <KpiStrip
            variant="strip"
            label="Verification pending"
            loading={loading}
            items={[
              { label: 'Waiting for review', value: k.total },
              { label: 'Submitted, not started', value: k.submitted },
              { label: 'In review', value: k.inReview },
              { label: 'Waiting for the customer', value: k.moreInfo, hint: 'More info requested' },
              { label: 'Waiting over 2 days', value: k.over2Days },
            ]}
            data-testid="kyc-kpis"
          />
          <FilterPills
            label="KYC state"
            mode="single"
            allowEmpty
            value={raw ? [raw] : []}
            onChange={(ids) => go(kycQueueHref(base, 'open', (ids[0] as KycRawFilter) ?? null))}
            items={KYC_RAW_FILTERS.map((id) => ({ id, label: kycRawLabel(id), count: rows.filter((r) => r.status === id).length }))}
            resultText={loading ? 'Loading…' : `${shown.length} shown`}
          />
        </>
      ) : null}

      {tab === 'suppliers' ? (
        !canViewSuppliers ? (
          <InlineNotice tone="warning" role="status">You need the Suppliers · view permission to see applications.</InlineNotice>
        ) : (
          <OctopusDataGrid
            label="Supplier applications"
            rows={supplierRows}
            columns={supCols}
            getRowId={(r) => r.id}
            rowNumber={(r) => r.reference}
            loading={loading || pending}
            error={error ? `Could not load applications: ${error}` : undefined}
            onRetry={sample ? undefined : () => router.refresh()}
            emptyTitle="No applications yet"
            emptyDescription="Applications from /suppliers appear here."
            onOpenRow={(r, o) => open(`/office/kyc/supplier/${r.id}`, o.newTab)}
            defaultSort={{ id: 'created', desc: true }}
            pagination
            headingLevel={2}
            data-testid="kyc-grid"
          />
        )
      ) : (
        <OctopusDataGrid
          label={KYC_TABS.find((t) => t.id === tab)?.label ?? 'KYC submissions'}
          rows={shown}
          columns={cols}
          getRowId={(r) => r.id}
          rowNumber={(r) => r.registrationNo ?? r.company}
          loading={loading || pending}
          error={error ? 'We couldn’t load the KYC submissions.' : undefined}
          onRetry={sample ? undefined : () => router.refresh()}
          emptyTitle={tab === 'open' ? 'Nothing to review' : 'No submissions here'}
          emptyDescription={tab === 'open' ? 'New KYC submissions appear here.' : tab === 'paused' ? 'Submissions of archived organisations appear here.' : 'Try another status.'}
          onOpenRow={(r, o) => open(`/office/kyc/${r.id}`, o.newTab)}
          defaultSort={{ id: 'submitted', desc: tab !== 'open' }}
          pagination
          headingLevel={2}
          data-testid="kyc-grid"
        />
      )}
      <p className="m-0 text-ods-small text-ods-slate">Open a submission to view its documents. Document links last 60 seconds, need a fresh 2-step code and every view is logged.</p>
    </div>
  );
}
