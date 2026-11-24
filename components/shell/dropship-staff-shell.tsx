'use client';

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
  role: 'dropship' | 'saas';
};

/**
 * Step U1 Rule 4:
 * - "Product editor" is removed from the staff menu; the editor opens from a product row (/office/dropship/[id] or /office/dropship/new).
 * - "Pack station" opens the fulfilment queue filtered to packing (/office/dropship/queue?status=packing) or /office/dropship/pack/[order].
 * - Dropship division staff and company-wide admins see the Dropship items; "Finance: SaaS billing" shows only to company-wide Finance and admins.
 */
const STAFF_ITEMS: StaffDropshipNavItem[] = [
  { href: '/office/dropship', label: 'Products', icon: 'package', matchPrefix: '/office/dropship', role: 'dropship' },
  { href: '/office/dropship/import', label: 'Import products', icon: 'upload', matchPrefix: '/office/dropship/import', role: 'dropship' },
  { href: '/office/dropship/compliance', label: 'Duty, tax and customs', icon: 'globe', matchPrefix: '/office/dropship/compliance', role: 'dropship' },
  { href: '/office/dropship/queue', label: 'Fulfilment queue', icon: 'list', matchPrefix: '/office/dropship/queue', role: 'dropship' },
  { href: '/office/dropship/queue?status=packing', label: 'Pack station', icon: 'scale', matchPrefix: '/office/dropship/pack', role: 'dropship' },
  { href: '/office/dropship/merchants', label: 'Merchants', icon: 'users', matchPrefix: '/office/dropship/merchants', role: 'dropship' },
  { href: '/office/dropship/fees', label: 'Fees and plans', icon: 'percent', matchPrefix: '/office/dropship/fees', role: 'dropship' },
  { href: '/office/dropship/health', label: 'System health', icon: 'activity', matchPrefix: '/office/dropship/health', role: 'dropship' },
  { href: '/admin/finance/saas', label: 'Finance: SaaS billing', icon: 'card', matchPrefix: '/admin/finance/saas', role: 'saas' },
];

const NON_CATALOG_PREFIXES = [
  '/office/dropship/import',
  '/office/dropship/compliance',
  '/office/dropship/queue',
  '/office/dropship/pack',
  '/office/dropship/merchants',
  '/office/dropship/fees',
  '/office/dropship/health',
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
  canSeeSaas = false,
  children,
}: {
  userName: string;
  initials: string;
  unreadCount?: number;
  isStaging?: boolean;
  canSeeDropshipItems?: boolean;
  canSeeSaas?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isFinanceSaas = pathname.startsWith('/admin/finance/saas');
  const visibleItems = STAFF_ITEMS.filter((item) =>
    item.role === 'saas' ? canSeeSaas : canSeeDropshipItems,
  );

  return (
    <div
      data-testid="dropship-staff-shell"
      className={`${dsInter.variable} ds-v2 min-h-screen flex flex-col md:flex-row bg-[#F4F6F9] text-[#1A174A] overflow-x-hidden`}
    >
      <nav
        aria-label="Back office"
        data-testid="dropship-staff-sidebar"
        className="w-full md:w-[240px] shrink-0 bg-[#1A174A] text-white px-4 py-6 box-border flex flex-col gap-1"
      >
        <div className="px-2 pb-1.5 text-[16px] font-bold">Octopus B2B</div>
        <div className="px-2 pb-4 text-[12px] text-[#C9D3E3]">
          {isFinanceSaas
            ? 'Finance · SaaS billing'
            : 'Back office · Dropshipping division'}
        </div>

        <div
          className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0"
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
                className={`flex items-center gap-3 px-3 min-h-[44px] rounded-[8px] no-underline text-[14px] box-border whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#2E2B66] text-white hover:text-white font-semibold shadow-[inset_3px_0_0_#5FD3C9]'
                    : 'text-[#C9D3E3] hover:text-white hover:bg-[#221F58] font-medium'
                }`}
              >
                <DsIcon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-auto pt-4 md:pt-6">
          <div className="p-3 border border-[#3A3775] rounded-[10px] text-[12px] leading-[1.5] text-[#C9D3E3]">
            <div>Staff only. Supplier names are visible here and never to merchants.</div>
            <Link
              href="/admin"
              className="inline-block mt-1.5 text-[#5FD3C9] hover:text-white font-semibold no-underline"
            >
              Back to Admin work queue →
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:pt-5 md:pb-10 box-border">
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
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
                  className="mono text-[11px] font-bold uppercase tracking-[.1em] px-2.5 py-1 rounded-full bg-[#FFF4E0] text-[#8A5300]"
                >
                  Staging
                </span>
              ) : null
            }
          />
          {children}
        </div>
      </main>
    </div>
  );
}
