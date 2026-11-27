'use client';

import { useState } from 'react';
import { LayoutGrid, List, Plane, Ship } from 'lucide-react';
import { CardTabs, FilterPills, JumpBar, Segmented, Stepper, Tabs, formatMoney, odsServices, type CardTabItem, type FilterPillItem, type OdsDensity, type StepperStep, type TabItem } from '@octopus/ui';
import { Demo, DensityPair, State } from '../_demo';

/* ───────── demo data (lives only here) ───────── */

const STATUS_PILLS: FilterPillItem[] = [
  { id: 'waiting', label: 'Waiting for payment', count: 4 },
  { id: 'production', label: 'In production', count: 7 },
  { id: 'shipped', label: 'Shipped', count: 12 },
  { id: 'delivered', label: 'Delivered', count: 30 },
  { id: 'cancelled', label: 'Cancelled', count: 0, disabled: true, disabledReason: 'no cancelled orders in the last 12 months.' },
];

const ORDER_CARDS: CardTabItem[] = [
  { id: 'waiting', label: 'Waiting for payment', value: 4, hint: '1 overdue' },
  { id: 'production', label: 'In production', value: 7, hint: 'Next ready 2 Dec 2026' },
  { id: 'shipped', label: 'Shipped', value: 12 },
  { id: 'balance', label: 'Balance due', value: 2870, money: true, hint: 'Across 4 orders' },
];

const ORDER_STEPS: StepperStep[] = [
  { id: 'placed', label: 'Order placed', detail: '20 Nov 2026' },
  { id: 'paid', label: 'Payment received', detail: '21 Nov 2026' },
  { id: 'production', label: 'In production', detail: 'Started 24 Nov 2026' },
  { id: 'shipped', label: 'Shipped', detail: 'Expected 5 Dec 2026' },
  { id: 'delivered', label: 'Delivered' },
];

const ERROR_STEPS: StepperStep[] = [
  { id: 'placed', label: 'Order placed', detail: '20 Nov 2026' },
  { id: 'paid', label: 'Payment received', detail: '21 Nov 2026' },
  { id: 'qc', label: 'Quality check', status: 'error', errorText: '3 cartons failed. We will call you today to agree the next step.' },
  { id: 'shipped', label: 'Shipped' },
];

const COUNTS: Record<string, number> = { sourcing: 1240, pools: 18, dropship: 860, '3pl': 6, turnkey: 9, brand: 24 };

/* ───────── small demo-only panel contents ───────── */

function NotesPanel() {
  const [notes, setNotes] = useState('');
  return (
    <div className="space-y-2">
      <h3>Products</h3>
      <label className="block text-ods-label font-semibold text-ods-navy">
        Notes for the supplier
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 block w-full max-w-md rounded-ods-control border border-ods-line-strong bg-ods-surface p-2 text-ods-body font-normal"
        />
      </label>
      <p className="text-ods-small text-ods-slate">Type here, switch tabs and come back: the panel keeps its state.</p>
    </div>
  );
}

function tabItems(d: OdsDensity): TabItem[] {
  const c = d === 'comfortable';
  return [
    {
      id: 'overview',
      label: 'Overview',
      testId: 'tab-height',
      panel: (
        <div>
          <h3>Overview</h3>
          <p className="text-ods-body text-ods-slate">Order PO-10482 · 3 products · placed 20 Nov 2026.</p>
        </div>
      ),
    },
    { id: 'products', label: 'Products', count: 3, panel: () => <NotesPanel /> },
    { id: 'documents', label: 'Documents', disabled: true, disabledReason: 'documents appear after the payment is received.', panel: null },
    {
      id: 'messages',
      label: 'Messages',
      count: 0,
      panel: (
        <div className="rounded-ods-card border border-dashed border-ods-line-strong p-4 text-center">
          <h3>No messages yet</h3>
          <p className="text-ods-small text-ods-slate">Messages with your account manager will show here.</p>
        </div>
      ),
    },
    {
      id: 'activity',
      label: c ? 'Activity log' : 'Activity',
      count: 14,
      panel: (
        <div className="rounded-ods-card border border-ods-danger bg-ods-danger-tint p-4">
          <h3>We couldn’t load the activity</h3>
          <p className="text-ods-small text-ods-text">Check your connection and try again. Other tabs still work.</p>
        </div>
      ),
    },
    {
      id: 'shipping',
      label: 'Shipping',
      panel: (
        <div aria-busy="true">
          <h3>Shipping</h3>
          <div aria-hidden="true" className="mt-2 space-y-2">
            <div className="h-3 w-3/5 animate-pulse rounded bg-ods-line" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-ods-line" />
          </div>
          <span role="status" className="sr-only">
            Loading
          </span>
        </div>
      ),
    },
  ];
}

