'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DropshipMerchantShell } from './dropship-merchant-shell';
import { DropshipStaffShell } from './dropship-staff-shell';

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
  defaultShell,
  children,
}: {
  v2ShellEnabled: boolean;
  dropshipEnabled?: boolean;
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
  canEditDropship = false,
  canSeeSaas,
  userName,
  initials,
  unreadCount,
  isStaging,
  defaultShell,
  children,
}: {
  v2ShellEnabled: boolean;
  canSeeDropshipItems: boolean;
  canEditDropship?: boolean;
  canSeeSaas: boolean;
  userName: string;
  initials: string;
  unreadCount: number;
  isStaging: boolean;
  defaultShell: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
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
        canEditDropship={canEditDropship}
        canSeeSaas={canSeeSaas}
      >
        {children}
      </DropshipStaffShell>
    );
  }
  return <>{defaultShell}</>;
}
