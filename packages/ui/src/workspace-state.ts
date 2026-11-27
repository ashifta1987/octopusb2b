/**
 * Workspace tabs state (Part 7.1) — pure, server-safe (no 'use client'), unit-tested in tests/unit/ods-data.test.ts.
 *
 * The Back Office opens records in browser-style tabs. Every tab is a real route (`href`); this reducer only keeps the
 * list, order, pins, the active tab and the unsaved-changes flags, plus the two questions the UI must ask:
 *  - closing a tab with unsaved changes → `pending: { kind: 'close-dirty' }` (Save and close / Discard / Cancel);
 *  - opening a tab when `limit` (12) are open → `pending: { kind: 'limit' }` (close the oldest unpinned tab?).
 * Persistence foundation: `serializeWorkspace` / `restoreWorkspace` (localStorage today; a `workspace_tabs` row later).
 */

export type WorkspaceTab = {
  id: string;
  title: string;
  /** The route this tab shows (each tab is a real route). */
  href?: string;
  /** Key into the Workspace `icons` map (icons are components, so the state stores a key that survives JSON). */
  icon?: string;
  pinned?: boolean;
  /** Unsaved changes: the ✕ becomes an amber dot and closing asks first. Never persisted. */
  dirty?: boolean;
  /** Open order (set by the reducer); the oldest unpinned tab is the one with the smallest value. */
  openedAt?: number;
};

export type WorkspacePending =
  | { kind: 'close-dirty'; id: string }
  | { kind: 'limit'; tab: WorkspaceTab; closeId: string };

export type WorkspaceState = {
  tabs: WorkspaceTab[];
  activeId: string | null;
  limit: number;
  /** A question the UI must ask before the action can finish (rendered as a Modal). */
  pending: WorkspacePending | null;
  /** Monotonic counter for `openedAt`. */
  seq: number;
};

export type WorkspaceAction =
  | { type: 'open'; tab: WorkspaceTab; activate?: boolean }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string; force?: boolean }
  | { type: 'closeAllExceptPinned' }
  | { type: 'pin'; id: string; pinned: boolean }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'markDirty'; id: string; dirty: boolean }
  | { type: 'rename'; id: string; title: string }
  | { type: 'next'; delta?: 1 | -1 }
  | { type: 'confirmPending' }
  | { type: 'cancelPending' }
  | { type: 'restore'; state: Pick<WorkspaceState, 'tabs' | 'activeId'> };

export const WORKSPACE_LIMIT = 12;

