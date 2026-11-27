'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  Download,
  FileText,
  Keyboard,
  LayoutDashboard,
  Mail,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Receipt,
  Send,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Button,
  CommandPalette,
  ContextMenu,
  Kbd,
  OctopusDataGrid,
  ShortcutsList,
  StatusPill,
  Workspace,
  formatDate,
  formatMoney,
  formatNumber,
  useContextMenu,
  type CommandPaletteItem,
  type ContextMenuItem,
  type GridColumn,
  type GridFilterChip,
  type GridSort,
  type WorkspaceHandle,
  type WorkspaceTab,
} from '@octopus/ui';
import { DensityPair, Demo, State } from '../_demo';

/* ───────── demo data (lives only here) ───────── */

type Invoice = {
  id: string;
  number: string;
  customer: string;
  service: string;
  issued: string;
  due: string;
  amount: number;
  paid: number;
  status: 'Draft' | 'Sent' | 'Partly paid' | 'Overdue' | 'Paid';
  owner: string;
};

const CUSTOMERS = ['Gulf Home Trading', 'Nour Kitchenware LLC', 'Bayt Living', 'Al Noor Retail', 'Desert Bloom Cosmetics', 'Marina Gadgets', 'Oasis Pet Supplies', 'Sahara Sports FZE', 'Lulu Baby Store', 'Pearl Office Supplies'];
const SERVICES = ['Sourcing', 'MOQ pools', 'Dropshipping', 'Warehouse (3PL)', 'Turnkey', 'Make My Brand'];
const STATUSES: Invoice['status'][] = ['Draft', 'Sent', 'Partly paid', 'Overdue', 'Paid'];
const OWNERS = ['Priya S.', 'Omar K.', 'Lina M.', 'Ravi P.'];

