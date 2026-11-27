'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, ExternalLink, Filter, Plus, Search, Trash2 } from 'lucide-react';
import {
  ActivityFeed,
  BrandCard,
  Button,
  Card,
  DataTable,
  DropshipCard,
  EmptyState,
  ErrorState,
  IconButton,
  KpiStrip,
  Money,
  Panel,
  PoolCard,
  ProductCardSkeleton,
  STATUS_NAMES,
  ServiceCard,
  ServiceSection,
  Skeleton,
  SourcingCard,
  StatusPill,
  Timeline,
  TurnkeyCard,
  type DataTableColumn,
  type KpiItem,
} from '@octopus/ui';
import { DensityPair, Demo, State } from '../_demo';

/* ───────── demo data (lives only here) ───────── */

const noop = () => {};
const SRC = [
  { title: 'Silicone baking mat set', fromPrice: 1.45, unit: 'set', moq: 500, delivery: '15–20 days', badges: [{ label: 'Verified', tone: 'success' as const }, { label: 'Samples', tone: 'info' as const }] },
  { title: 'LED desk lamp', fromPrice: 6.2, unit: 'unit', moq: 200, delivery: '20–25 days', badges: [{ label: 'Verified', tone: 'success' as const }, { label: 'Customisable', tone: 'info' as const }] },
  { title: 'Stainless steel water bottle', fromPrice: 2.35, unit: 'unit', moq: 300, delivery: '18–22 days' },
  { title: 'Bamboo storage box', fromPrice: 3.1, unit: 'unit', moq: 250, delivery: '15–20 days', badges: [{ label: 'Samples', tone: 'info' as const }] },
];

type Order = { ref: string; product: string; status: string; date: string; total: number };
const ORDERS: Order[] = [
  { ref: 'ORD-20418', product: 'Silicone baking mat set ×500', status: 'Deposit due', date: '2026-11-24', total: 1250 },
  { ref: 'ORD-20402', product: 'LED desk lamp ×200', status: 'In production', date: '2026-11-18', total: 1240 },
  { ref: 'ORD-20377', product: 'Bamboo storage box ×250', status: 'Shipped', date: '2026-11-02', total: 775.5 },
  { ref: 'ORD-20351', product: 'Pet water fountain ×100', status: 'Delivered', date: '2026-10-21', total: 2870 },
  { ref: 'ORD-20333', product: 'Phone holder ×300', status: 'Cancelled', date: '2026-10-09', total: -420 },
];
const COLUMNS: DataTableColumn<Order>[] = [
  { id: 'ref', header: 'Order', cell: (o) => o.ref, primary: true, sortable: true, sortValue: (o) => o.ref },
  { id: 'product', header: 'Products', cell: (o) => o.product },
  { id: 'status', header: 'Status', cell: (o) => <StatusPill status={o.status} />, sortable: true, sortValue: (o) => o.status },
  { id: 'date', header: 'Ordered', cell: (o) => <time dateTime={o.date}>{fmtDate(o.date)}</time>, sortable: true, sortValue: (o) => o.date },
  { id: 'total', header: 'Total', cell: (o) => <Money amount={o.total} />, numeric: true, sortable: true, sortValue: (o) => o.total },
];
function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

const KPIS: KpiItem[] = [
  { label: 'Wallet available', value: <Money amount={4250} />, hint: 'After 2 holds' },
  { label: 'Open orders', value: '12', delta: { text: '+3 this week', direction: 'up' } },
  { label: 'Balance due', value: <Money amount={2870} />, delta: { text: '2 invoices due in 5 days', direction: 'flat', tone: 'neutral' } },
  { label: 'Spend this month', value: <Money amount={18420.5} />, delta: { text: '−8% vs last month', direction: 'down', tone: 'neutral' } },
];
const KPIS5: KpiItem[] = [
  { label: 'Invoiced', value: <Money amount={182400} />, delta: { text: '+12% vs last month', direction: 'up' } },
  { label: 'Collected', value: <Money amount={151020} />, delta: { text: '+6% vs last month', direction: 'up' } },
  { label: 'Overdue', value: <Money amount={9850} />, delta: { text: '+2 invoices', direction: 'up', tone: 'bad' } },
  { label: 'Credit notes', value: <Money amount={-1240} /> },
  { label: 'Invoices', value: '318' },
];

/* ───────── page ───────── */

