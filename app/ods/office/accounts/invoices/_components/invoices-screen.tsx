'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Download, ExternalLink, FileText, Save } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  EmptyState,
  Input,
  KpiStrip,
  MenuButton,
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
import { invoiceActivityAction, recordInvoicePaymentAction, type InvoiceActivityItem } from '../actions';
import {
  BUILTIN_VIEWS,
  DEFAULT_SORT,
  INVOICE_TABS,
  ISSUED_RANGES,
  SERVICE_BY_DIVISION,
  SORTABLE,
  VIEWS_PAGE,
  applyConditions,
  filterChips,
  invoiceQueryHref,
  queryFromView,
  viewFilters,
  type InvoiceKpis,
  type InvoiceListData,
  type InvoiceQuery,
  type InvoiceRow,
  type InvoiceTab,
  type KpiFigure,
  type PaymentOutcome,
} from '../_lib/invoice-core';
import { RecordPaymentDrawer, currencyPrefix, type RecordPaymentInput } from './record-payment-drawer';

export const INVOICES_PATH = '/office/accounts/invoices';

export type InvoicesActions = {
  recordPayment: (input: RecordPaymentInput) => Promise<PaymentOutcome>;
  activity: (id: string) => Promise<{ ok: true; items: InvoiceActivityItem[] } | { ok: false; error: string }>;
  listViews: (page: string) => Promise<OfficeResult<SavedView[]>>;
  saveView: (input: SaveViewInput) => Promise<OfficeResult<SavedView>>;
};

const LIVE_ACTIONS: InvoicesActions = { recordPayment: recordInvoicePaymentAction, activity: invoiceActivityAction, listViews: listViewsAction, saveView: saveViewAction };

export type InvoicesResult =
  | { kind: 'ok'; data: InvoiceListData }
  | { kind: 'error'; error: string; kpis: InvoiceKpis | null }
  | { kind: 'loading' }
  | { kind: 'forbidden' };

export type InvoicesScreenProps = {
  /** where the URL state lives: '/office/accounts/invoices' or the fixture path */
  basePath?: string;
  /** kept on every URL (fixture ?state=) */
  extraParams?: Record<string, string>;
  query: InvoiceQuery;
  result: InvoicesResult;
  perms: { canRecord: boolean; canExport: boolean };
  approvalLimitMinor: number | null;
  /** invoice from ?open= when it is not on this page */
  openRow?: InvoiceRow | null;
  /** fixtures: sample actions instead of the server actions */
  actions?: InvoicesActions;
  initialSelected?: string[];
  initialDrawer?: { amount?: string; reference?: string; outcome?: PaymentOutcome };
  /** fixtures: show every row (virtualised above 200) */
  noPagination?: boolean;
};

const fig = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(minor) / 100);
const signed = (minor: number) => (minor < 0 ? `\u2212${fig(minor)}` : fig(minor));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function kpiItem(label: string, f: KpiFigure | undefined, hint: (x: { minor: number; count: number }) => string): KpiItem {
  if (!f) return { label, value: '—' };
  if ('error' in f) return { label, value: '—', hint: 'Couldn’t load this figure' };
  return { label, value: <Money amount={f.minor / 100} />, hint: f.note ? `${hint(f)} · ${f.note}` : hint(f) };
}

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
 * ODS T9 · Back Office › Accounts › Invoices (Part 7.4, board ERP_Invoices). Presentational + client state; the URL holds
 * tab / search / filters / sort / page / view / open drawer, and the server page (or the fixture) loads that page of
 * rows. Server-side sort, filter and pagination (manual* grid props).
 */
