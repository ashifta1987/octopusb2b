'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, FilePlus2, MessageSquare, Save, UserRound } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  Input,
  KpiStrip,
  Modal,
  Money,
  OctopusDataGrid,
  StatusPill,
  Tabs,
  formatDate,
  formatNumber,
  type ContextMenuItem,
  type GridColumn,
  type KpiItem,
} from '@octopus/ui';
import { useOfficeWorkspace } from '@/app/ods/office/_components/office-context';
import { listViewsAction, saveViewAction } from '@/app/ods/office/_actions/views';
import type { OfficeResult, SavedView, SaveViewInput } from '@/lib/office/workspace-core';
import {
  BUILTIN_VIEWS, RFQS_PATH, RFQ_TABS, RFQ_VIEWS_PAGE, acceptsQuotes, currencyLabel, queryFromView, rfqQueryHref, type RfqQuery, type RfqTab,
} from '../_lib/rfq-core';
import type { RfqKpis, RfqRowVM } from '../_lib/rfq-data';

export type RfqsViewsActions = {
  listViews: (page: string) => Promise<OfficeResult<SavedView[]>>;
  saveView: (input: SaveViewInput) => Promise<OfficeResult<SavedView>>;
};
const LIVE_VIEWS: RfqsViewsActions = { listViews: listViewsAction, saveView: saveViewAction };

export type RfqsResult = { kind: 'ok'; rows: RfqRowVM[]; kpis: RfqKpis } | { kind: 'error'; error: string; kpis: RfqKpis } | { kind: 'loading' };

export type RfqsScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: RfqQuery;
  result: RfqsResult;
  perms: { canQuote: boolean; canOpenCustomer: boolean };
  views?: RfqsViewsActions;
  /** fixtures: where record links go (the real record route otherwise) */
  recordHref?: (row: RfqRowVM) => string;
};

/**
 * ODS T9 · Back Office › Sales › Sourcing requests (Part 7.6 list pattern: KpiStrip + status tabs + filter bar + grid,
 * Match ERP_Invoices). Today's list read per tab (≤ 200 rows, same order); the grid sorts / searches those rows in the
 * browser. `?f=` keeps today's keys (the sidebar "Quotes" item = `?f=to_quote`). No bulk actions: today has none.
 */
