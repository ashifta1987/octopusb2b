'use client';

import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Save } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  EmptyState,
  Input,
  MenuButton,
  Modal,
  OctopusDataGrid,
  Tabs,
  formatDate,
  type ContextMenuItem,
  type GridColumn,
  type GridFilterCondition,
  type GridFilterField,
  type MenuButtonItem,
} from '@octopus/ui';
import { useOfficeWorkspace } from '@/app/ods/office/_components/office-context';
import { listViewsAction, saveViewAction } from '@/app/ods/office/_actions/views';
import type { OfficeResult, SavedView, SaveViewInput } from '@/lib/office/workspace-core';
import { listQueryFromView, listQueryHref, listViewFilters, type ListQuery, type ListResult, type ListSpec } from './accounts-core';

export type ViewActions = {
  listViews: (page: string) => Promise<OfficeResult<SavedView[]>>;
  saveView: (input: SaveViewInput) => Promise<OfficeResult<SavedView>>;
};
export const LIVE_VIEW_ACTIONS: ViewActions = { listViews: listViewsAction, saveView: saveViewAction };

export type ListCtx<T> = {
  open: (id: string | null) => void;
  openTab: (href: string, title: string) => void;
  go: (patch: Partial<ListQuery>) => void;
  query: ListQuery;
  rowById: (id: string) => T | undefined;
};

export type AccountsListScreenProps<T> = {
  testId: string;
  title: string;
  /** one line under the H1 (before "· updated …") */
  subtitle: string;
  /** public path of the page (views key, open-in-tab) */
  pagePath: string;
  /** where the URL state lives (page path or fixture path) */
  basePath: string;
  extraParams?: Record<string, string>;
  spec: ListSpec;
  query: ListQuery;
  result: ListResult<T>;
  tabs: readonly (readonly [string, string])[];
  tabsLabel: string;
  noun: string;
  columns: (ctx: ListCtx<T>) => GridColumn<T>[];
  getRowId: (r: T) => string;
  rowNumber: (r: T) => string;
  rowActions?: (r: T, ctx: ListCtx<T>) => ContextMenuItem[];
  chips: { id: string; label: string }[];
  filterFields?: GridFilterField[];
  applyConditions?: (q: ListQuery, c: GridFilterCondition[]) => ListQuery;
  /** extra controls above the grid (e.g. account + dates) */
  filterBar?: (ctx: ListCtx<T>) => ReactNode;
  exportItems?: MenuButtonItem[];
  /** drawer for the open record (`openRow` = loaded by the page when not on this page) */
  renderDrawer: (row: T | null, ctx: ListCtx<T> & { close: () => void }) => ReactNode;
  openRow?: T | null;
  builtinViews: { id: string; label: string; filters: Record<string, unknown> }[];
  viewActions?: ViewActions;
  emptyTitle: string;
  emptyDescription?: string;
  searchPlaceholder: string;
  /** one note under the head (data caveats) */
  note?: ReactNode;
};

/**
 * One navigation per tick (the grid fires sort + page 0 together) and the search debounce. Module scope, not refs: the
 * ctx functions are handed to render-time column / drawer builders. One list screen per page.
 */
const nav: { pending: ListQuery | null; searchTimer: ReturnType<typeof setTimeout> | null } = { pending: null, searchTimer: null };

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
 * ODS T9 · Accounts part C — one read-only grid page (Part 7.2 / 7.4): page head, saved views, tabs, OctopusDataGrid
 * with server-side sort / filter / pagination (URL state), record drawer (?open=), loading / empty / error / no
 * permission. Used by Credit notes, Ledger and Payments.
 */
