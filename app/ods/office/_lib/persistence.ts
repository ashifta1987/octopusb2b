/**
 * ODS T8 · Back Office persistence (Part 7.1: "open tabs, order, pins … saved per user (localStorage + a workspace_tabs
 * row) and restored after a reload"; Part 8 ui_prefs for the sidebar / groups).
 *
 * Two layers:
 *  1. localStorage — always. The Workspace component saves its own state under `workspaceStorageKey(userId)`; the
 *     OfficeSidebar saves collapsed + open groups under `sidebarStorageKey(userId)` (useStoredState).
 *  2. The server row — through an `OfficePersistence` adapter. `localOnlyPersistence` (no server) is the default; the
 *     frame switches to the T8-DATA server actions (saveWorkspaceTabsAction / saveUiPrefsAction) when they report
 *     available, and falls back to local only when they answer `unavailable` (migration not applied yet).
 *
 * Pure helpers (no React, no server imports) so tests/unit/ods-office-shell.test.ts can cover the restore rules.
 */
import { restoreWorkspace, serializeWorkspace, createWorkspaceState, WORKSPACE_LIMIT, type WorkspaceTab } from '@octopus/ui/workspace-state';

export type PersistedWorkspace = { tabs: WorkspaceTab[]; activeId: string | null; updatedAt?: string | null };
export type OfficePrefs = { sidebarCollapsed?: boolean; groupsCollapsed?: Record<string, boolean> };

/** Where the frame saves. Every method must swallow its own errors (persistence never breaks navigation). */
export interface OfficePersistence {
  readonly kind: 'local' | 'server';
  saveTabs(ws: PersistedWorkspace): Promise<void>;
  savePrefs(patch: OfficePrefs): Promise<void>;
}

/** localStorage only (the Workspace / OfficeSidebar components already write it): the server calls are no-ops. */
export const localOnlyPersistence: OfficePersistence = {
  kind: 'local',
  async saveTabs() {},
  async savePrefs() {},
};

export const workspaceStorageKey = (userId: string) => `ods.office.workspace.${userId}`;
export const sidebarStorageKey = (userId: string) => `ods.office.sidebar.${userId}`;
export const recentStorageKey = (userId: string) => `ods.office.recent.${userId}`;

export const DASHBOARD_TAB_ID = 'dashboard';
export const dashboardTab = (href: string): WorkspaceTab => ({ id: DASHBOARD_TAB_ID, title: 'Dashboard', href, icon: 'dashboard', pinned: true });

const pathOf = (href?: string) => (href ?? '').split(/[?#]/)[0];
export const samePath = (a?: string, b?: string) => {
  const x = pathOf(a).replace(/\/+$/, '') || '/';
  const y = pathOf(b).replace(/\/+$/, '') || '/';
  return x === y;
};

/** A fresh tab id (tabs are not keyed by URL: in-page navigation re-points the current tab). */
export const newTabId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Before the Workspace mounts: decide what it restores.
 *  - local copy wins (it is the newest on this device); else the server copy (new device / cleared storage);
 *  - the pinned Dashboard is always there and points at the person's dashboard (/office or /admin);
 *  - the tab for the URL being loaded is made active (added if missing, within the 12-tab limit by dropping the oldest
 *    unpinned tab), so a reload or a pasted link never jumps to another tab's page.
 * Returns the serialised value to write under the workspace key.
 */
export function prepareWorkspace(
  rawLocal: string | null | undefined,
  server: PersistedWorkspace | null | undefined,
  current: { path: string; href: string; title: string; icon?: string },
  dashboardHref: string,
  makeId: () => string = newTabId,
): string {
  const base = restoreWorkspace(rawLocal) ?? (server?.tabs?.length ? { tabs: server.tabs, activeId: server.activeId } : null);
  const dash = dashboardTab(dashboardHref);
  let tabs: WorkspaceTab[] = (base?.tabs ?? []).filter((t) => t.id !== DASHBOARD_TAB_ID && typeof t.href === 'string' && t.href.startsWith('/'));
  tabs = [dash, ...tabs.map(({ id, title, href, icon, pinned, openedAt }) => ({ id, title, href, icon, pinned, openedAt }))];
  let activeId: string;
  if (samePath(current.path, dashboardHref)) activeId = DASHBOARD_TAB_ID;
  else {
    const hit = tabs.find((t) => samePath(t.href, current.path));
    if (hit) {
      activeId = hit.id;
      tabs = tabs.map((t) => (t.id === hit.id ? { ...t, href: current.href } : t));
    } else {
      while (tabs.length >= WORKSPACE_LIMIT) {
        const victim = tabs.filter((t) => !t.pinned).sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0))[0];
        if (!victim) break;
        tabs = tabs.filter((t) => t.id !== victim.id);
      }
      const id = makeId();
      tabs = [...tabs, { id, title: current.title, href: current.href, icon: current.icon }];
      activeId = id;
    }
  }
  return serializeWorkspace(createWorkspaceState(tabs, { activeId }));
}

/* ───────── recent palette items (Part 7.1: "recent items first") ───────── */

export type RecentEntry = { id: string; group: 'records' | 'actions' | 'goto'; label: string; description?: string; href: string };
export const RECENT_LIMIT = 8;

export function pushRecent(list: RecentEntry[], entry: RecentEntry, limit = RECENT_LIMIT): RecentEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, limit);
}

export function parseRecent(raw: string | null | undefined): RecentEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.filter((e): e is RecentEntry => !!e && typeof e === 'object' && typeof (e as RecentEntry).id === 'string' && typeof (e as RecentEntry).href === 'string' && typeof (e as RecentEntry).label === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
