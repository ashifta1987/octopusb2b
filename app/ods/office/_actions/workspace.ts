'use server';
import { saveUiPrefs, saveWorkspaceTabs } from '@/lib/office/workspace';
import type { OfficeResult, UiPrefs, WorkspaceTab } from '@/lib/office/workspace-core';

/** SHELL: persist the open tabs (debounce on the client; localStorage stays the first copy). */
export async function saveWorkspaceTabsAction(tabs: WorkspaceTab[], activeId: string | null): Promise<OfficeResult<{ updatedAt: string; tabs: WorkspaceTab[] }>> {
  return saveWorkspaceTabs(Array.isArray(tabs) ? tabs : [], typeof activeId === 'string' ? activeId : null);
}

/** SHELL: persist sidebar collapsed / density / collapsed groups / extra. */
export async function saveUiPrefsAction(patch: Partial<UiPrefs>): Promise<OfficeResult<UiPrefs>> {
  return saveUiPrefs(patch && typeof patch === 'object' ? patch : {});
}