export function AccountsListScreen<T>(p: AccountsListScreenProps<T>) {
  const { query, result, spec } = p;
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const viewActions = p.viewActions ?? LIVE_VIEW_ACTIONS;
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [openId, setOpenId] = useState<string | null>(query.open);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsOff, setViewsOff] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewMsg, setViewMsg] = useState<string | null>(null);
  const rows = result.kind === 'ok' ? result.rows : [];
  const updated = useUpdatedText(result.kind === 'ok' ? result.updatedAt : null);

  const go = useCallback(
    (patch: Partial<ListQuery>) => {
      nav.pending = { ...(nav.pending ?? query), ...patch };
      setTimeout(() => {
        const next = nav.pending;
        nav.pending = null;
        if (next) startNav(() => router.push(listQueryHref(p.basePath, { ...next, open: null }, spec, p.extraParams), { scroll: false }));
      }, 0);
    },
    [query, router, p.basePath, p.extraParams, spec],
  );
  const onSearch = (v: string) => {
    setSearch(v);
    if (nav.searchTimer) clearTimeout(nav.searchTimer);
    nav.searchTimer = setTimeout(() => go({ q: v.trim(), page: 0, view: null }), 350);
  };

  useEffect(() => {
    let live = true;
    viewActions.listViews(p.pagePath).then(
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
  }, [viewActions, p.pagePath]);

  const open = (id: string | null) => {
    setOpenId(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('open', id);
    else u.searchParams.delete('open');
    window.history.replaceState(null, '', u.toString());
  };
  const ctx: ListCtx<T> = {
    open,
    openTab: (href, title) => ws.openTab(href, { title }),
    go,
    query,
    rowById: (id) => rows.find((r) => p.getRowId(r) === id),
  };
  const drawerRow = openId ? (rows.find((r) => p.getRowId(r) === openId) ?? (p.openRow && p.getRowId(p.openRow) === openId ? p.openRow : null)) : null;

  const allViews = [...p.builtinViews.map((v) => ({ id: v.id, label: v.label, filters: v.filters as unknown })), ...views.map((v) => ({ id: v.id, label: v.name, filters: v.filters as unknown }))];
  const viewId = query.view && allViews.some((v) => v.id === query.view) ? query.view : (p.builtinViews[0]?.id ?? '');
  const applyView = (id: string) => {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    const first = id === p.builtinViews[0]?.id;
    go({ ...listQueryFromView(v.filters, spec, first ? null : id), page: 0 });
  };
  const doSaveView = async () => {
    const name = viewName.trim();
    if (name.length < 2) return setViewMsg('Name the view (2 characters or more).');
    const r = await viewActions.saveView({ page: p.pagePath, name, scope: 'personal', filters: listViewFilters(query), columns: [], sort: [{ id: query.sort.id, desc: query.sort.desc }] });
    if (!r.ok) return setViewMsg(r.unavailable ? 'Saved views are not switched on yet.' : r.error);
    setViews((vs) => [...vs.filter((v) => v.id !== r.data.id), r.data]);
    setSaveOpen(false);
    setViewName('');
    setViewMsg(null);
    go({ view: r.data.id });
  };

  const filtersOn = !!query.q || p.chips.length > 0;
  const clearFilters = () => {
    setSearch('');
    go({ q: '', f: {}, view: null, page: 0 });
  };
  const head = (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={[{ label: 'Accounts', href: '/admin/finance' }, { label: p.title }]} />
        <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">{p.title}</h1>
        <p className="m-0 text-ods-small text-ods-slate">
          {p.subtitle} · {updated}
        </p>
      </div>
      {p.exportItems?.length ? (
        <MenuButton
          label={
            <span className="inline-flex items-center gap-1.5">
              <Download aria-hidden className="size-4" /> Export
            </span>
          }
          triggerAriaLabel="Export CSV"
          align="end"
          triggerClassName="inline-flex h-ods-control items-center gap-1 rounded-ods-control border border-ods-line-strong bg-ods-surface px-3 text-ods-body font-semibold text-ods-navy hover:border-ods-navy"
          items={p.exportItems}
        />
      ) : null}
    </header>
  );

  if (result.kind === 'forbidden') {
    return (
      <div data-testid={p.testId} className="flex flex-col gap-4">
        {head}
        <div className="rounded-ods-card border border-ods-line bg-ods-surface">
          <EmptyState headingLevel={2} title={`You don’t have permission to see ${p.noun}`} description="This needs the Finance view permission. Ask an admin if you need it." />
        </div>
      </div>
    );
  }

  const grid = (
    <OctopusDataGrid<T>
      label={p.title}
      data-testid={`${p.testId.replace(/-page$/, '')}-grid`}
      rows={rows}
      columns={p.columns(ctx)}
      getRowId={p.getRowId}
      rowNumber={p.rowNumber}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={p.emptyTitle}
      emptyDescription={p.emptyDescription}
      onClearFilters={clearFilters}
      onSaveView={() => setSaveOpen(true)}
      headingLevel={2}
      sort={query.sort}
      manualSort
      onSortChange={(s) => go({ sort: s ?? { ...spec.defaultSort }, page: 0 })}
      onOpenRow={(r, o) => (o.newTab ? ws.openTab(`${p.pagePath}?open=${p.getRowId(r)}`, { title: p.rowNumber(r) }) : open(p.getRowId(r)))}
      onOpenInDrawer={(r) => open(p.getRowId(r))}
      rowActions={p.rowActions ? (r) => p.rowActions!(r, ctx) : undefined}
      manualPagination
      totalRows={result.kind === 'ok' ? result.total : 0}
      page={query.page}
      onPageChange={(pg) => pg !== query.page && go({ page: pg })}
      pageSize={query.size}
      onPageSizeChange={(s) => go({ size: s as ListQuery['size'], page: 0 })}
      search={search}
      onSearchChange={onSearch}
      searchPlaceholder={p.searchPlaceholder}
      manualFiltering
      filters={p.chips}
      onRemoveFilter={(id) => {
        const f = { ...query.f };
        delete f[id];
        go({ f, page: 0, view: null });
      }}
      filterFields={p.filterFields}
      onApplyFilters={p.applyConditions ? (c) => go(p.applyConditions!(query, c)) : undefined}
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );

  const counts = result.kind === 'ok' ? result.counts : {};
  return (
    <div data-testid={p.testId} className="flex min-w-0 flex-col gap-4">
      {head}
      {p.note ?? (result.kind === 'ok' && result.note ? <p className="m-0 text-ods-small text-ods-slate">{result.note}</p> : null)}
      <div className="flex flex-wrap items-center gap-2" data-testid="saved-views">
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          View
          <select value={viewId} onChange={(e) => applyView(e.target.value)} className="h-ods-control w-56 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text">
            <optgroup label="Built-in">
              {p.builtinViews.map((v) => (
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
      {p.filterBar ? p.filterBar(ctx) : null}
      <Tabs
        data-testid={`${p.testId.replace(/-page$/, '')}-tabs`}
        label={p.tabsLabel}
        value={query.tab}
        onChange={(t) => go({ tab: t, page: 0, view: null })}
        items={p.tabs.map(([t, label]) => ({ id: t, label, count: counts[t], panel: () => (t === query.tab ? <div className="pt-3">{grid}</div> : null) }))}
      />
      {p.renderDrawer(drawerRow, { ...ctx, close: () => open(null) })}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as view" description="Saves this tab, search, filters and sort as one of your views." confirmLabel="Save view" onConfirm={() => void doSaveView()}>
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          View name
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={60} />
        </label>
        {viewMsg ? <p className="mt-2 text-ods-small text-ods-danger">{viewMsg}</p> : null}
      </Modal>
    </div>
  );
}

/** Small definition row for drawers. */
export function DetailRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 border-b border-ods-line py-2 text-ods-small last:border-b-0">
      <dt className="text-ods-slate">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-ods-text">{children}</dd>
    </div>
  );
}

/** Link that opens a Back Office route in a workspace tab (Ctrl/⌘-click handled by the frame). */
export function TabLink({ href, title, onOpen, children }: { href: string; title: string; onOpen: (href: string, title: string) => void; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(href, title);
      }}
      className="font-semibold text-ods-info underline"
    >
      {children}
    </a>
  );
}
