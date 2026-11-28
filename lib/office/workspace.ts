import 'server-only';
import { officeCtx } from '@/lib/office/server';
import {
  activeOrDashboard, DEFAULT_PREFS, isMissingObjectError, normalizeTabs, officeFail, okResult, prefsFromRow, prefsPatchPayload,
  type OfficeResult, type UiPrefs, type WorkspaceState, type WorkspaceTab,
} from '@/lib/office/workspace-core';

export type { WorkspaceState, WorkspaceTab, UiPrefs } from '@/lib/office/workspace-core';

const LOCAL_ONLY: WorkspaceState = { tabs: normalizeTabs([]), activeId: 'dashboard', prefs: { ...DEFAULT_PREFS }, source: 'local-only', updatedAt: null };

/**
 * Open tabs + UI prefs of the signed-in staff member (Part 7.1 persistence). Never throws: without a staff session, or before
 * migration 254 is applied, it returns source 'local-only' and the shell keeps its localStorage copy.
 * The SHELL merges: the newer of (localStorage.updatedAt, this.updatedAt) wins.
 */
export async function loadWorkspace(): Promise<WorkspaceState> {
  try {
    const c = await officeCtx();
    if ('fail' in c) return LOCAL_ONLY;
    const [tabsRes, prefsRes] = await Promise.all([
      c.sb.from('workspace_tabs').select('tabs, active_id, updated_at').eq('user_id', c.s.userId).maybeSingle(),
      c.sb.from('ui_prefs').select('sidebar_collapsed, density_override, groups_collapsed, extra, updated_at').eq('user_id', c.s.userId).maybeSingle(),
    ]);
    if (isMissingObjectError(tabsRes.error) || isMissingObjectError(prefsRes.error)) return LOCAL_ONLY;
    if (tabsRes.error || prefsRes.error) return LOCAL_ONLY;
    const tabs = normalizeTabs(tabsRes.data?.tabs ?? []);
    return {
      tabs,
      activeId: activeOrDashboard(tabs, tabsRes.data?.active_id as string | null),
      prefs: prefsFromRow(prefsRes.data),
      source: 'db',
      updatedAt: (tabsRes.data?.updated_at as string | undefined) ?? null,
    };
  } catch {
    return LOCAL_ONLY;
  }
}

/** Saves the open tabs (normalised first: Dashboard pinned, ≤ 12 others, app paths only). */
export async function saveWorkspaceTabs(tabs: WorkspaceTab[], activeId: string | null): Promise<OfficeResult<{ updatedAt: string; tabs: WorkspaceTab[] }>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const clean = normalizeTabs(tabs);
  const active = activeOrDashboard(clean, activeId);
  const { data, error } = await c.sb.rpc('save_workspace_tabs', { p_tabs: clean, p_active: active });
  if (error) return officeFail(error);
  return okResult({ updatedAt: String(data), tabs: clean });
}

/** Saves a UI prefs patch; returns the merged prefs. */
export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<OfficeResult<UiPrefs>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.rpc('save_ui_prefs', { p_patch: prefsPatchPayload(patch) });
  if (error) return officeFail(error);
  return okResult(prefsFromRow(data));
}