/** Pinned tabs always come first, in their own order. */
function sortPinnedFirst(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

export function createWorkspaceState(tabs: WorkspaceTab[] = [], opts: { activeId?: string | null; limit?: number } = {}): WorkspaceState {
  let seq = 0;
  const withSeq = sortPinnedFirst(tabs.map((t) => ({ ...t, openedAt: t.openedAt ?? ++seq })));
  seq = Math.max(seq, ...withSeq.map((t) => t.openedAt ?? 0), 0);
  const activeId = opts.activeId != null && withSeq.some((t) => t.id === opts.activeId) ? opts.activeId : (withSeq[0]?.id ?? null);
  return { tabs: withSeq, activeId, limit: opts.limit ?? WORKSPACE_LIMIT, pending: null, seq };
}

/** The tab the limit question offers to close: the oldest unpinned tab without unsaved changes (else the oldest unpinned). */
export function oldestUnpinned(tabs: WorkspaceTab[]): WorkspaceTab | undefined {
  const unpinned = tabs.filter((t) => !t.pinned).sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
  return unpinned.find((t) => !t.dirty) ?? unpinned[0];
}

/** After removing the active tab, activate its right neighbour, else the left one. */
function neighbourAfterRemoval(tabs: WorkspaceTab[], removedId: string, activeId: string | null): string | null {
  if (activeId !== removedId) return activeId;
  const i = tabs.findIndex((t) => t.id === removedId);
  const rest = tabs.filter((t) => t.id !== removedId);
  if (!rest.length) return null;
  return (rest[i] ?? rest[i - 1] ?? rest[0]).id;
}

function removeTab(state: WorkspaceState, id: string): WorkspaceState {
  return { ...state, tabs: state.tabs.filter((t) => t.id !== id), activeId: neighbourAfterRemoval(state.tabs, id, state.activeId), pending: null };
}

function addTab(state: WorkspaceState, tab: WorkspaceTab, activate: boolean): WorkspaceState {
  const seq = state.seq + 1;
  const tabs = sortPinnedFirst([...state.tabs, { ...tab, openedAt: seq }]);
  return { ...state, tabs, seq, activeId: activate || !state.activeId ? tab.id : state.activeId, pending: null };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'open': {
      const activate = action.activate ?? true;
      const existing = state.tabs.find((t) => t.id === action.tab.id);
      if (existing) return activate ? { ...state, activeId: existing.id } : state;
      if (state.tabs.length >= state.limit) {
        const victim = oldestUnpinned(state.tabs);
        if (!victim) return state; // everything pinned: nothing can be closed
        return { ...state, pending: { kind: 'limit', tab: action.tab, closeId: victim.id } };
      }
      return addTab(state, action.tab, activate);
    }
    case 'activate':
      return state.tabs.some((t) => t.id === action.id) ? { ...state, activeId: action.id } : state;
    case 'close': {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab || tab.pinned) return state;
      if (tab.dirty && !action.force) return { ...state, pending: { kind: 'close-dirty', id: tab.id } };
      return removeTab(state, tab.id);
    }
    case 'closeAllExceptPinned': {
      // Tabs with unsaved changes stay open (nothing is lost silently); the user closes them one by one.
      const keep = state.tabs.filter((t) => t.pinned || t.dirty);
      const activeId = keep.some((t) => t.id === state.activeId) ? state.activeId : (keep[0]?.id ?? null);
      return { ...state, tabs: keep, activeId, pending: null };
    }
    case 'pin':
      return { ...state, tabs: sortPinnedFirst(state.tabs.map((t) => (t.id === action.id ? { ...t, pinned: action.pinned } : t))) };
    case 'reorder': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...state, tabs: sortPinnedFirst(tabs) };
    }
    case 'markDirty':
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, dirty: action.dirty } : t)) };
    case 'rename':
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, title: action.title } : t)) };
    case 'next': {
      if (!state.tabs.length) return state;
      const i = Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId));
      const n = state.tabs.length;
      return { ...state, activeId: state.tabs[(i + (action.delta ?? 1) + n) % n].id };
    }
    case 'confirmPending': {
      const p = state.pending;
      if (!p) return state;
      if (p.kind === 'close-dirty') return removeTab(state, p.id);
      return addTab(removeTab(state, p.closeId), p.tab, true);
    }
    case 'cancelPending':
      return state.pending ? { ...state, pending: null } : state;
    case 'restore':
      return createWorkspaceState(action.state.tabs, { activeId: action.state.activeId, limit: state.limit });
    default:
      return state;
  }
}

/** What goes to storage: tabs (without unsaved flags) + the active tab. */
export function serializeWorkspace(state: WorkspaceState): string {
  return JSON.stringify({
    v: 1,
    activeId: state.activeId,
    tabs: state.tabs.map(({ id, title, href, icon, pinned, openedAt }) => ({ id, title, href, icon, pinned, openedAt })),
  });
}

/** Parses stored tabs; returns null when the value is missing or not a valid workspace. */
export function restoreWorkspace(raw: string | null | undefined): Pick<WorkspaceState, 'tabs' | 'activeId'> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: number; activeId?: unknown; tabs?: unknown };
    if (v?.v !== 1 || !Array.isArray(v.tabs)) return null;
    const tabs = v.tabs.filter(
      (t): t is WorkspaceTab => !!t && typeof t === 'object' && typeof (t as WorkspaceTab).id === 'string' && typeof (t as WorkspaceTab).title === 'string',
    );
    return { tabs, activeId: typeof v.activeId === 'string' ? v.activeId : null };
  } catch {
    return null;
  }
}