function PillsDemo({ d }: { d: OdsDensity }) {
  const [sel, setSel] = useState<string[]>(['production']);
  const total = sel.length ? STATUS_PILLS.filter((p) => sel.includes(p.id)).reduce((n, p) => n + (p.count ?? 0), 0) : STATUS_PILLS.reduce((n, p) => n + (p.count ?? 0), 0);
  const c = d === 'comfortable';
  return (
    <FilterPills
      items={STATUS_PILLS.map((p, i) => (i === 0 ? { ...p, testId: 'pill-height' } : p))}
      value={sel}
      onChange={setSel}
      label={`Filter orders by status (${d})`}
      resultText={`${total} ${total === 1 ? 'order' : 'orders'}`}
      data-testid={c ? 'filterpills-demo' : undefined}
      resultTestId={c ? 'filterpills-count' : undefined}
    />
  );
}

function SinglePills({ d }: { d: OdsDensity }) {
  const [sel, setSel] = useState<string[]>([]);
  const cats = ['Electronics', 'Home and kitchen', 'Beauty', 'Toys', 'Sports and outdoors', 'Fashion', 'Office'];
  return (
    <FilterPills
      mode="single"
      items={cats.map((c, i) => ({ id: c, label: c, count: 40 + i * 13 }))}
      value={sel}
      onChange={setSel}
      label={`Category (${d})`}
      resultText={sel.length ? `Showing ${sel[0]}` : 'Showing all categories'}
    />
  );
}

function JumpTargets({ d }: { d: OdsDensity }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 ods-tablet:grid-cols-2">
      {odsServices.map((s) => (
        <section key={s.key} id={`jump-${d}-${s.key}`} aria-labelledby={`jump-${d}-${s.key}-h`} className="scroll-mt-4 rounded-ods-card border border-ods-line bg-ods-surface p-3">
          <h3 id={`jump-${d}-${s.key}-h`}>{s.name}</h3>
          <p className="text-ods-small text-ods-slate">{COUNTS[s.key]} items. Clicking the pill above moves focus to this heading.</p>
        </section>
      ))}
    </div>
  );
}

/* ───────── sections ───────── */

