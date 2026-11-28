import 'server-only';
import { cache } from 'react';
import { can, getSession } from '@/lib/auth';
import { staffLayoutGuard } from '@/lib/staff/guard';
import { moderationPendingCount } from '@/lib/moderation-count';
import { getWorkQueue } from '@/lib/core/work-queue';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { isStaging } from '@/lib/core/account';
import { roleLabel, type OfficeCounts, type OfficePerms } from './nav';
import { loadWorkspace } from '@/lib/office/workspace';
import { staffUnreadCount } from '@/lib/office/notifications';
import type { PersistedWorkspace } from './persistence';

export type OfficeFrameData = {
  user: { id: string; name: string; role: string; email: string | null };
  perms: OfficePerms;
  counts: OfficeCounts;
  division: { options: { code: string; name: string; inactive: boolean }[]; current: string | null; currentName: string | null };
  staging: boolean;
  /** Server copy of the open tabs (T8-DATA workspace_tabs) when available; null = local only. */
  workspace: PersistedWorkspace | null;
  /** 'db' when the workspace_tabs / ui_prefs tables answer (the frame then saves there too); else localStorage only. */
  persistence: 'db' | 'local';
  /** Server ui_prefs: sidebar collapsed (used when this device has no local choice yet). */
  sidebarCollapsed: boolean | null;
  /** T8-DATA staff alerts (staff_notifications) unread; null = channel not installed yet. */
  staffUnread: number | null;
};

/**
 * ODS T8 · the Back Office frame's data — the SAME guard and the same reads as today's StaffLayoutShell
 * (components/shell/staff-layout.tsx), React-cached per request:
 *  - staffLayoutGuard: signed out → /staff/login?next, customers → /login, office IP rule → blocked notice;
 *    (proxy.ts has already enforced the staff session cookie, 2FA and the idle / total limits before the rewrite);
 *  - division scope (header switcher), staff notification count (my_notifications, unread), work-queue counts, product
 *    moderation count, the dropship_v2_ui switch, division memberships and wh_my_warehouses for the menu rules;
 *  - plus T8-DATA: loadWorkspace() (open tabs + ui prefs) and staffUnreadCount() (staff alerts), both never throwing.
 * Every page still calls its own requireStaff(area, action).
 */
export const getOfficeFrameData = cache(async (next: string): Promise<OfficeFrameData> => {
  const session = await staffLayoutGuard(await getSession(), next);
  const sb = await createClient();
  const scope = await getDivisionScope(session);
  const unreadQ = sb.rpc('my_notifications', undefined, { count: 'exact', head: true }).is('read_at', null);
  const [moderation, q, unread, dropshipV2Ui, myDivs, warehouseMember, ws, staffUnread] = await Promise.all([
    moderationPendingCount(),
    getWorkQueue(session, scope).catch(() => null),
    (scope.all ? unreadQ : unreadQ.eq('division_id', scope.division.id)).then((r) => r.count ?? 0, () => 0),
    isDropshipV2UiEnabled(),
    sb.from('division_members').select('division_id, role').eq('user_id', session.userId),
    sb.rpc('wh_my_warehouses').then((r) => !r.error && Array.isArray(r.data) && r.data.length > 0, () => false),
    // T8-DATA (never throw; 'local-only' / unavailable before migrations 254–256 are applied)
    loadWorkspace().catch(() => null),
    staffUnreadCount().then((r) => (r.ok ? r.data : null), () => null),
  ]);
  const fromDb = ws?.source === 'db';
  const dsDivId = scope.options.find((d) => d.code === 'DS')?.id ?? null;
  const canEditDropship =
    session.isAdmin || Boolean(dsDivId && (myDivs.data ?? []).some((m) => m.division_id === dsDivId && ['manager', 'staff'].includes(String(m.role))));
  const memberCodes = (myDivs.data ?? []).map((m) => scope.options.find((d) => d.id === m.division_id)?.code).filter(Boolean) as string[];
  const canSeeRates =
    session.isAdmin || can(session, 'finance', 'view') || can(session, 'orders', 'edit') || can(session, 'warehouse', 'view') || memberCodes.includes('3PL') || memberCodes.includes('DS');
  // StaffShell: canOpenDropship = admin || finance:view || support:edit || in the DS division (scope options)
  const inDs = scope.options.some((d) => d.code === 'DS');
  const canOpenDropship = session.isAdmin || can(session, 'finance', 'view') || can(session, 'support', 'edit') || inDs;
  const perms: OfficePerms = {
    isAdmin: session.isAdmin,
    roles: session.roles,
    permissions: [...session.permissions],
    canOpenDropship,
    canSeeRates,
    canSeeFeesDuty: canOpenDropship || memberCodes.includes('3PL'),
    canEditDropship,
    canSeeSaas: session.isAdmin || can(session, 'finance', 'view'),
    warehouseMember,
    dropshipV2Ui,
  };
  const name = session.profile?.full_name || session.email || 'Staff';
  return {
    user: { id: session.userId, name, role: roleLabel(perms), email: session.email },
    perms,
    counts: {
      queue: q?.stats.open ?? 0,
      approvals: q?.myApprovals ?? 0,
      transfers: q?.items.filter((i) => i.key.startsWith('tt-')).length ?? 0,
      moderation: moderation ?? 0,
      unread,
    },
    division: {
      options: scope.options.map((d) => ({ code: d.code, name: d.name, inactive: d.status !== 'active' })),
      current: scope.all ? null : scope.division.code,
      currentName: scope.all ? null : scope.division.name,
    },
    staging: isStaging(),
    workspace: fromDb && ws ? { tabs: ws.tabs, activeId: ws.activeId, updatedAt: ws.updatedAt } : null,
    persistence: fromDb ? 'db' : 'local',
    sidebarCollapsed: fromDb && ws ? ws.prefs.sidebarCollapsed : null,
    staffUnread,
  };
});