export function Sections() {
  return (
    <>
      <ButtonsDemo />
      <CardsDemo />
      <ServiceSectionDemo />
      <ServiceSectionStatesDemo />
      <ProductCardsDemo />
      <KpiDemo />
      <TableDemo />
      <StatusDemo />
      <MoneyDemo />
      <TimelineDemo />
      <StatesDemo />
    </>
  );
}

function ButtonsDemo() {
  const [busy, setBusy] = useState(false);
  const [pressed, setPressed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const pay = () => {
    setBusy(true);
    t.current = setTimeout(() => setBusy(false), 2000);
  };
  return (
    <Demo
      id="buttons"
      title="Button and IconButton"
      note="One primary button per area. Hover: primary darkens to blue-hover, secondary gets a navy border, ghost gets a blue tint, danger and accent darken slightly. Focus (Tab): 3 px amber ring. Disabled buttons stay focusable (aria-disabled) and always say why next to them. Loading sets aria-busy, keeps the colour and blocks clicks."
      phone="same sizes (44 px in comfortable); use fullWidth for sticky footers; groups wrap."
    >
      <DensityPair>
        {() => (
          <div className="flex flex-col gap-5">
            <State label="Variants">
              <div className="flex flex-wrap items-center gap-2">
                <Button data-testid="button-primary">Add to import list</Button>
                <Button variant="secondary">Order a sample</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger" iconStart={Trash2}>
                  Cancel order
                </Button>
                <Button variant="link">Change in Packing and shipping</Button>
              </div>
            </State>
            <State label="With icons · link styled as a button">
              <div className="flex flex-wrap items-center gap-2">
                <Button iconStart={Plus}>Add to cart</Button>
                <Button variant="secondary" iconEnd={ArrowRight}>
                  Continue
                </Button>
                <Button variant="secondary" href="#demo-cards">
                  Go to cards
                </Button>
              </div>
            </State>
            <State label="Loading (press it)">
              <div className="flex flex-wrap items-center gap-2">
                <Button loading={busy} loadingText="Paying…" onClick={pay}>
                  Pay balance US$ 2,870.00
                </Button>
                <Button loading loadingText="Pushing 3 of 5">
                  Push to store
                </Button>
              </div>
            </State>
            <State label="Disabled, with the reason next to it">
              <Button disabled disabledReason="Add at least one product first.">
                Send quote request
              </Button>
            </State>
            <State label="Small (sm)">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Save</Button>
                <Button size="sm" variant="secondary" iconStart={Filter}>
                  Filters
                </Button>
                <Button size="sm" variant="ghost">
                  Clear
                </Button>
              </div>
            </State>
            <State label="Accent and on-navy (on a navy band)">
              <div className="flex flex-wrap items-center gap-2 rounded-ods-card bg-ods-navy p-4">
                <Button variant="accent" iconEnd={ExternalLink}>
                  Open My account
                </Button>
                <Button variant="on-navy">Browse products</Button>
                <IconButton icon={Bell} label="Notifications" variant="on-navy" count={3} />
              </div>
            </State>
            <State label="Full width">
              <Button fullWidth>Place order</Button>
            </State>
            <State label="IconButton: ghost, secondary, primary, pressed (toggle), count">
              <div className="flex flex-wrap items-center gap-2">
                <IconButton icon={Search} label="Search" />
                <IconButton icon={Filter} label="Filters" variant="secondary" />
                <IconButton icon={Plus} label="New request" variant="primary" />
                <IconButton icon={Filter} label="Show filters" variant="secondary" pressed={pressed} onClick={() => setPressed((p) => !p)} />
                <IconButton icon={Bell} label="Notifications" count={12} />
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function CardsDemo() {
  return (
    <Demo
      id="cards"
      title="Card and Panel"
      note="Card: comfortable areas (14 px radius, 20 px padding). Panel: staff areas (6 px radius, 40 px header, 12 px padding in compact). Both have optional header (title + actions), footer, and loading / empty / error slots that replace only the body."
      phone="full width; header actions wrap under the title."
    >
      <DensityPair>
        {() => (
          <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
            <Card
              title="Wallet"
              description="Anna Home Trading"
              actions={
                <Button size="sm" variant="secondary">
                  Add funds
                </Button>
              }
              footer={
                <Button variant="link" size="sm">
                  See statement
                </Button>
              }
            >
              <p className="m-0 text-ods-small text-ods-slate">Available</p>
              <p className="m-0 text-ods-h1 font-bold">
                <Money amount={4250} />
              </p>
            </Card>
            <Card title="Recent quotes" loading />
            <Card title="Saved products" empty={<EmptyState title="No saved products yet" description="Save products from the shop to compare them here." headingLevel={4} />} />
            <Card title="Shipments" error={<ErrorState title="We couldn’t load your shipments." headingLevel={4} onRetry={noop} />} />
            <Panel
              title="Invoice OCT-2026-000184"
              actions={
                <Button size="sm" variant="secondary">
                  Download PDF
                </Button>
              }
              footer={<span className="text-ods-small text-ods-slate">Last change 27 Nov 2026 by Sara (Accounts)</span>}
            >
              <dl className="m-0 grid grid-cols-2 gap-y-1 text-ods-table">
                <dt className="text-ods-slate">Status</dt>
                <dd className="m-0 text-end">
                  <StatusPill status="Partly paid" />
                </dd>
                <dt className="text-ods-slate">Balance</dt>
                <dd className="m-0 text-end">
                  <Money amount={2870} />
                </dd>
              </dl>
            </Panel>
            <Panel title="Notes" loading />
            <Panel title="Attachments" empty={<EmptyState title="No attachments" headingLevel={4} />} />
            <Panel title="Payments" error={<ErrorState title="We couldn’t load the payments." headingLevel={4} onRetry={noop} />} />
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function sourcingCards(level: 3 | 4) {
  return SRC.map((p, i) => (
    <SourcingCard
      key={p.title}
      {...p}
      href="#demo-service-section"
      headingLevel={level}
      showService={false}
      quoteAction={{ onClick: noop }}
      cartAction={i === 2 ? { disabledReason: 'Minimum order is 300 units.' } : { onClick: noop }}
    />
  ));
}

function ServiceSectionDemo() {
  return (
    <Demo
      id="service-section"
      title="ServiceSection"
      note="One coloured band per service on the Shop main page: 6 px bar on the start edge in the service colour, icon tile, name + count, one-line explainer, See all, then 4 cards. Colour is never alone: the name and icon are always there."
      phone="the header stacks; the 4 cards scroll sideways with snap (about one and a bit visible). Tablet 2 per row, desktop 4."
    >
      <DensityPair stack>
        {(d) => (
          <ServiceSection
            service="sourcing"
            title="Sourcing products"
            count={980}
            explainer="Buy from verified factories. Ask for a quote; prices drop at higher quantities."
            seeAllHref="#demo-service-section"
            headingLevel={3}
            data-testid={d === 'comfortable' ? 'servicesection-demo' : undefined}
          >
            {sourcingCards(4)}
          </ServiceSection>
        )}
      </DensityPair>
    </Demo>
  );
}

function RetryingPools({ level }: { level: 3 }) {
  const [state, setState] = useState<'error' | 'loading' | 'ready'>('error');
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <ServiceSection
      service="pools"
      count={42}
      explainer="Join other buyers to reach the factory minimum and pay the bulk price."
      seeAllHref="#demo-service-section-states"
      headingLevel={level}
      error={state === 'error'}
      loading={state === 'loading'}
      onRetry={() => {
        setState('loading');
        t.current = setTimeout(() => setState('ready'), 1500);
      }}
    >
      {[
        { title: 'Ceramic mug set', poolPrice: 11.2, normalPrice: 13.9, filled: 640, target: 1000, closesIn: '5 days', joinFrom: 50, status: 'Open' },
        { title: 'Cotton tote bag', poolPrice: 2.95, normalPrice: 3.6, filled: 1820, target: 2000, closesIn: '2 days', joinFrom: 100, status: 'Almost full' },
      ].map((p) => (
        <PoolCard key={p.title} {...p} href="#demo-service-section-states" headingLevel={4} showService={false} joinAction={{ onClick: noop }} />
      ))}
    </ServiceSection>
  );
}

function ServiceSectionStatesDemo() {
  return (
    <Demo
      id="service-section-states"
      title="ServiceSection states"
      note="Loading shows skeleton cards. A failed section shows its own error with Try again (press it: loading, then cards) while the other sections keep showing. Empty says what is missing. Dropshipping without access and Warehouse show their notes."
      phone="as above; skeletons show 2 stacked cards."
    >
      <DensityPair stack>
        {() => (
          <div className="flex flex-col gap-4">
            <ServiceSection service="pools" explainer="Join other buyers to reach the factory minimum and pay the bulk price." seeAllHref="#demo-service-section-states" headingLevel={3} loading />
            <RetryingPools level={3} />
            <ServiceSection
              service="turnkey"
              count={0}
              explainer="We run the whole project: design, samples, QC, packaging and shipping."
              seeAllHref="#demo-service-section-states"
              headingLevel={3}
              empty
              emptyDescription="Try another category, or tell us what you need."
              emptyAction={
                <Button variant="secondary" size="sm">
                  Request a product
                </Button>
              }
            />
            <ServiceSection
              service="dropship"
              count={1240}
              explainer="No minimum order. We store, pack and ship each order under your brand."
              seeAllHref="#demo-service-section-states"
              headingLevel={3}
              note="Prices and landed cost show after Dropship access is approved."
            >
              {['Pet water fountain', 'Phone holder', 'Silicone spatula set'].map((title) => (
                <DropshipCard key={title} title={title} href="#demo-service-section-states" hasAccess={false} headingLevel={4} showService={false} accessAction={{ onClick: noop }} />
              ))}
            </ServiceSection>
            <ServiceSection
              service="3pl"
              countLabel="5 services"
              count={5}
              explainer="Send stock to our warehouse; we receive, check, pack and ship for you."
              seeAllHref="#demo-service-section-states"
              headingLevel={3}
              note="Rates are confirmed in your quote. Your stock and fees show in My account › Warehouse."
            >
              <ServiceCard
                title="Storage"
                href="#demo-service-section-states"
                description="Shelf and pallet storage in Dubai."
                rates={[{ label: 'Pallet', amount: 18, per: '/ month' }]}
                headingLevel={4}
                showService={false}
                quoteAction={{ onClick: noop }}
              />
              <ServiceCard title="Pick and pack" href="#demo-service-section-states" description="Per order, with your inserts." headingLevel={4} showService={false} quoteAction={{ onClick: noop }} />
            </ServiceSection>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function ProductCardsDemo() {
  return (
    <Demo
      id="product-cards"
      title="Product cards"
      note="Shared base: image (next/image with width and height) or a neutral placeholder, service tag (icon + name), title as the link, facts as label / value, buttons at the bottom. Buttons are described by the product name. Disabled buttons say why."
      phone="one card per row in lists, or ~80% wide in a sideways ServiceSection; buttons wrap."
    >
      <DensityPair stack>
        {() => (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
              <SourcingCard
                title="Silicone baking mat set"
                href="#demo-product-cards"
                image={{ src: '/images/ods/icons/icon-512.png', alt: 'Silicone baking mat set', width: 512, height: 512 }}
                fromPrice={1.45}
                unit="set"
                moq={500}
                delivery="15–20 days"
                badges={[{ label: 'Verified', tone: 'success' }]}
                quoteAction={{ onClick: noop }}
                cartAction={{ onClick: noop }}
              />
              <PoolCard
                title="Ceramic mug set"
                href="#demo-product-cards"
                poolPrice={11.2}
                normalPrice={13.9}
                filled={640}
                target={1000}
                closesIn="5 days"
                joinFrom={50}
                status="Open"
                joinAction={{ onClick: noop }}
              />
              <DropshipCard title="Pet water fountain" href="#demo-product-cards" hasAccess yourPrice={7.8} landedCost={9.95} landedIn="UAE" importAction={{ onClick: noop }} />
              <ServiceCard
                title="Receiving and QC"
                href="#demo-product-cards"
                description="We count and check every carton."
                rates={[
                  { label: 'Per carton', amount: 1.2, per: '' },
                  { label: 'Photo check', amount: 0.3, per: '/ unit' },
                ]}
                quoteAction={{ onClick: noop }}
              />
              <TurnkeyCard
                title="Private-label kitchen range"
                href="#demo-product-cards"
                fromPrice={25000}
                timeline="8–10 weeks"
                includes={['Samples', 'QC', 'Packaging', 'Shipping']}
                viewAction={{ href: '#demo-product-cards' }}
              />
              <BrandCard title="Branded gift box" href="#demo-product-cards" fromPrice={0.85} unit="box" unitPlural="boxes" moq={1000} proofTime="3 days" brandAction={{ onClick: noop }} />
            </div>
            <State label="Disabled with a reason · no access · no rates · loading">
              <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
                <SourcingCard
                  title="LED desk lamp"
                  href="#demo-product-cards"
                  fromPrice={6.2}
                  moq={200}
                  delivery="20–25 days"
                  quoteAction={{ onClick: noop }}
                  cartAction={{ disabledReason: 'Minimum order is 200 units. Raise the quantity or join the MOQ pool.' }}
                />
                <PoolCard
                  title="Cotton tote bag"
                  href="#demo-product-cards"
                  poolPrice={2.95}
                  normalPrice={3.6}
                  filled={2000}
                  target={2000}
                  closesIn="0 days"
                  joinFrom={100}
                  status="Filled"
                  joinAction={{ disabledReason: 'This pool is full.' }}
                />
                <DropshipCard title="Phone holder" href="#demo-product-cards" hasAccess={false} accessAction={{ onClick: noop }} />
                <ServiceCard title="Returns handling" href="#demo-product-cards" description="Check, restock or dispose." quoteAction={{ onClick: noop }} />
                <ProductCardSkeleton />
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function KpiDemo() {
  return (
    <Demo
      id="kpi"
      title="KpiStrip"
      note="cards = comfortable dashboards; strip = one bordered row of 4–5 figures for staff. Deltas are words with an arrow, never colour alone."
      phone="2 per row; in the strip an odd last figure spans the row."
    >
      <DensityPair stack>
        {(d) => (
          <div className="flex flex-col gap-4">
            <State label="variant=cards">
              <KpiStrip items={KPIS} variant="cards" label="Your account" data-testid={d === 'comfortable' ? 'kpistrip-demo' : undefined} />
            </State>
            <State label="variant=strip (5 figures)">
              <KpiStrip items={KPIS5} variant="strip" label="Invoices this month" />
            </State>
            <State label="Loading">
              <KpiStrip items={[]} variant="strip" loading />
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function TableDemo() {
  const [failed, setFailed] = useState(true);
  return (
    <Demo
      id="datatable"
      title="DataTable"
      note="Caption, sortable headers (a button in the th; aria-sort on the sorted column), numbers right-aligned with tabular figures, row links (the order number is the link; the whole row is clickable). Loading keeps the header."
      phone="each row becomes a card with label: value pairs — never a sideways-scrolling table."
    >
      <DensityPair stack>
        {() => (
          <div className="flex flex-col gap-5">
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              getRowId={(o) => o.ref}
              caption="Your orders"
              rowHref={() => '#demo-datatable'}
              defaultSort={{ id: 'date', direction: 'desc' }}
              getRowProps={(_, i) => (i === 0 ? { 'data-testid': 'datatable-row' } : {})}
            />
            <State label="Loading">
              <DataTable columns={COLUMNS} rows={[]} getRowId={(o) => o.ref} caption="Orders (loading)" captionHidden loading skeletonRows={3} />
            </State>
            <State label="Empty">
              <DataTable
                columns={COLUMNS}
                rows={[]}
                getRowId={(o) => o.ref}
                caption="Orders (empty)"
                captionHidden
                empty={<EmptyState title="No orders yet" description="Orders show here after you pay a quote or check out." headingLevel={3} action={<Button href="#demo-datatable">Browse products</Button>} />}
              />
            </State>
            <State label="Error (Try again clears it)">
              <DataTable
                columns={COLUMNS}
                rows={ORDERS.slice(0, 2)}
                getRowId={(o) => o.ref}
                caption="Orders (error)"
                captionHidden
                error={failed ? <ErrorState title="We couldn’t load your orders." onRetry={() => setFailed(false)} /> : undefined}
              />
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

const AREA_LABEL: Record<keyof typeof STATUS_NAMES, string> = {
  requests: 'Requests',
  orders: 'Orders',
  invoices: 'Invoices',
  pools: 'Pools',
  payments: 'Payments',
  approvals: 'Approvals',
  company: 'Company',
};

function StatusDemo() {
  return (
    <Demo
      id="status"
      title="StatusPill"
      note="Dot + text, one shared list of names (Appendix C). Tone comes from the name: success, info, warning, danger, neutral, and indigo (Held, the 3PL colour)."
      phone="same; pills never wrap their text."
    >
      <DensityPair>
        {() => (
          <div className="flex flex-col gap-3">
            {(Object.keys(STATUS_NAMES) as (keyof typeof STATUS_NAMES)[]).map((area, ai) => (
              <State key={area} label={AREA_LABEL[area]}>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_NAMES[area].map((s, i) => (
                    <StatusPill key={s} status={s} data-testid={ai === 0 && i === 0 ? 'statuspill' : undefined} />
                  ))}
                </div>
              </State>
            ))}
            <State label="Custom text with an explicit tone">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill tone="danger">On hold: address</StatusPill>
                <StatusPill tone="indigo">In the warehouse</StatusPill>
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function MoneyDemo() {
  return (
    <Demo id="money" title="Money" note="Always “US$ 1,234.56”, tabular figures. Negatives “−US$ 420.00” with a real minus sign (U+2212), repeated in red." phone="same; never wraps.">
      <DensityPair>
        {() => (
          <dl className="m-0 grid max-w-[420px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-ods-table">
            <dt className="text-ods-slate">Product</dt>
            <dd className="m-0 text-end">
              <Money amount={1234.56} />
            </dd>
            <dt className="text-ods-slate">Refund</dt>
            <dd className="m-0 text-end">
              <Money amount={-420} />
            </dd>
            <dt className="text-ods-slate">Change (signDisplay always)</dt>
            <dd className="m-0 text-end">
              <Money amount={12.5} signDisplay="always" />
            </dd>
            <dt className="text-ods-slate">From (with suffix)</dt>
            <dd className="m-0 text-end">
              <Money amount={1.45} suffix="/ set" />
            </dd>
            <dt className="font-semibold">Landed cost</dt>
            <dd className="m-0 text-end font-bold">
              <Money amount={19.7} />
            </dd>
          </dl>
        )}
      </DensityPair>
    </Demo>
  );
}

function TimelineDemo() {
  return (
    <Demo
      id="timeline"
      title="Timeline and ActivityFeed"
      note="Dot + title + date/actor, as an ordered list with <time dateTime>. Timeline step state is also in words for screen readers (Done / Now / Next); the current step has aria-current=step."
      phone="same (vertical)."
    >
      <DensityPair>
        {() => (
          <div className="grid grid-cols-1 gap-5 ods-tablet:grid-cols-2">
            <State label="Timeline">
              <Timeline
                label="Order progress"
                items={[
                  { id: 'paid', title: 'Deposit paid', date: '2026-11-20', actor: 'Anna', state: 'done' },
                  { id: 'prod', title: 'In production', date: '2026-11-22', actor: 'Octopus team', state: 'done' },
                  { id: 'qc', title: 'Quality check', date: '2026-11-27T14:00:00Z', state: 'current', description: 'Photos are uploaded when the check is done.' },
                  { id: 'ship', title: 'Shipped', state: 'next' },
                ]}
              />
            </State>
            <div className="flex flex-col gap-4">
              <State label="ActivityFeed">
                <ActivityFeed
                  label="Recent activity"
                  showTime
                  items={[
                    { id: '1', title: 'Quote ready for RFQ-1042', actor: 'Octopus team', date: '2026-11-27T14:00:00Z', tone: 'info' },
                    { id: '2', title: 'Payment received: US$ 1,250.00', actor: 'Anna', date: '2026-11-26T09:30:00Z', tone: 'success' },
                    { id: '3', title: 'Invoice OCT-2026-000184 is overdue', date: '2026-11-24T06:00:00Z', tone: 'danger' },
                  ]}
                />
              </State>
              <State label="ActivityFeed loading">
                <ActivityFeed label="activity" items={[]} loading />
              </State>
              <State label="ActivityFeed empty">
                <ActivityFeed label="Activity (empty)" items={[]} />
              </State>
            </div>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

function StatesDemo() {
  return (
    <Demo
      id="states"
      title="EmptyState, ErrorState, Skeleton"
      note="Every list, panel and tab has all three. Errors say what happened and what to do, never a technical code, with Try again. Skeleton blocks are hidden from screen readers; one “Loading” status is read out."
      phone="same; actions wrap."
    >
      <DensityPair>
        {(d) => (
          <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
            <div className="rounded-ods-card border border-ods-line bg-ods-surface" data-testid={d === 'comfortable' ? 'empty-demo' : undefined}>
              <EmptyState title="Your import list is empty" description="Add products from the catalogue to price and publish them." action={<Button>Find products</Button>} />
            </div>
            <div className="rounded-ods-card border border-ods-line bg-ods-surface" data-testid={d === 'comfortable' ? 'error-demo' : undefined}>
              <ErrorState title="We couldn’t load MOQ pools." onRetry={noop} />
            </div>
            <div className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 ods-tablet:col-span-2">
              <Skeleton className="h-5 w-1/3" label="Loading example" />
              <Skeleton lines={3} silent />
            </div>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}
