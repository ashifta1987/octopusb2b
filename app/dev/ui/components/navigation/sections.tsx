'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertCircle,
  Banknote,
  BarChart3,
  BookOpen,
  Box,
  Building,
  CreditCard,
  FileClock,
  FileText,
  Globe,
  Home,
  Landmark,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  LogOut,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Ship,
  ShoppingBag,
  Sparkles,
  Truck,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Factory,
  Undo2,
  Quote,
  Trash2,
} from 'lucide-react';
import {
  AccountSidebar,
  AccountTopbar,
  BottomNav,
  Breadcrumbs,
  MegaMenu,
  MenuButton,
  OfficeSidebar,
  OfficeTopbar,
  PublicHeader,
  SectionBar,
  Sheet,
  ShopHeader,
  buttonClass,
  type AccountSidebarGroup,
  type MegaMenuColumn,
  type MegaMenuPromo,
  type OdsDensity,
  type OfficeSidebarGroup,
  type OfficeSidebarItem,
} from '@octopus/ui';
import { Demo, DensityPair, State } from '../_demo';

/* ───────── demo data (lives only here) ───────── */

const SERVICES: { columns: MegaMenuColumn[]; promo: MegaMenuPromo } = {
  columns: [
    {
      title: 'Buy products',
      links: [
        { label: 'Sourcing', href: '/services/sourcing', icon: Box, description: 'Factory prices, quotes in 48 hours' },
        { label: 'MOQ pools', href: '/services/pools', icon: Users, description: 'Share a minimum order with other buyers' },
      ],
    },
    {
      title: 'Sell online',
      links: [
        { label: 'Dropshipping', href: '/services/dropship', icon: Truck, description: 'No minimum, we ship to your customers' },
        { label: 'Make My Brand', href: '/services/brand', icon: Sparkles, description: 'Your logo on the product and box' },
      ],
    },
    { title: 'Store and ship', links: [{ label: 'Warehouse (3PL)', href: '/services/warehouse', icon: Package, description: 'Storage and fulfilment in Dubai' }] },
    { title: 'Build a business', links: [{ label: 'Turnkey projects', href: '/services/turnkey', icon: Layers, description: 'A ready product line, start to finish' }] },
  ],
  promo: { eyebrow: 'New', title: 'MOQ pools closing soon', body: 'Foldable pet crate · 5 days left · 82% filled', href: '/services/pools', linkLabel: 'See all pools' },
};

const CATEGORIES: { columns: MegaMenuColumn[]; promo: MegaMenuPromo } = {
  columns: [
    { title: 'Home and kitchen', href: '/shop/products?c=home', links: ['Bakeware', 'Storage', 'Tableware', 'Cleaning'].map((l) => ({ label: l, href: `/shop/products?c=${l.toLowerCase()}` })) },
    { title: 'Electronics', href: '/shop/products?c=electronics', links: ['Lighting', 'Phone accessories', 'Small appliances'].map((l) => ({ label: l, href: `/shop/products?c=${l.toLowerCase()}` })) },
    { title: 'Pets', href: '/shop/products?c=pets', links: ['Beds and crates', 'Feeding', 'Grooming'].map((l) => ({ label: l, href: `/shop/products?c=${l.toLowerCase()}` })) },
    { title: 'Beauty', href: '/shop/products?c=beauty', links: ['Tools', 'Packaging', 'Bath'].map((l) => ({ label: l, href: `/shop/products?c=${l.toLowerCase()}` })) },
  ],
  promo: { eyebrow: 'MOQ pools closing soon', title: 'Foldable pet crate', body: 'Closes in 5 days · from US$ 9.40 a unit', href: '/shop/pools', linkLabel: 'See all pools' },
};

