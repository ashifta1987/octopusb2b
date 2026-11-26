'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DsIcon, DsTopBar, type DsIconName } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';
import { AppLogo } from './app-logo';

/**
 * Warehouse OS staff shell (docs/design/warehouse-os §4): one left menu for every desktop staff screen.
 * Screens not built yet are listed (staff-side honesty) but not linked, with the step that ships them.
 * W2b: Putaway and pallets, Label centre and Transfers are live; the menu and top bar are hidden when a label sheet is printed.
 * W3a: Orders, Picking (handheld), Packing station and Evidence are live.
 * W3b: Multi-parcel packing, Materials, Scale check and Exceptions are live.
 * W4: Dispatch and freight (labels, label check, hand-over with manifest, freight pallets, tracking) and Carriers and rules are live.
 * W5: Returns is live (not on the board-4 menu list; added next to Exceptions).
 * W6: Reports is live; Client invoices (the monthly invoice run — warehouse admins preview, Finance issues) is added next to Rates.
 * W7: B2B shipments (Sourcing orders shipped by the supplier — replaces /office/shipping, D10) after Dispatch and freight. It is
 * the only item for staff who open it without working in a warehouse (orders:view, e.g. Sourcing or Support).
 */
type Item = { href: string; label: string; icon: DsIconName; ships?: string; adminOnly?: boolean; /** W7: shown to staff without a warehouse role */ open?: boolean };
const ITEMS: Item[] = [
  { href: '/office/warehouse', label: 'Dashboard', icon: 'grid' },
  { href: '/office/warehouse/orders', label: 'Orders', icon: 'cart' },
  // handheld picking (board 6), next to Orders
  { href: '/office/warehouse/pick', label: 'Picking', icon: 'list' },
  { href: '/office/warehouse/pack', label: 'Packing station', icon: 'package' },
  { href: '/office/warehouse/dispatch', label: 'Dispatch and freight', icon: 'truck' },
  // W7: B2B order shipping (the retired /office/shipping) — its own orders:view permission, not a warehouse role
  { href: '/office/warehouse/b2b-shipments', label: 'B2B shipments', icon: 'send', open: true },
  { href: '/office/warehouse/multi-parcel', label: 'Multi-parcel packing', icon: 'layers' },
  { href: '/office/warehouse/putaway', label: 'Putaway and pallets', icon: 'box' },
  { href: '/office/warehouse/counts', label: 'Counts and lots', icon: 'list' },
  { href: '/office/warehouse/materials', label: 'Materials', icon: 'tag' },
  { href: '/office/warehouse/labels', label: 'Label centre', icon: 'file' },
  { href: '/office/warehouse/inbound', label: 'Inbound', icon: 'download' },
  { href: '/office/warehouse/dock', label: 'Dock appointments', icon: 'clock' },
  // amendment (several China warehouses): stock moved between warehouses
  { href: '/office/warehouse/transfers', label: 'Transfers', icon: 'send' },
  { href: '/office/warehouse/evidence', label: 'Evidence', icon: 'image' },
  { href: '/office/warehouse/scale', label: 'Scale check', icon: 'scale' },
  { href: '/office/warehouse/carriers', label: 'Carriers and rules', icon: 'globe' },
  { href: '/office/warehouse/clients', label: 'Clients', icon: 'users' },
  { href: '/office/warehouse/rates', label: 'Rates', icon: 'percent' },
  // W6: monthly client invoices (not on the board-4 menu list; next to Rates)
  // W7: open — Finance previews / issues invoices without a warehouse role (the page checks wh_invoice_access)
  { href: '/office/warehouse/invoices', label: 'Client invoices', icon: 'dollar', open: true },
  { href: '/office/warehouse/exceptions', label: 'Exceptions', icon: 'alert' },
  // W5: returns desk (register, photograph and grade; carry out the client's restock / discard / send-back decision)
  { href: '/office/warehouse/returns', label: 'Returns', icon: 'refresh' },
  { href: '/office/warehouse/reports', label: 'Reports', icon: 'chart' },
  { href: '/office/warehouse/users', label: 'Users and roles', icon: 'user' },
  { href: '/office/warehouse/locations', label: 'Locations', icon: 'store', adminOnly: true },
];

