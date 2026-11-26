'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DsIcon, DsTopBar, type DsIconName } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';

export type StaffDropshipNavItem = {
  href: string;
  label: string;
  icon: DsIconName;
  matchPrefix: string;
  role: 'dropship' | 'dropship_edit' | 'saas' | 'rates' | 'fees_duty' | 'warehouse';
};

/**
 * Step U1 Rule 4:
 * - "Product editor" is removed from the staff menu; the editor opens from a product row (/office/dropship/[id] or /office/dropship/new).
 * - "Pack station" (W7) opens the Warehouse OS packing station; "Fulfilment queue" opens Warehouse OS orders (Dropship).
 * - Dropship division staff and company-wide admins see the Dropship items; "Finance: SaaS billing" shows only to company-wide Finance and admins.
 * EA-1 (design v2 staff menu): adds "Shipping rates" and moves "Product requests" up. 3PL & Shipping staff also see Duty,
 * Shipping rates and Fees; Support never sees Shipping rates. "Product editor" stays out of the menu (U1 rule above).
 * Warehouse OS W7 (D10): "Fulfilment queue" and "Pack station" open Warehouse OS (Dropship orders / packing station) for staff
 * who work in a warehouse, and are hidden for everyone else (the old URLs say where the work moved).
 * Release 4 · Step 10: "Order problems" (claims, returns, re-weighs — the Exceptions of staff/StaffQueue.html for Dropship).
 */
const STAFF_ITEMS: StaffDropshipNavItem[] = [
  { href: '/office/dropship', label: 'Products', icon: 'package', matchPrefix: '/office/dropship', role: 'dropship' },
  { href: '/office/dropship/import', label: 'Import products', icon: 'upload', matchPrefix: '/office/dropship/import', role: 'dropship_edit' },
  { href: '/office/dropship/requests', label: 'Product requests', icon: 'file', matchPrefix: '/office/dropship/requests', role: 'dropship' },
  { href: '/office/dropship/compliance', label: 'Duty, tax and customs', icon: 'globe', matchPrefix: '/office/dropship/compliance', role: 'fees_duty' },
  { href: '/office/dropship/rates', label: 'Shipping rates', icon: 'truck', matchPrefix: '/office/dropship/rates', role: 'rates' },
  { href: '/office/warehouse/orders?source=dropship', label: 'Fulfilment queue', icon: 'list', matchPrefix: '/office/warehouse/orders', role: 'warehouse' },
  { href: '/office/warehouse/pack', label: 'Pack station', icon: 'scale', matchPrefix: '/office/warehouse/pack', role: 'warehouse' },
  { href: '/office/dropship/problems', label: 'Order problems', icon: 'flag', matchPrefix: '/office/dropship/problems', role: 'dropship' },
  { href: '/office/dropship/approvals', label: 'Supplier approvals', icon: 'check', matchPrefix: '/office/dropship/approvals', role: 'dropship' },
  { href: '/office/dropship/suppliers', label: 'Suppliers', icon: 'layers', matchPrefix: '/office/dropship/suppliers', role: 'dropship' },
  { href: '/office/dropship/merchants', label: 'Merchants', icon: 'users', matchPrefix: '/office/dropship/merchants', role: 'dropship' },
  { href: '/office/dropship/partners', label: 'Sales partners', icon: 'send', matchPrefix: '/office/dropship/partners', role: 'dropship' },
  { href: '/office/dropship/fees', label: 'Fees and plans', icon: 'percent', matchPrefix: '/office/dropship/fees', role: 'fees_duty' },
  { href: '/office/dropship/invoicing', label: 'Invoicing', icon: 'file', matchPrefix: '/office/dropship/invoicing', role: 'dropship' },
  { href: '/office/dropship/docs', label: 'Docs', icon: 'shield', matchPrefix: '/office/dropship/docs', role: 'dropship' },
  { href: '/office/dropship/health', label: 'System health', icon: 'activity', matchPrefix: '/office/dropship/health', role: 'dropship' },
  { href: '/admin/finance/saas', label: 'Finance: SaaS billing', icon: 'card', matchPrefix: '/admin/finance/saas', role: 'saas' },
];

const NON_CATALOG_PREFIXES = [
  '/office/dropship/import',
  '/office/dropship/compliance',
  '/office/dropship/rates',
  // W7: still listed so the retired /office/dropship/queue|pack URLs never highlight "Products"
  '/office/dropship/queue',
  '/office/dropship/pack',
  '/office/dropship/problems',
  '/office/dropship/merchants',
  '/office/dropship/requests',
  '/office/dropship/fees',
  '/office/dropship/health',
  '/office/dropship/approvals',
  '/office/dropship/suppliers',
  '/office/dropship/partners',
  '/office/dropship/invoicing',
  '/office/dropship/docs',
  '/office/dropship/ui-kit',
];