const ACCOUNT_GROUPS: AccountSidebarGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'home', label: 'Home', icon: Home, href: '/account' },
      { id: 'action', label: 'Action needed', icon: AlertCircle, href: '/account/action', count: 3 },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    items: [
      { id: 'requests', label: 'Sourcing requests', icon: FileText, href: '/account/requests', count: 1 },
      { id: 'orders', label: 'Orders', icon: Truck, href: '/account/orders', count: 2 },
      { id: 'turnkey', label: 'Turnkey projects', icon: Layers, href: '/account/turnkey', notStarted: true },
      { id: 'warehouse', label: 'Warehouse (3PL)', icon: Package, href: '/account/warehouse' },
      { id: 'shipping', label: 'Shipping', icon: Ship, href: '/account/shipping' },
      { id: 'brand', label: 'Make My Brand', icon: Sparkles, href: '/account/brand', notStarted: true },
      {
        id: 'dropship',
        label: 'Dropshipping',
        icon: ShoppingBag,
        href: '/account/dropship',
        children: [
          { id: 'ds-dashboard', label: 'Dashboard', href: '/account/dropship' },
          { id: 'ds-catalog', label: 'Catalog', href: '/account/dropship/catalog' },
          { id: 'ds-orders', label: 'Orders', href: '/account/dropship/orders', count: 4 },
        ],
      },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { id: 'wallet', label: 'Wallet', icon: Wallet, href: '/account/wallet' },
      { id: 'invoices', label: 'Invoices', icon: Receipt, href: '/account/invoices', count: 1 },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'settings', label: 'Team and settings', icon: Settings, href: '/account/settings' },
      { id: 'support', label: 'Support', icon: LifeBuoy, href: '/account/support' },
    ],
  },
];
const COMPANIES = [
  { id: 'c1', name: 'Al Noor Trading LLC' },
  { id: 'c2', name: 'Gulf Home Supplies' },
];