function active(href: string, pathname: string) {
  return href === '/office/warehouse' ? pathname === href : pathname === href || pathname.startsWith(href + '/');
}

export function WarehouseStaffShell({
  userName, initials, unreadCount = 0, isStaging = false, isAdmin = false, warehouseMember = true, children,
}: { userName: string; initials: string; unreadCount?: number; isStaging?: boolean; isAdmin?: boolean; warehouseMember?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  // Design handoff 26 Nov 2026 (App shell §3): 264 px white sidebar (full-colour logo, context box, 44 px items), white
  // top bar, Pearl main. Phones keep the menu strip above the top bar; printing a label sheet hides menu and top bar.
  return (
    <div data-testid="warehouse-staff-shell" className={`${dsInter.variable} ds-v2 app-shell min-h-screen bg-pearl text-black overflow-x-clip app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr] print:block print:bg-white`}>
      <a href="#wh-staff-main" className="skip-link print:hidden">Skip to content</a>
      <nav aria-label="Warehouse" data-testid="warehouse-sidebar" className="print:hidden app-sidebar w-full box-border gap-1 border-b md:border-b-0 md:border-r px-4 pt-4 pb-2 md:px-3.5 md:pt-6 md:pb-7 md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto">
        <div className="px-2 pb-3 md:pb-4">
          <AppLogo variant="b2b" href="/office/warehouse" label="Octopus B2B" className="[&_img]:h-[40px] md:[&_img]:h-[48px]" />
        </div>
        <div className="app-context mb-1 md:mb-2">
          <span className="app-context-tile" aria-hidden="true"><DsIcon name="box" size={22} /></span>
          <span className="min-w-0 text-[14px] font-bold leading-snug text-ink">Warehouse OS · 3PL and logistics</span>
        </div>
        <div className="app-grp hidden md:block">Menu</div>
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pt-1 pb-2 md:p-0" role="region" aria-label="Warehouse navigation" tabIndex={0}>
          {ITEMS.filter((i) => (!i.adminOnly || isAdmin) && (warehouseMember || i.open)).map((i) => {
            if (i.ships) {
              return (
                <span key={i.href} aria-disabled="true" title={`Ships in step ${i.ships}`}
                  className="app-nav shrink-0 whitespace-nowrap text-muted font-medium cursor-default select-none hover:bg-transparent">
                  <DsIcon name={i.icon} size={20} />
                  <span>{i.label}</span>
                  <span className="ml-auto text-[11px] font-bold tracking-wide text-muted border border-line rounded px-1.5">{i.ships}</span>
                </span>
              );
            }
            const on = active(i.href, pathname);
            return (
              <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined}
                className="app-nav shrink-0 whitespace-nowrap hover:text-ink">
                <DsIcon name={i.icon} size={20} />
                <span>{i.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="mt-auto pt-4 md:pt-6">
          <div className="px-3.5 py-1 border border-line rounded-[14px] bg-pearl text-[13px] leading-[1.5]">
            <Link href="/account/warehouse" className="flex items-center min-h-11 text-coral-text hover:text-ink font-semibold no-underline">Client portal →</Link>
            <Link href="/admin" className="flex items-center min-h-11 text-coral-text hover:text-ink font-semibold no-underline">Back to Admin work queue →</Link>
          </div>
        </div>
      </nav>
      <header className="app-topbar print:hidden md:col-start-2 md:row-start-1">
        <DsTopBar
          searchPlaceholder="Search orders and stock"
          searchAction=""
          unreadCount={unreadCount}
          notificationsHref="/admin/notifications"
          helpHref="/office/support"
          accountHref="/staff/account"
          backToAccountHref="/admin"
          backToAccountLabel="Back to Admin work queue"
          userName={userName}
          initials={initials}
          extraRight={isStaging ? <span data-testid="staging-badge" className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-warn-bg text-warn">Staging</span> : null}
        />
      </header>
      <main id="wh-staff-main" tabIndex={-1} className="app-main box-border md:col-start-2 md:row-start-2 focus:outline-none print:p-0">
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
          {children}
        </div>
      </main>
    </div>
  );
}