export function InvoicesScreen({
  basePath = INVOICES_PATH,
  extraParams,
  query,
  result,
  perms,
  approvalLimitMinor,
  openRow,
  actions = LIVE_ACTIONS,
  initialSelected,
  initialDrawer,
  noPagination,
}: InvoicesScreenProps) {
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const [navigating, startNav] = useTransition();
  const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
  const [search, setSearch] = useState(query.q);
  const [drawerId, setDrawerId] = useState<string | null>(query.open);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsOff, setViewsOff] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewMsg, setViewMsg] = useState<string | null>(null);

  const data = result.kind === 'ok' ? result.data : null;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const kpis = result.kind === 'ok' ? result.data.kpis : result.kind === 'error' ? result.kpis : null;
  const updated = useUpdatedText(data?.updatedAt ?? null);
  const oldestDays = kpis && !('error' in kpis.overdue) ? (kpis.overdue.oldestDays ?? 0) : 0;

  // one navigation per tick: the grid fires sort + page(0) together
  const pending = useRef<InvoiceQuery | null>(null);
  const go = useCallback(
    (patch: Partial<InvoiceQuery>) => {
      pending.current = { ...(pending.current ?? query), ...patch };
      setTimeout(() => {
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        setSelected([]);
        startNav(() => router.push(invoiceQueryHref(basePath, { ...next, open: null }, extraParams), { scroll: false }));
      }, 0);
    },
    [query, router, basePath, extraParams],
  );

  // search: debounced, server-side
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => go({ q: v.trim(), page: 0, view: null }), 350);
  };

  // saved views (lib/office/views); built-in views always work, also when the feature is not switched on
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

  const allViews = [...BUILTIN_VIEWS.map((v) => ({ id: v.id, label: v.label, shared: true, filters: v.filters })), ...views.map((v) => ({ id: v.id, label: v.name, shared: v.scope === 'shared', filters: v.filters }))];
  const viewId = query.view ?? 'builtin:all';
  const applyView = (id: string) => {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    const q = queryFromView(v.filters, id === 'builtin:all' ? '' : id);
    go({ ...q, view: id === 'builtin:all' ? null : id, page: 0 });
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

  const openTab = (row: InvoiceRow) => ws.openTab(`${INVOICES_PATH}?open=${row.id}`, { title: row.number });
  const setOpen = (id: string | null) => {
    setDrawerId(id);
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set('open', id);
      else u.searchParams.delete('open');
      window.history.replaceState(null, '', u.toString());
    }
  };
  const drawerRow = drawerId ? (rows.find((r) => r.id === drawerId) ?? (openRow?.id === drawerId ? openRow : null)) : null;

  const allUsd = data?.allUsd ?? true;
  const money = (minor: number | null, r: InvoiceRow) => (minor === null ? <span className="text-ods-slate">—</span> : allUsd ? signed(minor) : <Money amount={minor / 100} currency={currencyPrefix(r.currency)} />);

  const baseColumns: GridColumn<InvoiceRow>[] = [
    {
      id: 'number',
      header: 'Invoice no.',
      width: 178,
      accessor: (r) => r.number,
      cell: (r) => (
        <button type="button" onClick={() => setOpen(r.id)} className="max-w-full truncate rounded-[4px] font-mono font-semibold text-ods-navy hover:underline">
          {r.number}
        </button>
      ),
    },
    { id: 'customer', header: 'Customer', width: 190, accessor: (r) => r.customer, sortable: false },
    { id: 'service', header: 'Service', width: 136, accessor: (r) => r.service, sortable: false },
    { id: 'issued', header: 'Issued', width: 104, accessor: (r) => r.issuedAt, cell: (r) => formatDate(r.issuedAt, { short: true }) },
    {
      id: 'due',
      header: 'Due',
      width: 150,
      accessor: (r) => r.dueAt,
      cell: (r) =>
        !r.dueAt ? (
          <span className="text-ods-slate">—</span>
        ) : r.status === 'Overdue' ? (
          <span className="font-semibold text-ods-danger">
            {formatDate(r.dueAt, { short: true })} · {r.daysOverdue} d late
          </span>
        ) : (
          formatDate(r.dueAt, { short: true })
        ),
    },
    { id: 'amount', header: 'Amount', currency: allUsd ? 'US$' : undefined, numeric: true, width: 140, accessor: (r) => r.amountMinor, cell: (r) => money(r.amountMinor, r) },
    { id: 'paid', header: 'Paid', numeric: true, width: 110, accessor: (r) => r.paidMinor, cell: (r) => money(r.paidMinor, r) },
    { id: 'balance', header: 'Balance', numeric: true, width: 124, accessor: (r) => r.balanceMinor, cell: (r) => <b className="font-semibold">{money(r.balanceMinor, r)}</b>, sortable: false },
    { id: 'status', header: 'Status', width: 124, accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    {
      id: 'owner',
      header: 'Owner',
      width: 76,
      accessor: (r) => r.owner?.name ?? '',
      sortable: false,
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
  ];
  const columns = baseColumns.map((c) => ({ ...c, sortable: c.sortable === false ? false : !!SORTABLE[c.id] }));

  const rowActions = (r: InvoiceRow): ContextMenuItem[] => [
    ...(perms.canRecord
      ? [{ id: 'record', label: 'Record payment', icon: CreditCard, disabled: !r.payTarget, disabledReason: r.payTarget ? undefined : (r.payBlockedReason ?? undefined), onSelect: () => setOpen(r.id) }]
      : []),
    { id: 'pdf', label: 'View document', icon: FileText, onSelect: () => window.open(`/api/documents/${r.id}/pdf`, '_blank', 'noopener') },
    ...(r.orderId ? [{ id: 'order', label: `Open order ${r.orderCode ?? ''}`.trim(), icon: ExternalLink, onSelect: () => ws.openTab(`/office/orders/${r.orderId}`, { title: r.orderCode ?? 'Order' }) }] : []),
  ];

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const bulkActions: GridBulkAction<InvoiceRow>[] =
    perms.canRecord && selectedRows.length === 1 && selectedRows[0].payTarget ? [{ id: 'record', label: 'Record payment', icon: CreditCard, onClick: (rs) => setOpen(rs[0].id) }] : [];
  const bulkSummary = (rs: InvoiceRow[]) => {
    const by = new Map<string, number>();
    for (const r of rs) by.set(r.currency, (by.get(r.currency) ?? 0) + r.balanceMinor);
    return (
      <span data-testid="bulk-bar">
        balance {[...by].map(([c, m]) => `${currencyPrefix(c)} ${signed(m)}`).join(' + ')}
      </span>
    );
  };

  const counts = data?.counts ?? {};
  const chips = filterChips(query);
  const filtersOn = !!query.q || chips.length > 0;
  const clearFilters = () => {
    setSearch('');
    go({ q: '', service: null, customer: '', issued: null, view: null, page: 0 });
  };
  const tabLabel = INVOICE_TABS.find(([t]) => t === query.tab)?.[1] ?? 'All';
  const monthParam = new Date().toISOString().slice(0, 7);

  if (result.kind === 'forbidden') {
    return (
      <div data-testid="invoices-page" className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: 'Accounts', href: '/admin/finance' }, { label: 'Invoices' }]} />
        <h1 className="text-ods-h1 font-bold text-ods-navy">Invoices</h1>
        <div className="rounded-ods-card border border-ods-line bg-ods-surface">
          <EmptyState headingLevel={2} title="You don’t have permission to see invoices" description="Invoices need the Finance view permission. Ask an admin if you need it." />
        </div>
      </div>
    );
  }

  const grid = (
    <OctopusDataGrid<InvoiceRow>
      label="Invoices"
      data-testid="invoices-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.number}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={query.tab === 'all' ? 'No invoices yet' : `No ${tabLabel.toLowerCase()} invoices`}
      emptyDescription="Invoices appear here when proformas, tax invoices or credit notes are issued."
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
      onOpenRow={(r, o) => (o.newTab ? openTab(r) : setOpen(r.id))}
      onOpenInDrawer={(r) => setOpen(r.id)}
      rowActions={rowActions}
      pagination={!noPagination}
      manualPagination={!noPagination}
      totalRows={noPagination ? undefined : (data?.total ?? 0)}
      page={query.page}
      onPageChange={(p) => p !== query.page && go({ page: p })}
      pageSize={query.size}
      onPageSizeChange={(s) => go({ size: s as InvoiceQuery['size'], page: 0 })}
      search={search}
      onSearchChange={onSearch}
      searchPlaceholder="Search invoice no. or customer"
      manualFiltering
      filters={chips}
      onRemoveFilter={(id) => go({ [id]: id === 'customer' ? '' : null, page: 0, view: null } as Partial<InvoiceQuery>)}
      filterFields={[
        { id: 'service', label: 'Service', options: Object.values(SERVICE_BY_DIVISION) },
        { id: 'issued', label: 'Issued', options: ISSUED_RANGES.map(([, l]) => l) },
        { id: 'customer', label: 'Customer' },
      ]}
      onApplyFilters={(c) => go(applyConditions(query, c))}
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
      maxHeight={noPagination ? '560px' : undefined}
    />
  );

  return (
    <div data-testid="invoices-page" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Accounts', href: '/admin/finance' }, { label: 'Invoices' }]} />
          <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">Invoices</h1>
          <p className="m-0 text-ods-small text-ods-slate">All services · US$ · {updated}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perms.canExport ? (
            <MenuButton
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Download aria-hidden className="size-4" /> Export
                </span>
              }
              triggerAriaLabel="Export finance CSV"
              align="end"
              triggerClassName="inline-flex h-ods-control items-center gap-1 rounded-ods-control border border-ods-line-strong bg-ods-surface px-3 text-ods-body font-semibold text-ods-navy hover:border-ods-navy"
              items={[
                { id: 'payments', label: 'Payments this month (CSV)', href: `/admin/finance/export?type=payments&month=${monthParam}`, description: 'Today’s finance export' },
                { id: 'journals', label: 'Journals this month (CSV)', href: `/admin/finance/export?type=journals&month=${monthParam}` },
                { id: 'revenue', label: 'Revenue by stream (CSV)', href: `/admin/finance/export?type=revenue&month=${monthParam}` },
              ]}
            />
          ) : null}
        </div>
      </header>

      <KpiStrip
        data-testid="invoices-kpis"
        label="Invoice figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          kpiItem('Receivables', kpis?.receivables, (f) => plural(f.count, 'open invoice')),
          kpiItem('Overdue', kpis?.overdue, (f) => `${plural(f.count, 'invoice')}${f.count && oldestDays ? ` · oldest ${plural(oldestDays, 'day')}` : ''}`),
          kpiItem('Due in 7 days', kpis?.due7, (f) => plural(f.count, 'invoice')),
          kpiItem('Paid this month', kpis?.paidMonth, (f) => plural(f.count, 'payment')),
          kpiItem('Held (Payment protection)', kpis?.held, (f) => plural(f.count, 'hold')),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="saved-views">
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          View
          <select
            value={allViews.some((v) => v.id === viewId) ? viewId : 'builtin:all'}
            onChange={(e) => applyView(e.target.value)}
            className="h-ods-control w-56 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text"
          >
            <optgroup label="Built-in">
              {allViews.filter((v) => v.id.startsWith('builtin:')).map((v) => (
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
      </div>

      <Tabs
        data-testid="invoices-tabs"
        label="Invoice status"
        value={query.tab}
        onChange={(t) => go({ tab: t as InvoiceTab, page: 0, view: null })}
        items={INVOICE_TABS.map(([t, label]) => ({ id: t, label, count: counts[t], testId: `invoices-tab-${t}`, panel: () => (t === query.tab ? <div className="pt-3">{grid}</div> : null) }))}
      />

      <RecordPaymentDrawer
        row={drawerRow}
        onClose={() => setOpen(null)}
        canRecord={perms.canRecord}
        approvalLimitMinor={approvalLimitMinor}
        onSave={actions.recordPayment}
        loadActivity={actions.activity}
        onOpenInTab={openTab}
        onSaved={() => router.refresh()}
        initial={initialDrawer}
      />

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save as view"
        description="Saves this tab, search, filters and sort as one of your views."
        confirmLabel="Save view"
        onConfirm={() => void doSaveView()}
      >
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          View name
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={60} placeholder="e.g. Finance · to chase" />
        </label>
        {viewMsg ? <p className="mt-2 text-ods-small text-ods-danger">{viewMsg}</p> : null}
      </Modal>
    </div>
  );
}