const OFFICE_TOP: OfficeSidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/office' },
  { id: 'my-work', label: 'My work', icon: ListTodo, href: '/office/my-work', count: 7 },
];
const officeGroups = (hideAdmin: boolean): OfficeSidebarGroup[] => [
  {
    id: 'sales',
    label: 'Sales',
    items: [
      { id: 'customers', label: 'Customers', icon: Users, href: '/office/customers' },
      { id: 'rfqs', label: 'Sourcing requests', icon: FileText, href: '/office/rfqs', count: 12 },
      { id: 'quotes', label: 'Quotes', icon: Quote, href: '/office/quotes' },
      { id: 'orders', label: 'Orders', icon: Truck, href: '/office/orders' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    defaultOpen: false,
    items: [
      { id: 'pools', label: 'MOQ pools', icon: Users, href: '/office/pools', count: 2 },
      { id: 'turnkey', label: 'Turnkey projects', icon: Layers, href: '/office/turnkey' },
      { id: 'brand', label: 'Make My Brand', icon: Sparkles, href: '/office/brand' },
      { id: 'dropship', label: 'Dropshipping', icon: ShoppingBag, href: '/office/dropship' },
      { id: 'warehouse', label: 'Warehouse (3PL)', icon: Package, href: '/office/warehouse' },
      { id: 'shipping', label: 'Shipping', icon: Ship, href: '/office/shipping' },
    ],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    items: [
      { id: 'invoices', label: 'Invoices', icon: Receipt, href: '/office/accounts/invoices', count: 5 },
      { id: 'payments', label: 'Payments', icon: CreditCard, href: '/office/accounts/payments' },
      { id: 'wallets', label: 'Wallets', icon: Wallet, href: '/office/accounts/wallets' },
      { id: 'credit-notes', label: 'Credit notes', icon: Undo2, href: '/office/accounts/credit-notes' },
      { id: 'ledger', label: 'Ledger', icon: BookOpen, href: '/office/accounts/ledger' },
      { id: 'bank', label: 'Bank reconciliation', icon: Landmark, href: '/office/accounts/bank', count: 3 },
      { id: 'reports', label: 'Financial reports', icon: BarChart3, href: '/office/accounts/reports' },
    ],
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    defaultOpen: false,
    items: [
      { id: 'products', label: 'Products', icon: Box, href: '/office/catalogue/products' },
      { id: 'suppliers', label: 'Suppliers', icon: Factory, href: '/office/catalogue/suppliers' },
    ],
  },
  { id: 'website', label: 'Website', defaultOpen: false, items: [{ id: 'website', label: 'Pages and banners', icon: Globe, href: '/office/website' }] },
  {
    id: 'admin',
    label: 'Admin',
    defaultOpen: false,
    items: [
      { id: 'roles', label: 'Users and roles', icon: UserCog, href: '/office/admin/roles', hidden: hideAdmin },
      { id: 'office-settings', label: 'Settings', icon: Settings, href: '/office/admin/settings', hidden: hideAdmin },
      { id: 'audit', label: 'Audit log', icon: ScrollText, href: '/office/admin/audit', hidden: hideAdmin },
    ],
  },
];

const OFFICE_APPS = [
  { id: 'office', label: 'Back Office', href: '/office' },
  { id: 'accounts', label: 'Accounts', href: '/office/accounts/invoices' },
  { id: 'wms', label: 'Warehouse OS', href: '/office/warehouse' },
  { id: 'web', label: 'Website admin', href: '/office/website' },
];
const NEW_ITEMS = [
  { id: 'invoice', label: 'Invoice', icon: Receipt, onSelect: () => undefined, shortcut: 'N' },
  { id: 'payment', label: 'Payment', icon: Banknote, onSelect: () => undefined },
  { id: 'quote', label: 'Quote', icon: Quote, onSelect: () => undefined },
  { id: 'customer', label: 'Customer', icon: Building, onSelect: () => undefined },
  { id: 'product', label: 'Product', icon: Box, onSelect: () => undefined, disabled: true, disabledReason: 'Your role can’t add products.' },
];
const USER_MENU = [
  { id: 'profile', label: 'Profile', icon: UserRound, href: '/account/settings?tab=profile' },
  { id: 'team', label: 'Team and settings', icon: Settings, href: '/account/settings' },
  { id: 'signout', label: 'Sign out', icon: LogOut, onSelect: () => undefined, separatorBefore: true },
];

const sfx = (d: OdsDensity) => `(${d})`;
const frame = 'flex overflow-hidden rounded-ods-card border border-ods-line bg-ods-canvas';

function FakeContent({ title }: { title: string }) {
  return (
    <div className="min-w-0 flex-1 p-4">
      <p className="font-semibold text-ods-navy">{title}</p>
      <div aria-hidden className="mt-3 grid gap-2">
        <div className="h-16 rounded-ods-card bg-ods-surface" />
        <div className="h-16 rounded-ods-card bg-ods-surface" />
        <div className="h-16 rounded-ods-card bg-ods-surface" />
      </div>
    </div>
  );
}

/* ───────── demos ───────── */

function SheetDemo({ density }: { density: OdsDensity }) {
  const [bottom, setBottom] = useState(false);
  const [full, setFull] = useState(false);
  const c = density === 'comfortable';
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" className={buttonClass('secondary')} aria-haspopup="dialog" onClick={() => setBottom(true)} data-testid={c ? 'sheet-open' : undefined}>
        Open bottom sheet (More)
      </button>
      <button type="button" className={buttonClass('secondary')} aria-haspopup="dialog" onClick={() => setFull(true)}>
        Open full-screen sheet (Filters)
      </button>
      <Sheet open={bottom} onClose={() => setBottom(false)} title="More" testId={c ? 'sheet' : undefined}>
        <ul className="grid gap-0.5">
          {[
            ['Turnkey projects', Layers],
            ['Warehouse (3PL)', Package],
            ['Shipping', Ship],
            ['Invoices', Receipt],
            ['Team and settings', Settings],
            ['Support', LifeBuoy],
          ].map(([l, I]) => {
            const Ico = I as typeof Layers;
            return (
              <li key={l as string}>
                <Link href="#sheet" className="flex min-h-ods-control items-center gap-3 rounded-ods-control px-2 font-medium text-ods-navy hover:bg-ods-blue-tint">
                  <Ico aria-hidden className="size-ods-icon" strokeWidth={1.9} />
                  {l as string}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
      <Sheet
        open={full}
        onClose={() => setFull(false)}
        title="Filters"
        description="24 products match"
        variant="full"
        footer={
          <button type="button" className={buttonClass('primary', 'md', true)} onClick={() => setFull(false)}>
            Show 24 results
          </button>
        }
      >
        <fieldset className="mt-2">
          <legend className="font-semibold text-ods-navy">Category</legend>
          {['Home and kitchen', 'Electronics', 'Pets', 'Beauty'].map((l) => (
            <label key={l} className="flex min-h-ods-control items-center gap-3">
              <input type="checkbox" className="size-5 accent-ods-blue" /> {l}
            </label>
          ))}
        </fieldset>
      </Sheet>
    </div>
  );
}

function BottomNavDemo({ density }: { density: OdsDensity }) {
  const [sheet, setSheet] = useState<string | null>(null);
  const c = density === 'comfortable';
  return (
    <div className="grid gap-4">
      <State label="Shop · current: Pools · cart 3 · Categories opens a sheet">
        <div className="max-w-[390px]">
          <BottomNav preset="shop" fixed={false} value="pools" counts={{ cart: 3 }} onAction={(id) => setSheet(id)} expandedId={sheet ?? undefined} label={`Shop bottom bar ${sfx(density)}`} testId={c ? 'bottomnav' : undefined} />
        </div>
      </State>
      <State label="My account · current: Orders · More opens a sheet">
        <div className="max-w-[390px]">
          <BottomNav preset="account" fixed={false} value="orders" counts={{ requests: 1, orders: 2 }} onAction={(id) => setSheet(id)} expandedId={sheet ?? undefined} label={`My account bottom bar ${sfx(density)}`} />
        </div>
      </State>
      <State label="Back Office · current: Approvals · 4 alerts">
        <div className="max-w-[390px]">
          <BottomNav preset="office" fixed={false} value="approvals" counts={{ approvals: 6, alerts: 4 }} onAction={(id) => setSheet(id)} expandedId={sheet ?? undefined} label={`Back Office bottom bar ${sfx(density)}`} />
        </div>
      </State>
      <Sheet open={sheet === 'categories'} onClose={() => setSheet(null)} title="Categories">
        <ul className="grid gap-0.5">
          {CATEGORIES.columns.map((col) => (
            <li key={col.title}>
              <Link href={col.href ?? "/shop/products"} className="flex min-h-ods-control items-center rounded-ods-control px-2 font-medium text-ods-navy hover:bg-ods-blue-tint">
                {col.title}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="More">
        <ul className="grid gap-0.5">
          {ACCOUNT_GROUPS.flatMap((g) => g.items)
            .filter((i) => !['home', 'requests', 'orders', 'wallet'].includes(i.id))
            .map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex min-h-ods-control items-center gap-3 rounded-ods-control px-2 font-medium text-ods-navy hover:bg-ods-blue-tint">
                  <i.icon aria-hidden className="size-ods-icon" strokeWidth={1.9} />
                  {i.label}
                </Link>
              </li>
            ))}
          <li>
            <Link href="/shop/products" className="flex min-h-ods-control items-center gap-3 rounded-ods-control px-2 font-semibold text-ods-blue">
              Browse products ↗
            </Link>
          </li>
        </ul>
      </Sheet>
      <Sheet open={sheet === 'search' || sheet === 'alerts'} onClose={() => setSheet(null)} title={sheet === 'search' ? 'Search' : 'Alerts'} variant="full">
        <p className="text-ods-slate">{sheet === 'search' ? 'Search customers, RFQs, orders and invoices.' : 'No new alerts.'}</p>
      </Sheet>
    </div>
  );
}

function AccountSidebarDemo({ density }: { density: OdsDensity }) {
  const [company, setCompany] = useState('c1');
  const [forced, setForced] = useState(true);
  return (
    <div className="grid gap-4">
      <State label="Remembered choice (toggle at the top) · current: Dropshipping › Orders">
        <div className={`${frame} h-[700px]`}>
          <AccountSidebar
            groups={ACCOUNT_GROUPS}
            current="ds-orders"
            companies={COMPANIES}
            companyId={company}
            onCompanyChange={setCompany}
            storageKey={`ods-demo:account-sidebar:${density}`}
            label={`My account ${sfx(density)}`}
          />
          <FakeContent title="Dropshipping orders" />
        </div>
      </State>
      <State label="Collapsed (72 px icons with tooltips) · current: Orders">
        <div className={`${frame} h-[900px]`}>
          <AccountSidebar
            groups={ACCOUNT_GROUPS}
            current="orders"
            companies={COMPANIES}
            companyId={company}
            onCompanyChange={setCompany}
            collapsed={forced}
            onCollapsedChange={setForced}
            label={`My account collapsed ${sfx(density)}`}
          />
          <FakeContent title="Orders" />
        </div>
      </State>
    </div>
  );
}

function OfficeTopbarDemo({ density }: { density: OdsDensity }) {
  const [opened, setOpened] = useState(0);
  return (
    <div className="grid gap-3">
      <OfficeTopbar
        apps={OFFICE_APPS}
        currentApp="office"
        onOpenPalette={() => setOpened((n) => n + 1)}
        newItems={NEW_ITEMS}
        notificationsCount={4}
        user={{ name: 'Sara Khan', role: 'Finance manager' }}
        userMenuItems={[
          { id: 'shortcuts', label: 'Keyboard shortcuts', onSelect: () => undefined },
          { id: 'signout', label: 'Sign out', icon: LogOut, onSelect: () => undefined, separatorBefore: true },
        ]}
      />
      <p className="text-ods-small text-ods-slate" aria-live="polite">
        Command button pressed {opened} {opened === 1 ? 'time' : 'times'} ({density}). The CommandPalette itself is in “Grid, workspace, palette”.
      </p>
      <State label="Role with one app, no user menu">
        <OfficeTopbar apps={OFFICE_APPS.slice(0, 1)} currentApp="office" onOpenPalette={() => setOpened((n) => n + 1)} newItems={NEW_ITEMS.slice(0, 2)} user={{ name: 'Omar Ali', role: 'Sales' }} />
      </State>
    </div>
  );
}

export function Sections() {
  const [menuLog, setMenuLog] = useState('Nothing chosen yet.');
  return (
    <>
      <Demo
        id="public-header"
        title="PublicHeader"
        note="Introduction site header. Services ▾ opens the mega menu on click; Esc closes it and returns focus. Sticky on real pages (sticky={false} here)."
        phone="Sign in + Menu button; Menu opens a full-screen sheet with every link, the six services and Continue with Google. Signed in shows “Go to my shop ↗”."
      >
        <DensityPair stack>
          {(d) => (
            <div className="grid gap-4">
              <State label="Signed out · current: How it works">
                <PublicHeader
                  sticky={false}
                  services={SERVICES}
                  currentHref="/how-it-works"
                  navLabel={`Main ${sfx(d)}`}
                  onContinueWithGoogle={() => undefined}
                  megaMenuTestIds={d === 'comfortable' ? { trigger: 'megamenu-trigger', panel: 'megamenu' } : undefined}
                />
              </State>
              <State label="Signed in">
                <PublicHeader sticky={false} services={SERVICES} user={{ name: 'Aisha Rahman' }} navLabel={`Main, signed in ${sfx(d)}`} />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="shop-header"
        title="ShopHeader and SectionBar"
        note="Navy header (68 / 56 px) with labelled search, Cart (count), notifications and My account ↗ (opens the My account tab). Section bar: selected = bold + 3 px blue underline + aria-current; links that don't fit move into More ▾ (count), measured with a ResizeObserver."
        phone="Header keeps logo, cart icon (count) and bell; search moves to its own row; My account moves to the BottomNav. The section bar folds most links into More and shows the wallet as an icon."
      >
        <DensityPair stack>
          {(d) => (
            <div className="grid gap-4">
              <State label="Shop frame · current: MOQ pools">
                <div>
                  <ShopHeader sticky={false} cartCount={8} notificationsCount={2} onSearch={() => undefined} />
                  <SectionBar current="pools" categories={CATEGORIES} walletBalance={4250} label={`Shop sections ${sfx(d)}`} testId={d === 'comfortable' ? 'sectionbar' : undefined} />
                </div>
              </State>
              <State label="Narrower container (720 px): the last links fold into More">
                <div className="max-w-[720px]">
                  <SectionBar current="pools" categories={CATEGORIES} walletBalance={4250} label={`Shop sections, 720 px ${sfx(d)}`} />
                </div>
              </State>
              <State label="Current section inside More (More shows the selected style) · empty cart · no wallet">
                <div className="max-w-[560px]">
                  <ShopHeader sticky={false} cartCount={0} />
                  <SectionBar current="new" categories={CATEGORIES} label={`Shop sections, 560 px ${sfx(d)}`} />
                </div>
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="mega-menu"
        title="MegaMenu"
        note="Opens on click. Four columns + one promoted box, full width of the bar it sits in. Focus moves to the first link; Tab goes through links in reading order; Esc or a click outside closes."
        phone="Opens as a full-screen sheet with the columns stacked."
      >
        <DensityPair stack>
          {(d) => (
            <div className="grid gap-4">
              <State label="Default (All categories)">
                <div className="relative flex rounded-ods-control border border-ods-line bg-ods-surface p-1">
                  <MegaMenu label="All categories" panelLabel={`All categories ${sfx(d)}`} columns={CATEGORIES.columns} promo={CATEGORIES.promo} />
                </div>
              </State>
              <State label="Empty (no categories yet)">
                <div className="relative flex rounded-ods-control border border-ods-line bg-ods-surface p-1">
                  <MegaMenu label="All categories" panelLabel={`Empty categories ${sfx(d)}`} columns={[]} emptyText="No categories yet. Check back soon." />
                </div>
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="account-sidebar"
        title="AccountSidebar"
        note="248 px navy; collapses to 72 px icons with tooltips under 1200 px. The toggle at the top remembers the choice. Services not started show “Start” and sit last in their group."
        phone="Not shown; My account uses the navy phone header and the BottomNav (More opens a sheet with these links)."
      >
        <DensityPair>{(d) => <AccountSidebarDemo density={d} />}</DensityPair>
      </Demo>

      <Demo
        id="account-topbar"
        title="AccountTopbar"
        note="Search, New request, the light-blue shop icon “Go to the main page” (opens the Shop tab), notifications, help and the user menu (↑ ↓ to move, Esc returns focus)."
        phone="Navy header with the white logo, shop icon, bell and avatar; search below."
      >
        <DensityPair stack>
          {(d) => (
            <div className="grid gap-4">
              <State label="Default">
                <AccountTopbar user={{ name: 'Aisha Rahman', email: 'aisha@alnoor.ae' }} userMenuItems={USER_MENU} notificationsCount={3} onSearch={() => undefined} />
              </State>
              <State label="Phone layout (container under 768 px)">
                <div className="max-w-[390px]">
                  <AccountTopbar user={{ name: 'Aisha Rahman' }} userMenuItems={USER_MENU} notificationsCount={3} />
                </div>
              </State>
              <p className="sr-only">{d}</p>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="office-topbar"
        title="OfficeTopbar"
        note="48 px navy-dark. App switcher, centred command button with Ctrl K hints (opens the CommandPalette), + New ▾ (disabled items say why), notifications, help, avatar + name + role."
        phone="Not used; the Back Office phone frame has Approvals and the BottomNav. In narrow containers the command button becomes a search icon."
      >
        <DensityPair stack>{(d) => <OfficeTopbarDemo density={d} />}</DensityPair>
      </Demo>

      <Demo
        id="office-sidebar"
        title="OfficeSidebar"
        note="232 px navy, 56 px collapsed. Groups collapse (remembered); a 3 px teal bar marks the current page; “« Collapse sidebar Ctrl B” (Ctrl B is bound by the compact copy only). Items the role can't open are not rendered: the second copy hides Admin entirely."
        phone="Not used (BottomNav Home · Approvals · Search · Alerts)."
      >
        <DensityPair>
          {(d) => (
            <div className="grid gap-4">
              <State label={d === 'compact' ? 'Full role · current: Invoices · Ctrl B toggles' : 'Full role · current: Invoices'}>
                <div className={`${frame} h-[760px]`}>
                  <OfficeSidebar
                    items={OFFICE_TOP}
                    groups={officeGroups(false)}
                    current="invoices"
                    storageKey={`ods-demo:office-sidebar:${d}`}
                    hotkey={d === 'compact'}
                    label={`Back Office ${sfx(d)}`}
                    testId={d === 'compact' ? 'office-sidebar' : undefined}
                  />
                  <FakeContent title="Invoices" />
                </div>
              </State>
              <State label="Sales role (Admin hidden) · collapsed">
                <div className={`${frame} h-[1160px]`}>
                  <OfficeSidebar items={OFFICE_TOP} groups={officeGroups(true)} current="rfqs" collapsed hotkey={false} label={`Back Office, sales role ${sfx(d)}`} />
                  <FakeContent title="Sourcing requests" />
                </div>
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="bottom-nav"
        title="BottomNav"
        note="60 px, labels always visible, red badges read out with the label; current = blue with a 3 px top bar and aria-current. Categories, More, Search and Alerts are buttons that open sheets. fixed={false} here."
        phone="Fixed to the bottom on phones only; hidden from 768 px."
      >
        <DensityPair>{(d) => <BottomNavDemo density={d} />}</DensityPair>
      </Demo>

      <Demo
        id="sheet"
        title="Sheet"
        note="Bottom sheet (More, Categories) and full-screen sheet (Filters, menus). Drag handle (visual), close button; Esc, Back and a tap outside close it; focus is trapped and returns to the button."
        phone="This is the phone pattern; on desktop use Drawer or Modal."
      >
        <DensityPair>{(d) => <SheetDemo density={d} />}</DensityPair>
      </Demo>

      <Demo
        id="breadcrumbs"
        title="Breadcrumbs"
        note="nav aria-label “Breadcrumb”, ordered list, › separators; the last item is bold, not a link, aria-current=page."
        phone="Only “‹ Parent” (variant auto switches at 768 px)."
      >
        <DensityPair>
          {(d) => (
            <div className="grid gap-3">
              <State label="Full trail">
                <Breadcrumbs
                  variant="full"
                  label={`Breadcrumb ${sfx(d)}`}
                  items={[{ label: 'My account', href: '/account' }, { label: 'Orders', href: '/account/orders' }, { label: 'OCT-SRC-2026-0207' }]}
                />
              </State>
              <State label="Phone form (‹ Parent)">
                <Breadcrumbs
                  variant="back"
                  label={`Breadcrumb, phone ${sfx(d)}`}
                  items={[{ label: 'My account', href: '/account' }, { label: 'Orders', href: '/account/orders' }, { label: 'OCT-SRC-2026-0207' }]}
                />
              </State>
              <State label="Auto (resize the window)">
                <Breadcrumbs
                  label={`Breadcrumb, auto ${sfx(d)}`}
                  items={[{ label: 'Back Office', href: '/office' }, { label: 'Accounts', href: '/office/accounts/invoices' }, { label: 'Invoices', href: '/office/accounts/invoices' }, { label: 'INV-2026-0412' }]}
                />
              </State>
            </div>
          )}
        </DensityPair>
      </Demo>

      <Demo
        id="menu-button"
        title="MenuButton"
        note="Shared menu used by More ▾, the company and app switchers, + New ▾ and user menus. ↓ / Enter / Space open; ↑ ↓ Home End move; Esc closes and returns focus; disabled items stay focusable and say why."
        phone="Same dropdown, at most 320 px wide."
      >
        <DensityPair>
          {(d) => (
            <div className="flex flex-wrap items-start gap-4">
              <MenuButton
                label="Actions"
                items={[
                  { id: 'dup', label: 'Duplicate order', icon: FileClock, onSelect: () => setMenuLog(`Duplicate order (${d})`) },
                  { id: 'pdf', label: 'Download PDF', icon: FileText, onSelect: () => setMenuLog(`Download PDF (${d})`), shortcut: 'D' },
                  { id: 'ship', label: 'Change shipping', icon: Ship, disabled: true, disabledReason: 'Shipping is booked; ask support to change it.' },
                  { id: 'cancel', label: 'Cancel order', icon: Trash2, destructive: true, separatorBefore: true, onSelect: () => setMenuLog(`Cancel order (${d})`) },
                ]}
                triggerClassName={buttonClass('secondary')}
              />
              <MenuButton
                label="Al Noor Trading LLC"
                menuLabel={`Switch company ${sfx(d)}`}
                items={COMPANIES.map((c) => ({ id: c.id, label: c.name, checked: c.id === 'c1', onSelect: () => setMenuLog(`Company: ${c.name} (${d})`) }))}
              />
            </div>
          )}
        </DensityPair>
        <p className="mt-3 text-ods-small text-ods-slate" aria-live="polite">
          Last choice: {menuLog}
        </p>
      </Demo>
    </>
  );
}