export function RfqsScreen({ basePath = RFQS_PATH, extraParams, query, result, perms, views: viewsActions = LIVE_VIEWS, recordHref }: RfqsScreenProps) {
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsOff, setViewsOff] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewMsg, setViewMsg] = useState<string | null>(null);

  const rows = useMemo(() => (result.kind === 'ok' ? result.rows : []), [result]);
  const kpis = result.kind === 'loading' ? null : result.kpis;
  const counts = kpis?.counts ?? null;
  const href = useCallback((r: RfqRowVM) => (recordHref ? recordHref(r) : r.href), [recordHref]);

  const go = (patch: Partial<RfqQuery>) => startNav(() => router.push(rfqQueryHref(basePath, { ...query, ...patch }, extraParams), { scroll: false }));

  useEffect(() => {
    let live = true;
    viewsActions.listViews(RFQ_VIEWS_PAGE).then(
      (r) => {
        if (!live) return;
        if (r.ok) setViews(r.data);
        else setViewsOff(r.unavailable ? 'Saved views are not switched on yet. The built-in views still work.' : r.error);
      },
      () => live && setViewsOff('Saved views could not be loaded.'),
    );
    return () => {
      live = false;
    };
  }, [viewsActions]);

  const allViews = [...BUILTIN_VIEWS.map((v) => ({ id: v.id, label: v.label, filters: v.filters as Record<string, unknown> })), ...views.map((v) => ({ id: v.id, label: v.name, filters: v.filters }))];
  const viewId = query.view ?? (query.f === 'to_quote' && !query.q ? 'builtin:to_quote' : 'builtin:open');
  const applyView = (id: string) => {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    const q = queryFromView((Array.isArray(v.filters) ? {} : v.filters) as Record<string, unknown>, id.startsWith('builtin:') ? null : id);
    setSearch(q.q);
    go(q);
  };
  const doSaveView = async () => {
    const name = viewName.trim();
    if (name.length < 2) return setViewMsg('Name the view (2 characters or more).');
    const r = await viewsActions.saveView({ page: RFQ_VIEWS_PAGE, name, scope: 'personal', filters: { f: query.f, q: search.trim() }, columns: [], sort: [] });
    if (!r.ok) return setViewMsg(r.unavailable ? 'Saved views are not switched on yet.' : r.error);
    setViews((vs) => [...vs.filter((v) => v.id !== r.data.id), r.data]);
    setSaveOpen(false);
    setViewName('');
    setViewMsg(null);
    go({ view: r.data.id, q: search.trim() });
  };

  const openRow = (r: RfqRowVM, newTab: boolean) => (newTab ? ws.openTab(href(r), { title: r.code }) : router.push(href(r)));

  const columns: GridColumn<RfqRowVM>[] = [
    {
      id: 'code',
      header: 'RFQ no.',
      width: 128,
      accessor: (r) => r.code,
      cell: (r) => (
        <a href={href(r)} data-testid="rfq-row" onClick={(e) => e.stopPropagation()} className="max-w-full truncate font-mono font-semibold text-ods-navy hover:underline">
          {r.code}
        </a>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      width: 168,
      accessor: (r) => `${r.customer.name} ${r.customer.place}`,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-semibold text-ods-navy">{r.customer.name}</span>
          <span className="truncate text-ods-small text-ods-slate">{r.customer.place || '—'}</span>
        </span>
      ),
    },
    {
      id: 'products',
      header: 'Products',
      width: 200,
      accessor: (r) => r.products.text,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight" title={r.products.text}>
          <span className="truncate">{r.products.firstTitle}</span>
          <span className="truncate text-ods-small text-ods-slate">
            {r.products.count === 1 ? '1 product' : `${r.products.count} products`} · {formatNumber(r.quantity)} {r.unit}
            {r.products.more ? ` (line 1) · +${r.products.more} more` : ''}
          </span>
        </span>
      ),
    },
    { id: 'service', header: 'Service', width: 92, accessor: (r) => r.service, sortable: false, defaultHidden: false },
    {
      id: 'target',
      header: 'Target / unit',
      width: 116,
      numeric: true,
      accessor: (r) => r.targetMinor ?? -1,
      cell: (r) => (r.targetMinor ? <Money amount={r.targetMinor / 100} currency={currencyLabel(r.currency)} /> : <span className="text-ods-slate">—</span>),
      defaultHidden: true,
    },
    { id: 'status', header: 'Status', width: 132, accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    {
      id: 'owner',
      header: 'Owner',
      width: 76,
      accessor: (r) => r.owner?.name ?? '',
      cell: (r) =>
        r.owner ? (
          <span title={r.owner.name} className="inline-grid size-6 place-items-center rounded-full bg-ods-blue-tint text-[11px] font-bold text-ods-info">
            <span aria-hidden>{r.owner.initials}</span>
            <span className="sr-only">{r.owner.name}</span>
          </span>
        ) : (
          <span className="text-ods-slate">—</span>
        ),
    },
    {
      id: 'created',
      header: 'Created',
      width: 96,
      accessor: (r) => r.createdAt,
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span className={r.age.late ? 'font-semibold text-ods-danger' : undefined}>
            {r.age.text}
            {r.age.late ? <span className="sr-only"> — no quote after 48 hours</span> : null}
          </span>
          <span className="text-ods-small text-ods-slate">{formatDate(r.createdAt, { short: true })}</span>
        </span>
      ),
    },
    {
      id: 'quotes',
      header: 'Quote status',
      width: 128,
      accessor: (r) => r.quotes.count,
      cell: (r) => (r.quotes.status ? <StatusPill status={r.quotes.status}>{r.quotes.text}</StatusPill> : <span className="text-ods-slate">{r.quotes.text}</span>),
    },
  ];

  const rowActions = (r: RfqRowVM): ContextMenuItem[] => [
    { id: 'open-tab', label: 'Open in new tab', icon: ExternalLink, onSelect: () => openRow(r, true) },
    ...(perms.canQuote
      ? [{
          id: 'quote',
          label: 'Add a quote',
          icon: FilePlus2,
          disabled: !acceptsQuotes(r.statusRaw),
          disabledReason: acceptsQuotes(r.statusRaw) ? undefined : 'This RFQ no longer accepts quotes.',
          onSelect: () => router.push(`${href(r)}${href(r).includes('?') ? '&' : '?'}tab=quotes&quote=new`),
        }]
      : []),
    { id: 'messages', label: 'Messages with the customer', icon: MessageSquare, onSelect: () => router.push(`${href(r)}${href(r).includes('?') ? '&' : '?'}tab=messages`) },
    ...(perms.canOpenCustomer && r.customer.id
      ? [{ id: 'customer', label: `Open customer ${r.customer.name}`, icon: UserRound, onSelect: () => ws.openTab(`/admin/customers/${r.customer.id}`, { title: r.customer.name }) }]
      : []),
  ];

  const tabLabel = RFQ_TABS.find(([t]) => t === query.f)?.[1] ?? 'Open';
  const kpi = (label: string, n: number | null | undefined, hint: string): KpiItem => (n == null ? { label, value: '—', hint: kpis ? 'Couldn’t load this figure' : undefined } : { label, value: formatNumber(n), hint });

  const grid = (
    <OctopusDataGrid<RfqRowVM>
      label="Sourcing requests"
      data-testid="rfqs-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={query.f === 'all' ? 'No requests yet' : `No ${tabLabel.toLowerCase()} requests`}
      emptyDescription="Buyer requests appear here when a customer sends an RFQ or a quote list from the Shop."
      onClearFilters={() => {
        setSearch('');
        go({ q: '', view: null });
      }}
      onSaveView={() => setSaveOpen(true)}
      headingLevel={2}
      onOpenRow={(r, o) => openRow(r, o.newTab)}
      rowActions={rowActions}
      pagination
      pageSizes={[25, 50, 100]}
      defaultPageSize={50}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search RFQ no., customer or product"
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );

  return (
    <div data-testid="rfqs-page" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Sales', href: '/office' }, { label: 'Sourcing requests' }]} />
          <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">Sourcing requests</h1>
          <p className="m-0 text-ods-small text-ods-slate">Buyer requests (RFQs). Open one to see every requested product and add quotes.</p>
        </div>
      </header>

      <KpiStrip
        data-testid="rfqs-kpis"
        label="Request figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          kpi('To quote', counts?.to_quote, 'Sent + Quoting'),
          kpi('Waiting over 48 h', kpis?.late48, 'To quote, received over 48 h ago'),
          kpi('Quote ready', counts?.quote_ready, 'Waiting for the buyer'),
          kpi('Accepted', counts?.accepted, 'Quote accepted'),
          kpi('Closed', counts?.closed, 'Expired or cancelled'),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="saved-views">
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          View
          <select
            value={allViews.some((v) => v.id === viewId) ? viewId : 'builtin:open'}
            onChange={(e) => applyView(e.target.value)}
            className="h-ods-control w-56 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text"
          >
            <optgroup label="Built-in">
              {BUILTIN_VIEWS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </optgroup>
            {views.some((v) => v.mine) ? (
              <optgroup label="My views">
                {views.filter((v) => v.mine).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {views.some((v) => !v.mine) ? (
              <optgroup label="Shared views">
                {views.filter((v) => !v.mine).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <Button variant="ghost" size="sm" iconStart={Save} onClick={() => setSaveOpen(true)} disabled={!!viewsOff} disabledReason={viewsOff ?? undefined}>
          Save view
        </Button>
      </div>

      <Tabs
        data-testid="rfqs-tabs"
        label="Request status"
        value={query.f}
        onChange={(t) => go({ f: t as RfqTab, view: null })}
        items={RFQ_TABS.map(([t, label]) => ({ id: t, label, count: counts?.[t], testId: `rfqs-tab-${t}`, panel: () => (t === query.f ? <div className="pt-3">{grid}</div> : null) }))}
      />

      {result.kind === 'ok' && rows.length >= 200 ? (
        <p className="m-0 text-ods-small text-ods-slate">Showing the first 200 requests of this tab (same limit as before). Use search or a narrower tab.</p>
      ) : null}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as view" description="Saves this tab and search as one of your views." confirmLabel="Save view" onConfirm={() => void doSaveView()}>
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          View name
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={60} placeholder="e.g. Sales · to quote" />
        </label>
        {viewMsg ? <p className="mt-2 text-ods-small text-ods-danger">{viewMsg}</p> : null}
      </Modal>
    </div>
  );
}