function isStaffItemActive(item: StaffDropshipNavItem, pathname: string): boolean {
  if (item.matchPrefix === '/office/dropship') {
    if (pathname === '/office/dropship' || pathname === '/office/dropship/new') return true;
    if (
      pathname.startsWith('/office/dropship/') &&
      !NON_CATALOG_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
    ) {
      return true;
    }
    return false;
  }
  return pathname === item.matchPrefix || pathname.startsWith(item.matchPrefix + '/');
}

export function DropshipStaffShell({
  userName,
  initials,
  unreadCount = 0,
  isStaging = false,
  canSeeDropshipItems = true,
  canSeeRates = false,
  canSeeFeesDuty = false,
  canEditDropship = false,
  canSeeSaas = false,
  warehouseMember = true,
  children,
}: {
  userName: string;
  initials: string;
  unreadCount?: number;
  isStaging?: boolean;
  canSeeDropshipItems?: boolean;
  canSeeRates?: boolean;
  canSeeFeesDuty?: boolean;
  canEditDropship?: boolean;
  canSeeSaas?: boolean;
  warehouseMember?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isFinanceSaas = pathname.startsWith('/admin/finance/saas');
  const visibleItems = STAFF_ITEMS.filter((item) =>
    item.role === 'warehouse'
      ? canSeeDropshipItems && warehouseMember
      : item.role === 'saas'
      ? canSeeSaas
      : item.role === 'rates'
        ? canSeeRates
        : item.role === 'fees_duty'
          ? canSeeFeesDuty || canSeeDropshipItems
      : item.role === 'dropship_edit'
        ? canSeeDropshipItems && canEditDropship
        : canSeeDropshipItems,
  );

  // Design handoff 26 Nov 2026 (App shell §3): 264 px white sidebar (Octopus Dropship logo, context box, 44 px items),
  // white top bar (search, 46 px icon buttons, user chip), Pearl main. Phones keep the menu strip above the top bar.
  return (
    <div
      data-testid="dropship-staff-shell"
      className={`${dsInter.variable} ds-v2 app-shell min-h-screen bg-pearl text-black overflow-x-clip app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr]`}
    >
      <a href="#ds-staff-main" className="skip-link">Skip to content</a>
      <nav
        aria-label="Back office"
        data-testid="dropship-staff-sidebar"
        className="app-sidebar w-full box-border gap-1 border-b md:border-b-0 md:border-r px-4 pt-4 pb-2 md:px-3.5 md:pt-6 md:pb-7 md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto"
      >
        <div className="px-2 pb-3 md:pb-4">
          <Image
            src="/images/design/logos/function/octopus-dropship.png"
            alt="Octopus Dropship"
            width={800}
            height={329}
            loading="eager"
            sizes="160px"
            className="block w-auto h-[44px] md:h-[54px] rounded-[10px]"
          />
        </div>
        <div className="app-context mb-1 md:mb-2">
          <span className="app-context-tile" aria-hidden="true">
            <DsIcon name={isFinanceSaas ? 'card' : 'package'} size={22} />
          </span>
          <span className="min-w-0 text-[14px] font-bold leading-snug text-white">
            {isFinanceSaas
              ? 'Finance · SaaS billing'
              : 'Back office · Dropshipping division'}
          </span>
        </div>

        <div className="app-grp hidden md:block">Menu</div>
        <div
          className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pt-1 pb-2 md:p-0"
          tabIndex={0}
          role="region"
          aria-label="Staff navigation"
        >
          {visibleItems.map((item) => {
            const active = isStaffItemActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="app-nav shrink-0 whitespace-nowrap box-border hover:text-ink"
              >
                <DsIcon name={item.icon} size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-auto pt-4 md:pt-6">
          <div className="px-3.5 pt-3 pb-1 border border-line rounded-[14px] bg-pearl text-[13px] leading-[1.5] text-muted">
            <div>Staff only. Supplier names are visible here and never to merchants.</div>
            <Link
              href="/admin"
              className="inline-flex items-center min-h-11 text-coral-text hover:text-ink font-semibold no-underline"
            >
              Back to Admin work queue →
            </Link>
          </div>
        </div>
      </nav>

      <header className="app-topbar md:col-start-2 md:row-start-1">
        <DsTopBar
          searchPlaceholder="Search products, orders, merchants, DS or SR numbers"
          searchAction="/office/dropship"
          unreadCount={unreadCount}
          notificationsHref="/admin/notifications"
          helpHref="/office/dropship/health"
          accountHref="/staff/account"
          backToAccountHref="/admin"
          backToAccountLabel="Back to Admin work queue"
          userName={userName}
          initials={initials}
          extraRight={
            isStaging ? (
              <span
                data-testid="staging-badge"
                title="Staging environment: test data, not the live site"
                className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-warn-bg text-warn"
              >
                Staging
              </span>
            ) : null
          }
        />
      </header>

      <main id="ds-staff-main" tabIndex={-1} className="app-main box-border md:col-start-2 md:row-start-2 focus:outline-none">
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
          {children}
        </div>
      </main>
    </div>
  );
}
