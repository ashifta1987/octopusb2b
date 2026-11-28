import 'server-only';
import { officeAdmin, officeCtx } from '@/lib/office/server';
import { isAppPath, notificationFromRow, officeFail, okResult, type OfficeResult, type StaffNotification } from '@/lib/office/workspace-core';

export type { StaffNotification } from '@/lib/office/workspace-core';

/** The Back Office bell (staff_notifications, 256): own + own roles' alerts, newest first. */
export async function listStaffNotifications(opts: { limit?: number; unreadOnly?: boolean; before?: string | null } = {}): Promise<OfficeResult<StaffNotification[]>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_notifications_list', {
    p_limit: opts.limit ?? 30, p_unread_only: !!opts.unreadOnly, p_before: opts.before ?? null,
  });
  if (error) return officeFail(error);
  return okResult(((data ?? []) as Record<string, unknown>[]).map(notificationFromRow));
}

/** Unread count for the topbar badge (0 when the channel is not installed yet: `unavailable`). */
export async function staffUnreadCount(): Promise<OfficeResult<number>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_notifications_unread_count');
  if (error) return officeFail(error);
  return okResult(Number(data ?? 0));
}

/** Marks some (ids) or all (null) visible notifications read; returns how many changed. */
export async function markStaffNotificationsRead(ids: string[] | null): Promise<OfficeResult<number>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('staff_notifications_mark_read', { p_ids: ids && ids.length ? ids.slice(0, 500) : ids === null ? null : [] });
  if (error) return officeFail(error);
  return okResult(Number(data ?? 0));
}

/**
 * SERVER CODE ONLY (service role): alert one staff user (userId) or every holder of a staff role (role). Same dedupeKey → one
 * notification. Never call it with user input as the link: links must be app paths ("/office/…").
 */
export async function staffNotify(input: {
  userId?: string | null; role?: string | null; kind: string; title: string; body?: string | null; link?: string | null;
  refType?: string | null; refId?: string | null; dedupeKey?: string | null;
}): Promise<OfficeResult<string>> {
  if (!!input.userId === !!input.role) return officeFail('INVALID_TARGET: one staff user or one staff role');
  if (input.link && !isAppPath(input.link)) return officeFail('INVALID_INPUT: link must be a path in the app');
  const { data, error } = await officeAdmin().rpc('staff_notify', {
    p_user: input.userId ?? null, p_role: input.role ?? null, p_kind: input.kind, p_title: input.title, p_body: input.body ?? null,
    p_link: input.link ?? null, p_ref_type: input.refType ?? null, p_ref_id: input.refId ?? null, p_dedupe: input.dedupeKey ?? null,
  });
  if (error) return officeFail(error);
  return okResult(String(data));
}
