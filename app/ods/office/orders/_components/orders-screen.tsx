'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, CreditCard, ExternalLink, FolderOpen, Save, Users } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  EmptyState,
  Input,
  KpiStrip,
  Modal,
  Money,
  OctopusDataGrid,
  StatusPill,
  Tabs,
  formatDate,
  type ContextMenuItem,
  type GridBulkAction,
  type GridColumn,
  type KpiItem,
} from '@octopus/ui';
import { useOfficeWorkspace } from '@/app/ods/office/_components/office-context';
import { listViewsAction, saveViewAction } from '@/app/ods/office/_actions/views';
import type { OfficeResult, SavedView, SaveViewInput } from '@/lib/office/workspace-core';
import { currencyPrefix } from '@/app/ods/office/accounts/invoices/_components/record-payment-drawer';
import {
  BUILTIN_VIEWS,
  DEFAULT_SORT,
  ORDERS_PATH,
  ORDER_TABS,
  SORTABLE,
  STEP_OPTIONS,
  VIEWS_PAGE,
  applyConditions,
  filterChips,
  orderQueryHref,
  paymentBlock,
  queryFromView,
  stepAddsInfo,
  viewFilters,
  type OrderQuery,
  type OrderRow,
  type OrderTab,
} from '../_lib/order-core';
import type { CountFigure, OrderKpis, OrderListData } from '../_lib/types';

export type OrdersViewActions = {
  listViews: (page: string) => Promise<OfficeResult<SavedView[]>>;
  saveView: (input: SaveViewInput) => Promise<OfficeResult<SavedView>>;
};
const LIVE_ACTIONS: OrdersViewActions = { listViews: listViewsAction, saveView: saveViewAction };

export type OrdersResult = { kind: 'ok'; data: OrderListData } | { kind: 'error'; error: string; kpis: OrderKpis | null } | { kind: 'loading' } | { kind: 'forbidden' };

export type OrdersScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: OrderQuery;
  result: OrdersResult;
  /** finance:approve (Record payment in the row menu) */
  perms: { canPay: boolean };
  actions?: OrdersViewActions;
  initialSelected?: string[];
};

const fig = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
const countItem = (label: string, n: CountFigure | undefined, hint: string): KpiItem =>
  n === undefined ? { label, value: '—' } : typeof n === 'number' ? { label, value: n.toLocaleString('en-US'), hint } : { label, value: '—', hint: 'Couldn’t load this figure' };

function useUpdatedText(iso: string | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);
  if (!iso) return 'loading…';
  if (now === null) return 'updated just now';
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  return min < 1 ? 'updated just now' : min < 60 ? `updated ${min} min ago` : `updated ${formatDate(iso)}`;
}

/**
 * ODS T9 · Back Office › Orders (Part 7.6 list pattern: KpiStrip + status tabs + filter bar + grid). The URL holds tab /
 * search / filters / sort / page / view; the server page (or the fixture) loads that page of rows (manual* grid props).
 * Rows open the order record (workspace tab on Ctrl/⌘-click or "Open in new tab").
 */
