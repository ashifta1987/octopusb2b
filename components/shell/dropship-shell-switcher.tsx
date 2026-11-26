'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DropshipMerchantShell } from './dropship-merchant-shell';
import { DropshipStaffShell } from './dropship-staff-shell';
import { WarehouseStaffShell } from './warehouse-staff-shell';
import type { DropshipFeatures } from '@/lib/dropship-features-shared';

export function AccountShellSwitcher({
  v2ShellEnabled,
  dropshipEnabled = true,
  userName,
  initials,
  storeName,
  unreadCount,
  importListCount,
  ordersCount,
  isStaging,
  features,
  defaultShell,
  children,
}: {
  v2ShellEnabled: boolean;
  dropshipEnabled?: boolean;
  features?: DropshipFeatures;
  userName: string;
  initials: string;
  storeName?: string | null;
  unreadCount: number;
  importListCount?: number;
  ordersCount?: number;
  isStaging: boolean;
  defaultShell: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (v2ShellEnabled && pathname?.startsWith('/account/dropship')) {
    return (
      <DropshipMerchantShell
        dropshipEnabled={dropshipEnabled}
        userName={userName}
        initials={initials}
        storeName={storeName}
        unreadCount={unreadCount}
        importListCount={importListCount}
        ordersCount={ordersCount}
        isStaging={isStaging}
        features={features}
      >
        {children}
      </DropshipMerchantShell>
    );
  }
  return <>{defaultShell}</>;
}

export function StaffShellSwitcher({
  v2ShellEnabled,
  canSeeDropshipItems,
  canSeeRates = false,
  canSeeFeesDuty = false,
  canEditDropship = false,
  canSeeSaas,
  isAdmin = false,
  warehouseMember = true,
  userName,
  initials,
  unreadCount,
  isStaging,
  defaultShell,
  children,
}: {
  v2ShellEnabled: boolean;
  canSeeDropshipItems: boolean;
  canSeeRates?: boolean;
  canSeeFeesDuty?: boolean;
  canEditDropship?: boolean;
  canSeeSaas: boolean;
  isAdmin?: boolean;
  /** W7: whether the person works in a warehouse (decides menus pointing at Warehouse OS) */
  warehouseMember?: boolean;
  userName: string;
  initials: string;
  unreadCount: number;
  isStaging: boolean;
  defaultShell: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Warehouse OS (W0): its own staff shell and left menu
  if (pathname === '/office/warehouse' || pathname?.startsWith('/office/warehouse/')) {
    return (
      <WarehouseStaffShell userName={userName} initials={initials} unreadCount={unreadCount} isStaging={isStaging} isAdmin={isAdmin} warehouseMember={isAdmin || warehouseMember}>
        {children}
      </WarehouseStaffShell>
    );
  }
  if (
    v2ShellEnabled &&
    (pathname?.startsWith('/office/dropship') ||
      pathname?.startsWith('/admin/finance/saas'))
  ) {
    return (
      <DropshipStaffShell
        userName={userName}
        initials={initials}
        unreadCount={unreadCount}
        isStaging={isStaging}
        canSeeDropshipItems={canSeeDropshipItems}
        canSeeRates={canSeeRates}
        canSeeFeesDuty={canSeeFeesDuty}
        canEditDropship={canEditDropship}
        canSeeSaas={canSeeSaas}
        warehouseMember={isAdmin || warehouseMember}
      >
        {children}
      </DropshipStaffShell>
    );
  }
  return <>{defaultShell}</>;
}