/** Deterministic rows (same on server and client). */
function makeInvoices(n: number, start = 1001): Invoice[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i + start;
    const amount = Math.round((((k * 7919) % 9000) + 350) * 100 + ((k * 37) % 100)) / 100;
    const status = STATUSES[(k * 3) % STATUSES.length];
    const paid = status === 'Paid' ? amount : status === 'Partly paid' ? Math.round(amount * 40) / 100 : 0;
    const day = (k % 27) + 1;
    const month = 8 + (k % 4); // Sep–Dec
    const issued = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dueMonth = month + 1 > 12 ? 1 : month + 1;
    const due = `${month + 1 > 12 ? 2027 : 2026}-${String(dueMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
      id: `inv-${k}`,
      number: `INV-${k}`,
      customer: CUSTOMERS[(k * 5) % CUSTOMERS.length],
      service: SERVICES[(k * 11) % SERVICES.length],
      issued,
      due,
      amount,
      paid,
      status,
      owner: OWNERS[k % OWNERS.length],
    };
  });
}

const INVOICES = makeInvoices(312);
const MANY = makeInvoices(1000, 5001);
const money = (n: number) => formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function invoiceColumns(onOpen: (r: Invoice) => void): GridColumn<Invoice>[] {
  return [
    {
      id: 'number',
      header: 'Invoice no.',
      width: 120,
      accessor: (r) => r.number,
      cell: (r) => (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(r);
          }}
          className="font-semibold text-ods-info underline-offset-2 hover:underline"
        >
          {r.number}
        </button>
      ),
    },
    { id: 'customer', header: 'Customer', width: 200, accessor: (r) => r.customer },
    { id: 'service', header: 'Service', width: 140, accessor: (r) => r.service },
    { id: 'issued', header: 'Issued', width: 110, accessor: (r) => r.issued, cell: (r) => formatDate(r.issued) },
    {
      id: 'due',
      header: 'Due',
      width: 110,
      accessor: (r) => r.due,
      cell: (r) => <span className={r.status === 'Overdue' ? 'font-semibold text-ods-danger' : undefined}>{formatDate(r.due)}</span>,
    },
    { id: 'amount', header: 'Amount', currency: 'US$', numeric: true, width: 140, accessor: (r) => r.amount, cell: (r) => money(r.amount) },
    { id: 'paid', header: 'Paid', currency: 'US$', numeric: true, width: 120, accessor: (r) => r.paid, cell: (r) => money(r.paid) },
    { id: 'balance', header: 'Balance', currency: 'US$', numeric: true, width: 140, accessor: (r) => r.amount - r.paid, cell: (r) => money(r.amount - r.paid) },
    { id: 'status', header: 'Status', width: 130, accessor: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    { id: 'owner', header: 'Owner', width: 110, accessor: (r) => r.owner },
    { id: 'cost', header: 'Supplier cost', currency: 'US$', numeric: true, width: 150, defaultHidden: true, accessor: (r) => Math.round(r.amount * 62) / 100, cell: (r) => money(Math.round(r.amount * 62) / 100) },
  ];
}

const VIEWS = [
  { id: 'mine', label: 'My open invoices' },
  { id: 'chase', label: 'Finance · to chase', shared: true },
  { id: 'all', label: 'All invoices', shared: true },
];
const DEFAULT_FILTERS: GridFilterChip[] = [
  { id: 'status', label: 'Status: not paid' },
  { id: 'service', label: 'Service: all' },
  { id: 'issued', label: 'Issued: this quarter' },
];
const FILTER_FIELDS = [
  { id: 'status', label: 'Status', options: STATUSES },
  { id: 'service', label: 'Service', options: SERVICES },
  { id: 'customer', label: 'Customer' },
  { id: 'balance', label: 'Balance (US$)' },
  { id: 'due', label: 'Due date' },
];
const EXPORTABLE = ['number', 'customer', 'service', 'issued', 'due', 'amount', 'paid', 'balance', 'status', 'owner']; // no supplier cost

const PALETTE_ITEMS: CommandPaletteItem[] = [
  ...INVOICES.slice(0, 6).map((r) => ({
    id: r.id,
    group: 'records' as const,
    label: r.number,
    description: `Invoice · ${r.customer} · ${formatMoney(r.amount - r.paid)} · ${r.status}`,
    icon: Receipt,
    href: `/office/invoices/${r.id}`,
  })),
  { id: 'cus-gulf', group: 'records', label: 'Gulf Home Trading', description: 'Customer · Dubai · 14 open orders', icon: Building2, href: '/office/customers/gulf' },
  { id: 'cus-nour', group: 'records', label: 'Nour Kitchenware LLC', description: 'Customer · Sharjah', icon: Building2, href: '/office/customers/nour' },
  { id: 'rfq-2208', group: 'records', label: 'RFQ-2208 · Silicone baking mats', description: 'Sourcing request · Quoting', icon: FileText, href: '/office/rfqs/2208' },
  { id: 'act-pay', group: 'actions', label: 'Record payment for INV-1004', icon: Banknote, permission: 'payments.record' },
  { id: 'act-quote', group: 'actions', label: 'New quote for Gulf Home Trading', icon: Plus },
  { id: 'act-refund', group: 'actions', label: 'Refund a payment', description: 'Needs the Refunds permission', icon: Wallet, permission: 'payments.refund' },
  { id: 'go-dash', group: 'goto', label: 'Dashboard', icon: LayoutDashboard, shortcut: ['G', 'D'], href: '/office' },
  { id: 'go-inv', group: 'goto', label: 'Invoices', icon: Receipt, shortcut: ['G', 'I'], href: '/office/invoices' },
  { id: 'go-cus', group: 'goto', label: 'Customers', icon: Users, shortcut: ['G', 'C'], href: '/office/customers' },
  { id: 'go-ord', group: 'goto', label: 'Orders', icon: Package, shortcut: ['G', 'O'], href: '/office/orders' },
  { id: 'go-users', group: 'goto', label: 'Users and roles', icon: Users, permission: 'admin.users', href: '/office/admin/users' },
];
const PERMS = new Set(['payments.record']); // demo role: Finance (no refunds, no admin)
const can = (p: string) => PERMS.has(p);

const WS_ICONS = { dashboard: LayoutDashboard, invoice: Receipt, customer: Building2, orders: Package };
const WS_TABS: WorkspaceTab[] = [
  { id: 'dash', title: 'Dashboard', icon: 'dashboard', pinned: true, href: '/office' },
  { id: 'invoices', title: 'Invoices', icon: 'invoice', href: '/office/invoices' },
  { id: 'inv-1042', title: 'INV-1042 · Gulf Home Trading', icon: 'invoice', href: '/office/invoices/inv-1042', dirty: true },
  { id: 'cus-gulf', title: 'Gulf Home Trading', icon: 'customer', href: '/office/customers/gulf' },
  { id: 'orders', title: 'Orders · waiting for payment', icon: 'orders', href: '/office/orders' },
];

/* ───────── sections ───────── */

export function Sections() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [last, setLast] = useState('');
  const ws = useRef<WorkspaceHandle>(null);
  const extra = useRef(2000);

  const openRecord = (item: { id: string; title: string; icon?: string; href?: string }, newTab: boolean) => {
    ws.current?.open({ id: item.id, title: item.title, icon: item.icon, href: item.href }, { activate: !newTab });
    setLast(`Opened ${item.title}${newTab ? ' in a new tab' : ''}.`);
  };

  return (
    <div className="mt-6">
      <p role="status" className="min-h-6 text-ods-small text-ods-slate" data-testid="data-last-action">
        {last}
      </p>

      <Demo
        id="palette"
        title="Command palette and keyboard shortcuts"
        note={
          <>
            Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> (or <Kbd>⌘</Kbd> <Kbd>K</Kbd>) anywhere on this page. Recent items come first; “Refund a payment” and “Users
            and roles” are hidden because the demo role (Finance) lacks those permissions. Ctrl + Enter opens a record in a new workspace tab.
          </>
        }
        phone="the palette opens full screen; the footer key hints are hidden."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="palette-open" variant="secondary" iconStart={Keyboard} onClick={() => setPaletteOpen(true)}>
            Open command palette
          </Button>
          <label className="inline-flex items-center gap-2 text-ods-small">
            <input type="checkbox" checked={paletteLoading} onChange={(e) => setPaletteLoading(e.target.checked)} className="size-6 accent-(--ods-blue)" />
            Show the loading state (server search)
          </label>
        </div>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          items={PALETTE_ITEMS}
          recent={['inv-1003', 'go-inv', 'cus-gulf']}
          can={can}
          loading={paletteLoading}
          onSelect={(item, { newTab }) => {
            if (item.group === 'actions') setLast(`Action: ${item.label}.`);
            else openRecord({ id: item.id, title: item.label, icon: item.group === 'goto' ? undefined : item.icon === Building2 ? 'customer' : 'invoice', href: item.href }, newTab);
          }}
        />
        <div className="mt-6">
          <DensityPair>
            {(d) => (
              <div className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
                <h3 className="mb-3">Keyboard shortcuts ({d})</h3>
                <ShortcutsList />
              </div>
            )}
          </DensityPair>
        </div>
      </Demo>

      <Demo
        id="workspace"
        title="Workspace tabs"
        note={
          <>
            Dashboard is pinned. “INV-1042” has unsaved changes (amber dot): closing it asks first. Tabs that don’t fit go into “n more”. The limit is 12:
            opening the 13th asks to close the oldest tab. Keys: ← → Home End inside the strip, Enter opens, Delete closes; <Kbd>Alt</Kbd> <Kbd>W</Kbd>{' '}
            closes the current tab; <Kbd>Ctrl</Kbd> <Kbd>Tab</Kbd> switches. Open tabs are saved in this browser (localStorage) and come back after a
            reload. “+” opens the command palette.
          </>
        }
        phone="the Back Office on phones has no tabs (bottom nav instead). If shown, only the active tab stays and the rest move into “n more”."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            iconStart={Plus}
            onClick={() => {
              const k = extra.current++;
              openRecord({ id: `inv-${k}`, title: `INV-${k} · ${CUSTOMERS[k % CUSTOMERS.length]}`, icon: 'invoice', href: `/office/invoices/inv-${k}` }, false);
            }}
          >
            Open another invoice
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconStart={Pencil}
            onClick={() => {
              const s = ws.current?.getState();
              const t = s?.tabs.find((x) => x.id === s.activeId);
              if (t && !t.pinned) ws.current?.markDirty(t.id, !t.dirty);
            }}
          >
            Toggle unsaved changes on the current tab
          </Button>
        </div>
        <DensityPair stack>
          {(d) => (
            <div className="rounded-ods-control border border-ods-line bg-ods-surface">
              <Workspace
                ref={d === 'compact' ? ws : undefined}
                data-testid={d === 'compact' ? 'workspace-demo' : undefined}
                label={`Open tabs (${d})`}
                defaultTabs={WS_TABS}
                defaultActiveId="invoices"
                icons={WS_ICONS}
                storageKey={d === 'compact' ? 'ods.dev.workspace' : undefined}
                hotkeys={d === 'compact'}
                onNewTab={() => setPaletteOpen(true)}
                onSave={() => new Promise((r) => setTimeout(r, 400))}
                onActivate={(t) => d === 'compact' && setLast(`Showing ${t.title}.`)}
              />
              <div className="p-ods-pad-card text-ods-small text-ods-slate">The page for the active tab shows here (each tab is a real route).</div>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="grid"
        title="OctopusDataGrid · Invoices"
        note={
          <>
            312 rows, 25/50/100 per page. Click a header to sort (ascending → descending → none); drag a header edge or focus it and use ← → to resize; Columns
            shows/hides columns (Supplier cost is hidden and can’t be exported). Tab to a row, then ↑ ↓ or J K, Enter opens, Ctrl + Enter opens in a new tab,
            Space selects, Shift + F10 or right-click opens the row menu. Press “/” to jump to the search. Filter chips, saved views and the advanced filter
            panel are UI shells here (they don’t change the rows).
          </>
        }
        phone="grids are desktop staff tools: phones get “Open this on a computer to edit” and a read-only stacked list of the first 20 rows."
      >
        <DensityPair stack>{(d) => <InvoiceGrid density={d} onOpen={(r, newTab) => openRecord({ id: r.id, title: `${r.number} · ${r.customer}`, icon: 'invoice' }, newTab)} />}</DensityPair>
      </Demo>

      <Demo id="grid-states" title="Grid states" note="Loading keeps the header and shows skeleton rows; no results offers Clear filters and Save as view; errors offer Try again." phone="the same states, in the read-only list.">
        <DensityPair stack>{(d) => <GridStates density={d} />}</DensityPair>
      </Demo>

      <Demo
        id="grid-virtual"
        title="Virtualised grid · 1,000 rows"
        note="Above 200 rows the body is virtualised (@tanstack/react-virtual): only the rows on screen are in the page, the header stays sticky and the first column stays frozen. Screen readers get the real row numbers (aria-rowcount / aria-rowindex)."
        phone="read-only list of the first 20 rows."
      >
        <div data-density="compact" className="rounded-ods-card border border-dashed border-ods-line-strong bg-ods-canvas p-3">
          <VirtualGrid onOpen={(r, newTab) => openRecord({ id: r.id, title: r.number, icon: 'invoice' }, newTab)} />
        </div>
      </Demo>

      <Demo
        id="contextmenu"
        title="Context menu"
        note="Right-click the box, or use the ⋯ button (Enter, Space or Shift + F10). ↑ ↓ Home End move, Enter chooses, Esc closes and focus goes back. Destructive actions are always last, in red."
        phone="opened with ⋯ (no right-click on touch); it stays inside the screen."
      >
        <DensityPair>{(d) => <MenuDemo density={d} onPick={setLast} />}</DensityPair>
      </Demo>
    </div>
  );
}

function InvoiceGrid({ density, onOpen }: { density: string; onOpen: (r: Invoice, newTab: boolean) => void }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('chase');
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const main = density === 'compact';
  const columns = useMemo(() => invoiceColumns((r) => onOpen(r, false)), [onOpen]);
  return (
    <div className="min-w-0">
      <OctopusDataGrid
        data-testid={main ? 'grid-demo' : undefined}
        label={main ? 'Invoices' : 'Invoices (comfortable copy)'}
        searchPlaceholder="Search in invoices"
        rows={INVOICES}
        columns={columns}
        getRowId={(r) => r.id}
        rowNumber={(r) => r.number}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkSummary={(rows) => `balance ${formatMoney(rows.reduce((s, r) => s + r.amount - r.paid, 0))}`}
        bulkActions={[
          { id: 'remind', label: 'Send reminder', icon: Send, onClick: (rows) => setNote(`Reminder queued for ${rows.length} invoices.`) },
          { id: 'pay', label: 'Record payment', icon: Banknote, onClick: (rows) => setNote(`Record payment for ${rows.length} invoices.`) },
          { id: 'export', label: 'Export', icon: Download, onClick: (rows) => setNote(`Exporting ${rows.length} invoices.`) },
          { id: 'mark', label: 'Mark as…', icon: MoreHorizontal, onClick: () => setNote('Mark as… (menu comes with the Invoices page).') },
        ]}
        onOpenRow={(r, { newTab }) => onOpen(r, newTab)}
        onOpenInDrawer={(r) => setNote(`Opened ${r.number} in the drawer.`)}
        rowActions={(r) => [
          { id: 'pay', label: 'Record payment', icon: Banknote, onSelect: () => setNote(`Record payment for ${r.number}.`) },
          { id: 'remind', label: 'Send reminder', icon: Mail, onSelect: () => setNote(`Reminder sent for ${r.number}.`) },
          { id: 'cancel', label: 'Cancel invoice', icon: XCircle, destructive: true, onSelect: () => setNote(`Cancel ${r.number}? (asks first on the real page)`) },
          { id: 'void', label: 'Delete draft', icon: Trash2, destructive: true, disabled: r.status !== 'Draft', disabledReason: r.status !== 'Draft' ? 'Only drafts can be deleted' : undefined },
        ]}
        views={VIEWS}
        viewId={view}
        onViewChange={setView}
        filters={filters}
        onRemoveFilter={(id) => setFilters(filters.filter((f) => f.id !== id))}
        filterFields={FILTER_FIELDS}
        onApplyFilters={(c, j) => setNote(`Filters applied: ${c.length} condition(s), match ${j === 'and' ? 'all' : 'any'}.`)}
        onClearFilters={() => setFilters([])}
        densityToggle
        exportColumns={EXPORTABLE}
        onExport={(f, cols) => setNote(`Export ${f.toUpperCase()} with ${cols.length} columns.`)}
        onRefresh={() => setNote('Refreshed.')}
        hotkeys={main}
        maxHeight="520px"
      />
      <p role="status" className="mt-2 min-h-5 text-ods-small text-ods-slate">
        {note}
      </p>
    </div>
  );
}

function VirtualGrid({ onOpen }: { onOpen: (r: Invoice, newTab: boolean) => void }) {
  const columns = useMemo(() => invoiceColumns((r) => onOpen(r, false)), [onOpen]);
  return (
    <OctopusDataGrid
      data-testid="grid-virtual-demo"
      label="All invoices (1,000)"
      rows={MANY}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.number}
      selectable
      pagination={false}
      hotkeys={false}
      maxHeight="420px"
      bulkSummary={(rows) => `balance ${formatMoney(rows.reduce((s, r) => s + r.amount - r.paid, 0))}`}
      onOpenRow={(r, { newTab }) => onOpen(r, newTab)}
    />
  );
}

function GridStates({ density }: { density: string }) {
  const columns = useMemo(() => invoiceColumns(() => {}).slice(0, 6), []);
  const [loading, setLoading] = useState(true);
  const common = { columns, getRowId: (r: Invoice) => r.id, hotkeys: false, selectable: true, maxHeight: '320px', searchPlaceholder: 'Search in invoices' };
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <State label="Loading (header stays)">
        <OctopusDataGrid {...common} label={`Invoices loading (${density})`} rows={INVOICES.slice(0, 5)} loading={loading} />
        <Button className="mt-2" variant="ghost" size="sm" onClick={() => setLoading(!loading)}>
          {loading ? 'Show loaded rows' : 'Show loading again'}
        </Button>
      </State>
      <State label="No results for these filters">
        <OctopusDataGrid
          {...common}
          label={`Invoices with no results (${density})`}
          rows={[]}
          filters={[{ id: 'status', label: 'Status: overdue' }, { id: 'customer', label: 'Customer: Bayt Living' }]}
          onRemoveFilter={() => {}}
          onClearFilters={() => {}}
          onSaveView={() => {}}
        />
      </State>
      <State label="Error">
        <OctopusDataGrid {...common} label={`Invoices that failed to load (${density})`} rows={[]} error onRetry={() => {}} />
      </State>
      <State label="Empty (no filters)">
        <OctopusDataGrid {...common} label={`Invoices empty (${density})`} rows={[]} emptyTitle="No invoices yet" emptyDescription="Invoices appear here when an order is confirmed." />
      </State>
    </div>
  );
}

function MenuDemo({ density, onPick }: { density: string; onPick: (s: string) => void }) {
  const m = useContextMenu();
  const btn = useRef<HTMLButtonElement>(null);
  const items: ContextMenuItem[] = [
    { id: 'open', label: 'Open in new tab', icon: FileText, shortcut: 'Ctrl ↵', onSelect: () => onPick('Open in new tab.') },
    { id: 'drawer', label: 'Open in drawer', icon: Receipt, onSelect: () => onPick('Open in drawer.') },
    { id: 'copy', label: 'Copy number', icon: FileText, shortcut: 'Ctrl C', onSelect: () => onPick('Copied INV-1042.') },
    { id: 'cancel', label: 'Cancel invoice', icon: XCircle, destructive: true, onSelect: () => onPick('Cancel invoice.') },
    { id: 'sep', separator: true },
    { id: 'pay', label: 'Record payment', icon: Banknote, onSelect: () => onPick('Record payment.') },
    { id: 'credit', label: 'Issue credit note', icon: Wallet, disabled: true, disabledReason: 'Only paid invoices can be credited' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="note"
        aria-label={`Right-click area (${density})`}
        onContextMenu={(e) => {
          e.preventDefault();
          m.openAt({ x: e.clientX, y: e.clientY });
        }}
        className="grid h-24 min-w-0 flex-1 place-items-center rounded-ods-card border border-dashed border-ods-line-strong bg-ods-surface text-ods-small text-ods-slate"
      >
        Right-click here
      </div>
      <button
        ref={btn}
        type="button"
        aria-label="Actions for INV-1042"
        aria-haspopup="menu"
        aria-expanded={m.open}
        onClick={(e) => m.openAt(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'F10' && e.shiftKey) {
            e.preventDefault();
            m.openAt(e.currentTarget);
          }
        }}
        className="inline-grid size-ods-control place-items-center rounded-ods-control border border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy"
      >
        <MoreHorizontal aria-hidden className="size-ods-icon" />
      </button>
      <ContextMenu open={m.open} anchor={m.anchor} onClose={m.onClose} items={items} label="Actions for INV-1042" returnFocusRef={btn} />
    </div>
  );
}