export function Sections() {
  return (
    <>
      <Demo
        id="tabs"
        title="Tabs (underline)"
        note={
          <>
            Parts of one record. Arrow keys and Home / End move and select (automatic activation); the disabled tab is skipped and its reason is
            shown under the row. The comfortable copy syncs <code>?tab=</code> in the URL. Panels load the first time they open and keep their state
            (try the notes box). Panels show the empty, error and loading states. Hover: grey background; selected: navy bold with the blue bar.
          </>
        }
        phone="the tab row scrolls sideways (no wrapping) and the selected tab is scrolled into view."
      >
        <DensityPair stack>
          {(d) => (
            <Tabs
              items={tabItems(d)}
              label={`Order sections (${d})`}
              param={d === 'comfortable' ? 'tab' : undefined}
              defaultValue="overview"
              data-testid={d === 'comfortable' ? 'tabs-demo' : 'tabs-demo-compact'}
              className="rounded-ods-card bg-ods-surface p-3"
            />
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="filterpills"
        title="Filter pills"
        note="Multi-select status filter (aria-pressed, check mark when selected, count after the label, result count read out politely), a single-select category row, and the loading, error and empty states."
        phone="the pill row scrolls sideways; pills never wrap."
      >
        <DensityPair>
          {(d) => (
            <div className="space-y-4">
              <State label="Multi-select, one disabled with its reason">
                <PillsDemo d={d} />
              </State>
              <State label="Single-select (category chips)">
                <SinglePills d={d} />
              </State>
              <State label="Loading">
                <FilterPills items={[]} loading label={`Loading filters (${d})`} />
              </State>
              <State label="Error">
                <FilterPills items={[]} error="We couldn’t load the filters. Reload the page to try again." label={`Filters unavailable (${d})`} />
              </State>
              <State label="Empty">
                <FilterPills items={[]} label={`No filters (${d})`} />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="segmented"
        title="Segmented control"
        note="2–3 views. Built as a radiogroup: one view is always chosen and it doesn't own a panel, so arrows move and choose, and Tab leaves the group. One option is disabled with its reason."
        phone="use fullWidth so the segments share the row; labels stay short."
      >
        <DensityPair>
          {(d) => (
            <div className="space-y-4">
              <State label="Two views with icons">
                <Segmented
                  label={`Shipping method (${d})`}
                  data-testid={d === 'comfortable' ? 'segmented-demo' : undefined}
                  defaultValue="sea"
                  options={[
                    { value: 'sea', label: 'Sea', icon: Ship },
                    { value: 'air', label: 'Air', icon: Plane },
                  ]}
                />
              </State>
              <State label="List / Board">
                <Segmented
                  label={`View (${d})`}
                  defaultValue="board"
                  options={[
                    { value: 'list', label: 'List', icon: List },
                    { value: 'board', label: 'Board', icon: LayoutGrid },
                  ]}
                />
              </State>
              <State label="Three views, one disabled, full width">
                <Segmented
                  label={`Period (${d})`}
                  fullWidth
                  defaultValue="month"
                  options={[
                    { value: 'month', label: 'Month' },
                    { value: 'quarter', label: 'Quarter' },
                    { value: 'year', label: 'Year', disabled: true, disabledReason: 'available after 12 months of orders.' },
                  ]}
                />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="cardtabs"
        title="Card tabs"
        note={
          <>
            Numbers that filter the list below (toggle buttons with aria-pressed; click again to show everything). Values can be counts or money (
            {formatMoney(2870)}). Loading, error and empty states below.
          </>
        }
        phone="2 cards per row (4 from 768 px)."
      >
        <DensityPair stack>
          {(d) => (
            <div className="space-y-4">
              <State label="Default (the first card selected)">
                <CardTabs items={ORDER_CARDS} defaultValue="waiting" label={`Filter orders (${d})`} data-testid={d === 'comfortable' ? 'cardtabs-demo' : undefined} />
              </State>
              <State label="One card disabled with its reason">
                <CardTabs
                  items={[...ORDER_CARDS.slice(0, 3), { id: 'refunds', label: 'Refunds', value: 0, disabled: true, disabledReason: 'No refunds this year.' }]}
                  label={`Filter orders with a disabled card (${d})`}
                />
              </State>
              <State label="Loading">
                <CardTabs items={[]} loading label={`Loading order counts (${d})`} />
              </State>
              <State label="Error">
                <CardTabs items={[]} error="We couldn’t load the order counts. The list below still works." label={`Order counts unavailable (${d})`} />
              </State>
              <State label="Empty">
                <CardTabs items={[]} emptyText="No orders yet. Your first order will show its numbers here." label={`No order counts (${d})`} />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="stepper"
        title="Stepper"
        note="Done = teal check, now = blue with a halo, next = grey outline; every step carries its status in words. The second stepper shows an error step."
        phone="vertical list; horizontal from 768 px."
      >
        <DensityPair stack>
          {(d) => (
            <div className="space-y-6">
              <State label="In progress (step 3 of 5)">
                <Stepper steps={ORDER_STEPS} current={2} label={`Order progress (${d})`} data-testid={d === 'comfortable' ? 'stepper-demo' : undefined} />
              </State>
              <State label="Error step">
                <Stepper steps={ERROR_STEPS} current={2} label={`Order progress with a problem (${d})`} />
              </State>
              <State label="All done">
                <Stepper steps={ORDER_STEPS} current={ORDER_STEPS.length} label={`Completed order progress (${d})`} />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="jumpbar"
        title="Jump bar"
        note="Pill links to the six shop sections with counts. Clicking moves focus to the section heading; the section in view gets aria-current. Rendered inline here (sticky={false}); on the shop page it sticks under the header."
        phone="the pill row scrolls sideways and keeps the current section in view."
      >
        <DensityPair stack>
          {(d) => (
            <div>
              <JumpBar
                sticky={false}
                label={`Shop sections (${d})`}
                data-testid={d === 'comfortable' ? 'jumpbar-demo' : undefined}
                sections={odsServices.map((s) => ({ service: s.key, targetId: `jump-${d}-${s.key}`, count: COUNTS[s.key] }))}
              />
              <JumpTargets d={d} />
            </div>
          )}
        </DensityPair>
      </Demo>
    </>
  );
}
