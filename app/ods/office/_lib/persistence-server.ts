import { saveUiPrefsAction, saveWorkspaceTabsAction } from '../_actions/workspace';
import type { OfficePersistence } from './persistence';

/**
 * ODS T8 · persistence through the T8-DATA server actions (workspace_tabs + ui_prefs rows, migrations 254–256).
 * Used by the frame when the layout's loadWorkspace() reported source 'db'. If an action answers `unavailable`
 * (migration rolled back) or the session is gone, it stops calling the server and the frame keeps localStorage only.
 * Never throws: persistence must not break navigation.
 */
export function createServerPersistence(): OfficePersistence {
  let off = false;
  const guard = async (run: () => Promise<{ ok: boolean; unavailable?: true; code?: string }>) => {
    if (off) return;
    try {
      const r = await run();
      if (!r.ok && (r.unavailable || r.code === 'NOT_SIGNED_IN' || r.code === 'STAFF_ONLY')) off = true;
    } catch {
      /* network / server error: try again next change */
    }
  };
  return {
    kind: 'server',
    saveTabs: (ws) =>
      guard(() =>
        saveWorkspaceTabsAction(
          ws.tabs.filter((t) => typeof t.href === 'string').map((t) => ({ id: t.id, href: t.href as string, title: t.title, icon: t.icon, pinned: t.pinned, openedAt: t.openedAt })),
          ws.activeId,
        ),
      ),
    savePrefs: (patch) => guard(() => saveUiPrefsAction(patch.sidebarCollapsed === undefined ? {} : { sidebarCollapsed: patch.sidebarCollapsed })),
  };
}
