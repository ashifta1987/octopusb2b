'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DsIcon, DsTopBar, type DsIconName } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';

/**
 * Warehouse OS staff shell (docs/design/warehouse-os §4): one left menu for every desktop staff screen.
 * Screens not built yet are listed (staff-side honesty) but not linked, with the step that ships them.
 */
type Item = { href: string; label: string; icon: DsIconName; ships?: string; adminOnly?: boolean };
const ITEMS: Item[] = [
  { href: '/office/warehouse', label: 'Dashboard', icon: 'grid' },
  { href: '/office/warehouse/orders', label: 'Orders', icon: 'cart', ships: 'W3' },
  { href: '/office/warehouse/packing', label: 'Packing station', icon: 'package', ships: 'W3' },
  { href: '/office/warehouse/dispatch', label: 'Dispatch and freight', icon: 'truck', ships: 'W4' },
  { href: '/office/warehouse/multi-parcel', label: 'Multi-parcel packing', icon: 'layers', ships: 'W3' },
  { href: '/office/warehouse/putaway', label: 'Putaway and pallets', icon: 'box', ships: 'W2' },
  { href: '/office/warehouse/counts', label: 'Counts and lots', icon: 'list', ships: 'W2' },
  { href: '/office/warehouse/materials', label: 'Materials', icon: 'tag', ships: 'W3' },
  { href: '/office/warehouse/labels', label: 'Label centre', icon: 'file', ships: 'W2' },
  { href: '/office/warehouse/inbound', label: 'Inbound', icon: 'download', ships: 'W2' },
  { href: '/office/warehouse/dock', label: 'Dock appointments', icon: 'clock', ships: 'W2' },
  { href: '/office/warehouse/evidence', label: 'Evidence', icon: 'image', ships: 'W3' },
  { href: '/office/warehouse/scale', label: 'Scale check', icon: 'scale', ships: 'W3' },
  { href: '/office/warehouse/carriers', label: 'Carriers and rules', icon: 'globe', ships: 'W4' },
  { href: '/office/warehouse/clients', label: 'Clients', icon: 'users', ships: 'W1' },
  { href: '/office/warehouse/rates', label: 'Rates', icon: 'percent', ships: 'W1' },
  { href: '/office/warehouse/exceptions', label: 'Exceptions', icon: 'alert', ships: 'W3' },
  { href: '/office/warehouse/reports', label: 'Reports', icon: 'chart', ships: 'W6' },
  { href: '/office/warehouse/users', label: 'Users and roles', icon: 'user' },
  { href: '/office/warehouse/locations', label: 'Locations', icon: 'store', adminOnly: true },
];

function active(href: string, pathname: string) {
  return href === '/office/warehouse' ? pathname === href : pathname === href || pathname.startsWith(href + '/');
}

export function WarehouseStaffShell({
  userName, initials, unreadCount = 0, isStaging = false, isAdmin = false, children,
}: { userName: string; initials: string; unreadCount?: number; isStaging?: boolean; isAdmin?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div data-testid="warehouse-staff-shell" className={`${dsInter.variable} ds-v2 min-h-screen flex flex-col md:flex-row bg-[#F4F6F9] text-[#1A174A] overflow-x-hidden`}>
      <nav aria-label="Warehouse" data-testid="warehouse-sidebar" className="w-full md:w-[248px] shrink-0 bg-[#1A174A] text-white px-4 py-6 box-border flex flex-col gap-1">
        <Link href="/office/warehouse" className="block px-2 pb-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/octopus-b2b-logo-white.png" alt="Octopus B2B" className="w-[150px] max-w-full h-auto block" />
        </Link>
        <div className="px-2 pb-4 text-[12px] text-[#C9D3E3]">Warehouse OS · 3PL and logistics</div>
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0" role="region" aria-label="Warehouse navigation" tabIndex={0}>
          {ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => {
            if (i.ships) {
              return (
                <span key={i.href} aria-disabled="true" title={`Ships in step ${i.ships}`}
                  className="flex items-center gap-3 px-3 min-h-[44px] rounded-[8px] text-[14px] whitespace-nowrap text-[#AEB9D6] cursor-default select-none">
                  <DsIcon name={i.icon} size={18} />
                  <span>{i.label}</span>
                  <span className="ml-auto text-[10.5px] font-bold tracking-wide text-[#AEB9D6] border border-[#3A3775] rounded px-1.5">{i.ships}</span>
                </span>
              );
            }
            const on = active(i.href, pathname);
            return (
              <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 min-h-[44px] rounded-[8px] no-underline text-[14px] whitespace-nowrap ${on ? 'bg-[#2E2B66] text-white hover:text-white font-semibold shadow-[inset_3px_0_0_#8FB6F8]' : 'text-[#C9D3E3] hover:text-white hover:bg-[#221F58] font-medium'}`}>
                <DsIcon name={i.icon} size={18} />
                <span>{i.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="mt-auto pt-4 md:pt-6">
          <div className="p-3 border border-[#3A3775] rounded-[10px] text-[12px] leading-[1.5] text-[#C9D3E3]">
            <Link href="/account/warehouse" className="block text-[#8FB6F8] hover:text-white font-semibold no-underline">Client portal →</Link>
            <Link href="/admin" className="inline-block mt-1.5 text-[#8FB6F8] hover:text-white font-semibold no-underline">Back to Admin work queue →</Link>
          </div>
        </div>
      </nav>
      <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:pt-5 md:pb-10 box-border">
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
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
            extraRight={isStaging ? <span data-testid="staging-badge" className="mono text-[11px] font-bold uppercase tracking-[.1em] px-2.5 py-1 rounded-full bg-[#FFF4E0] text-[#8A5300]">Staging</span> : null}
          />
          {children}
        </div>
      </main>
    </div>
  );
}
