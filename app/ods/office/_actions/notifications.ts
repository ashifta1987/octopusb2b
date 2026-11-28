'use server';
import { listStaffNotifications, markStaffNotificationsRead, staffUnreadCount } from '@/lib/office/notifications';
import type { OfficeResult, StaffNotification } from '@/lib/office/workspace-core';

/** Topbar bell / phone Alerts tab. */
export async function staffNotificationsAction(opts: { limit?: number; unreadOnly?: boolean; before?: string | null } = {}): Promise<OfficeResult<StaffNotification[]>> {
  return listStaffNotifications(opts);
}

export async function staffUnreadCountAction(): Promise<OfficeResult<number>> {
  return staffUnreadCount();
}

/** ids = these; null = all. */
export async function markStaffNotificationsReadAction(ids: string[] | null): Promise<OfficeResult<number>> {
  return markStaffNotificationsRead(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : null);
}