export function OrdersScreen({ basePath = ORDERS_PATH, extraParams, query, result, perms, actions = LIVE_ACTIONS, initialSelected }: OrdersScreenProps) {
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const [navigating, startNav] = useTransition();
  const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
  const [search, setSearch] = useState(query.q);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsOff, setViewsOff] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewMsg, setViewMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const data = result.kind === 'ok' ? result.data : null;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const kpis = result.kind === 'ok' ? result.data.kpis : result.kind === 'error' ? result.kpis : null;
  const updated = useUpdatedText(data?.updatedAt ?? null);

  const pending = useRef<OrderQuery | null>(null);
  const go = useCallback(
    (patch: Partial<OrderQuery>) => {
      pending.current = { ...(pending.current ?? query), ...patch };
      setTimeout(() => {
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        setSelected([]);
        startNav(() => router.push(orderQueryHref(basePath, next, extraParams), { scroll: false }));
      }, 0);
    },
    [query, router, basePath, extraParams],
  );

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => go({ q: v.trim(), page: 0, view: null }), 350);
  };

  useEffect(() => {
    let live = true;
    actions.listViews(VIEWS_PAGE).then(
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
  }, [actions]);

  const allViews = [...BUILTIN_VIEWS.map((v) => ({ id: v.id, label: v.label, filters: v.filters })), ...views.map((v) => ({ id: v.id, label: v.name, filters: v.filters }))];
  const viewId = query.view ?? 'builtin:active';
  const applyView = (id: string) => {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    const q = queryFromView(v.filters, id === 'builtin:active' ? '' : id);
    setSearch(q.q);
    go({ ...q, page: 0 });
  };
  const doSaveView = async () => {
    const name = viewName.trim();
    if (name.length < 2) return setViewMsg('Name the view (2 characters or more).');
    const r = await actions.saveView({ page: VIEWS_PAGE, name, scope: 'personal', filters: viewFilters(query), columns: [], sort: [{ id: query.sort.id, desc: query.sort.desc }] });
    if (!r.ok) return setViewMsg(r.unavailable ? 'Saved views are not switched on yet.' : r.error);
    setViews((vs) => [...vs.filter((v) => v.id !== r.data.id), r.data]);
    setSaveOpen(false);
    setViewName('');
    setViewMsg(null);
    go({ view: r.data.id });
  };

  const recordHref = (r: OrderRow, extra = '') => `${ORDERS_PATH}/${r.id}${extra}`;
  const openTab = (r: OrderRow, extra = '') => ws.openTab(recordHref(r, extra), { title: r.code });
  const openHere = (r: OrderRow) => startNav(() => router.push(recordHref(r)));
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(`${what} copied`),
      () => setCopied('Couldn’t copy'),
    );
  };

  const allUsd = data?.allUsd ?? true;
  const money = (minor: number, r: OrderRow) => (allUsd ? fig(minor) : <Money amount={minor / 100} currency={currencyPrefix(r.currency)} />);

  const baseColumns: GridColumn<OrderRow>[] = [
    {
      id: 'number',
      header: 'Order no.',
      width: 176,
      accessor: (r) => r.code,
      cell: (r) => (
        <a href={recordHref(r)} data-testid="order-row" onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); openHere(r); } }} className="max-w-full truncate font-mono font-semibold text-ods-navy hover:underline">
          {r.code}
        </a>
      ),
    },
    { id: 'customer', header: 'Customer', width: 180, sortable: false, accessor: (r) => r.customer, cell: (r) => <span className="truncate" title={r.country ? `${r.customer} · ${r.country}` : r.customer}>{r.customer}</span> },
    {
      id: 'products',
      header: 'Products',
      width: 220,
      sortable: false,
      accessor: (r) => r.title,
      cell: (r) => (
        <span className="truncate" title={r.title}>
          {r.title || '—'}
          {r.quantity ? <span className="text-ods-slate"> · {r.quantity.toLocaleString('en-US')} pcs</span> : null}
        </span>
      ),
    },
    { id: 'service', header: 'Service', width: 120, sortable: false, accessor: (r) => r.service },
    ...(data?.supplierColumn ? [{ id: 'supplier', header: 'Supplier', width: 100, sortable: false, accessor: (r: OrderRow) => r.supplierCode ?? '', cell: (r: OrderRow) => <span className="font-mono">{r.supplierCode ?? '—'}</span> } as GridColumn<OrderRow>] : []),
    {
      id: 'status',
      header: 'Status',
      width: 210,
      accessor: (r) => r.statusName,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <StatusPill status={r.statusName} />
          {stepAddsInfo(r.status) ? <span className={r.attention ? 'truncate text-ods-small font-semibold text-ods-danger' : 'truncate text-ods-small text-ods-slate'}>{r.step}</span> : null}
        </span>
      ),
    },
    { id: 'total', header: 'Total', currency: allUsd ? 'US$' : undefined, numeric: true, width: 124, accessor: (r) => r.totalMinor, cell: (r) => money(r.totalMinor, r) },
    { id: 'paid', header: 'Paid', numeric: true, width: 112, accessor: (r) => r.paidMinor, cell: (r) => money(r.paidMinor, r) },
    { id: 'balance', header: 'Balance', numeric: true, width: 120, sortable: false, accessor: (r) => r.balanceMinor, cell: (r) => <b className="font-semibold">{money(r.balanceMinor, r)}</b> },
    {
      id: 'owner',
      header: 'Owner',
      width: 72,
      sortable: false,
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
    { id: 'updated', header: 'Updated', width: 104, accessor: (r) => r.updatedAt, cell: (r) => formatDate(r.updatedAt, { short: true }) },
  ];
  const columns = baseColumns.map((c) => ({ ...c, sortable: c.sortable === false ? false : !!SORTABLE[c.id] }));

  const rowActions = (r: OrderRow): ContextMenuItem[] => {
    const block = paymentBlock(r.balanceMinor, perms.canPay);
    return [
      { id: 'open', label: 'Open', icon: FolderOpen, onSelect: () => openHere(r) },
      { id: 'tab', label: 'Open in new tab', icon: ExternalLink, onSelect: () => openTab(r) },
      ...(perms.canPay ? [{ id: 'pay', label: 'Record payment', icon: CreditCard, disabled: !!block, disabledReason: block ?? undefined, onSelect: () => openTab(r, '?tab=payments&pay=1') }] : []),
      ...(r.customerId ? [{ id: 'customer', label: 'Open customer', icon: Users, onSelect: () => ws.openTab(`/admin/customers/${r.customerId}`, { title: r.customer }) }] : []),
      { id: 'copy', label: 'Copy number', icon: Copy, onSelect: () => copy(r.code, r.code) },
    ];
  };

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  // bulk: only what today supports per order — no bulk status change or payment exists today
  const bulkActions: GridBulkAction<OrderRow>[] = [
    { id: 'copy', label: 'Copy numbers', icon: Copy, onClick: (rs) => copy(rs.map((r) => r.code).join('\n'), `${rs.length} order numbers`) },
    { id: 'tabs', label: 'Open in tabs', icon: ExternalLink, onClick: (rs) => rs.slice(0, 8).forEach((r) => openTab(r)) },
    ...(perms.canPay && selectedRows.length === 1 && !paymentBlock(selectedRows[0].balanceMinor, true) ? [{ id: 'pay', label: 'Record payment', icon: CreditCard, onClick: (rs: OrderRow[]) => openTab(rs[0], '?tab=payments&pay=1') }] : []),
  ];
  const bulkSummary = (rs: OrderRow[]) => {
    const by = new Map<string, number>();
    for (const r of rs) by.set(r.currency, (by.get(r.currency) ?? 0) + r.balanceMinor);
    return <span data-testid="orders-bulk-summary">balance {[...by].map(([c, m]) => `${currencyPrefix(c)} ${fig(m)}`).join(' + ')}</span>;
  };

  const counts = data?.counts ?? {};
  const chips = filterChips(query);
  const filtersOn = !!query.q || chips.length > 0;
  const clearFilters = () => {
    setSearch('');
    go({ q: '', steps: null, customer: '', view: null, page: 0 });
  };
  const tabLabel = ORDER_TABS.find(([t]) => t === query.tab)?.[1] ?? 'All';

  const head = (
    <div className="min-w-0 flex-1">
      <Breadcrumbs items={[{ label: 'Sales', href: '/office' }, { label: 'Orders' }]} />
      <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">Orders</h1>
      <p className="m-0 text-ods-small text-ods-slate">Open an order to move it through its steps, record bank payments and see its events · {updated}</p>
    </div>
  );

  if (result.kind === 'forbidden') {
    return (
      <div data-testid="orders-page" className="flex flex-col gap-4">
        {head}
        <div className="rounded-ods-card border border-ods-line bg-ods-surface">
          <EmptyState headingLevel={2} title="You don’t have permission to see orders" description="Orders need the Orders view permission. Ask an admin if you need it." />
        </div>
      </div>
    );
  }

  const grid = (
    <OctopusDataGrid<OrderRow>
      label="Orders"
      data-testid="orders-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={filtersOn ? 'No results for these filters' : query.tab === 'all' ? 'No orders yet' : `No ${tabLabel.toLowerCase()} orders`}
      emptyDescription="Orders appear here when a customer accepts a quote or joins a pool."
      onClearFilters={clearFilters}
      onSaveView={() => setSaveOpen(true)}
      headingLevel={2}
      sort={query.sort}
      manualSort
      onSortChange={(s) => go({ sort: s ?? { ...DEFAULT_SORT }, page: 0 })}
      selectable
      selected={selected}
      onSelectedChange={setSelected}
      bulkSummary={bulkSummary}
      bulkActions={bulkActions}
      onOpenRow={(r, o) => (o.newTab ? openTab(r) : openHere(r))}
      rowActions={rowActions}
      pagination
      manualPagination
      totalRows={data?.total ?? 0}
      page={query.page}
      onPageChange={(p) => p !== query.page && go({ page: p })}
      pageSize={query.size}
      onPageSizeChange={(s) => go({ size: s as OrderQuery['size'], page: 0 })}
      search={search}
      onSearchChange={onSearch}
      searchPlaceholder="Search ORD-… or title"
      manualFiltering
      filters={chips}
      onRemoveFilter={(id) => go({ [id]: id === 'customer' ? '' : null, page: 0, view: null } as Partial<OrderQuery>)}
      filterFields={[
        { id: 'steps', label: 'Step', options: STEP_OPTIONS },
        { id: 'customer', label: 'Customer' },
      ]}
      onApplyFilters={(c) => go(applyConditions(query, c))}
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );

  return (
    <div data-testid="orders-page" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">{head}</header>

      <KpiStrip
        data-testid="orders-kpis"
        label="Order figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          countItem('Active orders', kpis?.active, 'in progress'),
          countItem('Awaiting payment', kpis?.awaiting, 'deposit or balance due'),
          countItem('In production', kpis?.production, 'incl. ready to ship'),
          countItem('Ready to ship', kpis?.ready, 'create the shipment'),
          countItem('Disputed', kpis?.disputed, 'after delivery'),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="saved-views">
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          View
          <select
            value={allViews.some((v) => v.id === viewId) ? viewId : 'builtin:active'}
            onChange={(e) => applyView(e.target.value)}
            className="h-ods-control w-56 max-w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text"
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
        {filtersOn ? (
          <Button variant="link" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
        <span role="status" className="ms-auto text-ods-small text-ods-slate">
          {copied}
        </span>
      </div>

      <Tabs
        data-testid="orders-tabs"
        label="Order status"
        value={query.tab}
        onChange={(t) => go({ tab: t as OrderTab, page: 0, view: null })}
        items={ORDER_TABS.map(([t, label]) => ({ id: t, label, count: counts[t], testId: `orders-tab-${t}`, panel: () => (t === query.tab ? <div className="pt-3">{grid}</div> : null) }))}
      />

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as view" description="Saves this tab, search, filters and sort as one of your views." confirmLabel="Save view" onConfirm={() => void doSaveView()}>
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          View name
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={60} placeholder="e.g. Sales · awaiting deposit" />
        </label>
        {viewMsg ? <p className="mt-2 text-ods-small text-ods-danger">{viewMsg}</p> : null}
      </Modal>
    </div>
  );
}
