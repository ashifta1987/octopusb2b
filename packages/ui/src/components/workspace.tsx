'use client';

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type Ref } from 'react';
import { ChevronDown, FileText, LayoutDashboard, Plus, X, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { rovingKeyDown, useEscape, useHotkey, useOutsideClick } from '../hooks';
import {
  createWorkspaceState,
  restoreWorkspace,
  serializeWorkspace,
  workspaceReducer,
  WORKSPACE_LIMIT,
  type WorkspaceState,
  type WorkspaceTab,
} from '../workspace-state';
import { Button } from './button';
import { Modal } from './modal';

export type WorkspaceHandle = {
  /** Opens (or focuses) a tab; at the limit the "close the oldest tab?" question appears. */
  open: (tab: WorkspaceTab, opts?: { activate?: boolean }) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
  /** T8: point a tab at another route (title / href / icon) without moving it — in-page navigation in the current tab. */
  update: (id: string, patch: Partial<Pick<WorkspaceTab, 'title' | 'href' | 'icon'>>) => void;
  /** T8: replace the open tabs (e.g. restored from the server's workspace_tabs row on a new device). */
  restore: (state: Pick<WorkspaceState, 'tabs' | 'activeId'>) => void;
  getState: () => WorkspaceState;
};

export type WorkspaceProps = {
  /** First visit (and fallback when nothing is stored). Put the pinned Dashboard first. */
  defaultTabs: WorkspaceTab[];
  defaultActiveId?: string;
  /** localStorage key, e.g. `ods.workspace.${userId}`; open tabs, order, pins and the active tab are restored after a reload. */
  storageKey?: string;
  /** Default 12 (Part 7.1). */
  limit?: number;
  /** Icon per `tab.icon` key; tabs without one show a document icon. */
  icons?: Record<string, LucideIcon>;
  /** The active tab changed (navigate to `tab.href` here). */
  onActivate?: (tab: WorkspaceTab) => void;
  /** "+" — the Back Office opens the command palette. */
  onNewTab?: () => void;
  /** "Save and close" in the unsaved-changes question. Omit to offer only Discard / Cancel. */
  onSave?: (tab: WorkspaceTab) => void | Promise<void>;
  onChange?: (state: WorkspaceState) => void;
  /** Accessible name of the tab list. Default "Open tabs". */
  label?: string;
  /** Global Ctrl+Tab / Ctrl+Shift+Tab / Alt+W. Turn off for a second copy on the same page. Default true. */
  hotkeys?: boolean;
  ref?: Ref<WorkspaceHandle>;
  className?: string;
  'data-testid'?: string;
};

const NEW_W = 44; // "+" button incl. gap
const MORE_W = 104; // "n more ⌄" button incl. gap
const DEFAULT_TAB_W = 170;

/**
 * Workspace (Part 7.1): the Back Office's browser-style tabs, a strip `h-ods-tab` high (36 px compact).
 * - Dashboard is pinned: icon only (accessible name "Dashboard, pinned"), can't be closed. Other tabs: icon + title
 *   (ellipsis, max 210 px) + ✕. Active = white with a 2 px blue top bar (`--ods-tab-bar`).
 * - Unsaved changes: an amber dot replaces ✕ (and the name says "unsaved changes"); closing asks Save and close /
 *   Discard / Cancel. A browser unload warning runs while any tab has unsaved changes.
 * - "+" calls `onNewTab`. Tabs that don't fit go into "n more ⌄" (measured with ResizeObserver): it lists them with ✕,
 *   plus "Close all except pinned" (unsaved tabs stay open). The active tab is always kept visible.
 * - At most `limit` (12) tabs: opening one more asks to close the oldest unpinned tab.
 * - Keyboard pattern (WAI-ARIA tabs, manual activation): the strip is one Tab stop (`role="tablist"`, roving tabindex);
 *   ← → Home End move focus, Enter/Space activates, Delete closes the focused tab, Alt+W closes the active tab,
 *   Ctrl+Tab / Ctrl+Shift+Tab switch tabs (browsers may keep Ctrl+Tab for themselves). The ✕ on each tab is a mouse
 *   shortcut kept out of the tab order and the accessibility tree (a button can't live inside role="tab"); keyboard
 *   and screen-reader users close with Delete / Alt+W, or with the labelled "Close …" buttons in the "more" list.
 * - Persistence: pure reducer in `workspace-state.ts`; `storageKey` saves/restores via localStorage.
 * Phones (< 768): the Back Office on phones has no tabs (Part 7.8 uses the bottom nav); if rendered, the strip shows
 * the active tab and everything else moves into "n more".
 */
export function Workspace({
  defaultTabs,
  defaultActiveId,
  storageKey,
  limit = WORKSPACE_LIMIT,
  icons = {},
  onActivate,
  onNewTab,
  onSave,
  onChange,
  label = 'Open tabs',
  hotkeys = true,
  ref,
  className,
  'data-testid': testId,
}: WorkspaceProps) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () => createWorkspaceState(defaultTabs, { activeId: defaultActiveId, limit }));
  const stateRef = useRef(state);
  const restored = useRef(!storageKey);
  const uid = useId();

  useImperativeHandle(
    ref,
    () => ({
      open: (tab, opts) => dispatch({ type: 'open', tab, activate: opts?.activate }),
      close: (id) => dispatch({ type: 'close', id }),
      activate: (id) => dispatch({ type: 'activate', id }),
      markDirty: (id, dirty) => dispatch({ type: 'markDirty', id, dirty }),
      update: (id, patch) => dispatch({ type: 'update', id, patch }),
      restore: (s) => dispatch({ type: 'restore', state: s }),
      getState: () => stateRef.current,
    }),
    [],
  );

  // restore once, then save on every change
  useEffect(() => {
    if (!storageKey || restored.current) return;
    restored.current = true;
    try {
      const back = restoreWorkspace(localStorage.getItem(storageKey));
      if (back?.tabs.length) {
        const missingPinned = defaultTabs.filter((d) => d.pinned && !back.tabs.some((t) => t.id === d.id));
        dispatch({ type: 'restore', state: { tabs: [...missingPinned, ...back.tabs], activeId: back.activeId } });
      }
    } catch {
      /* storage blocked: keep defaults */
    }
  }, [storageKey, defaultTabs]);

  const lastActive = useRef(state.activeId);
  useEffect(() => {
    stateRef.current = state;
    onChange?.(state);
    if (storageKey && restored.current) {
      try {
        localStorage.setItem(storageKey, serializeWorkspace(state));
      } catch {
        /* ignore */
      }
    }
    if (state.activeId !== lastActive.current) {
      lastActive.current = state.activeId;
      const t = state.tabs.find((x) => x.id === state.activeId);
      if (t) onActivate?.(t);
    }
  }, [state, storageKey, onChange, onActivate]);

  // browser unload guard while anything is unsaved
  const anyDirty = state.tabs.some((t) => t.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [anyDirty]);

  useHotkey(['Ctrl+Tab', 'Ctrl+Shift+Tab'], (e) => dispatch({ type: 'next', delta: e.shiftKey ? -1 : 1 }), { enabled: hotkeys });
  useEffect(() => {
    if (!hotkeys) return;
    // Alt+W by physical key (on a Mac, Option+W types "∑")
    const h = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') {
        e.preventDefault();
        const id = stateRef.current.activeId;
        if (id) dispatch({ type: 'close', id });
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [hotkeys]);

  /* ───────── overflow measurement ───────── */
  const stripRef = useRef<HTMLDivElement>(null);
  const tabEls = useRef(new Map<string, HTMLElement>());
  const widths = useRef(new Map<string, number>());
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    tabEls.current.forEach((el, id) => {
      if (el.offsetWidth) widths.current.set(id, el.offsetWidth);
    });
    const { tabs, activeId } = stateRef.current;
    const w = (id: string) => widths.current.get(id) ?? DEFAULT_TAB_W;
    const total = tabs.reduce((s, t) => s + w(t.id), 0);
    const avail = strip.clientWidth - NEW_W;
    let hidden: string[] = [];
    if (total > avail) {
      let used = activeId ? w(activeId) : 0;
      for (const t of tabs) {
        if (t.id === activeId) continue;
        if (used + w(t.id) <= avail - MORE_W) used += w(t.id);
        else hidden.push(t.id);
      }
      // keep at least the active tab
      if (hidden.length === tabs.length) hidden = tabs.filter((t) => t.id !== activeId).map((t) => t.id);
    }
    setHiddenIds((prev) => (prev.length === hidden.length && prev.every((x, i) => x === hidden[i]) ? prev : hidden));
  }, []);

  useLayoutEffect(() => {
    stateRef.current = state;
    measure();
  }, [state.tabs, state.activeId, measure, state]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(strip);
    return () => ro.disconnect();
  }, [measure]);

  const hiddenSet = new Set(hiddenIds);
  const visible = state.tabs.filter((t) => !hiddenSet.has(t.id));
  const hidden = state.tabs.filter((t) => hiddenSet.has(t.id));

  /* ───────── questions ───────── */
  const pending = state.pending;
  const pendingTab = pending?.kind === 'close-dirty' ? state.tabs.find((t) => t.id === pending.id) : undefined;
  const victim = pending?.kind === 'limit' ? state.tabs.find((t) => t.id === pending.closeId) : undefined;
  const [saving, setSaving] = useState(false);

  const saveAndClose = async () => {
    if (!pendingTab) return;
    setSaving(true);
    try {
      await onSave?.(pendingTab);
      dispatch({ type: 'markDirty', id: pendingTab.id, dirty: false });
      dispatch({ type: 'close', id: pendingTab.id, force: true });
    } finally {
      setSaving(false);
    }
  };

  const iconFor = (t: WorkspaceTab) => (t.icon && icons[t.icon]) || (t.pinned ? LayoutDashboard : FileText);
  const focusActive = () => requestAnimationFrame(() => stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());

  return (
    <div data-testid={testId} className={cx('flex h-ods-tab min-w-0 items-end border-b border-ods-line bg-ods-canvas ps-1', className)}>
      <div ref={stripRef} className="flex h-full min-w-0 flex-1 items-end gap-1">
        <div
          role="tablist"
          aria-label={label}
          className="flex h-full min-w-0 items-end gap-px"
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (e.key === 'Delete' && t.dataset.tabId) {
              e.preventDefault();
              dispatch({ type: 'close', id: t.dataset.tabId });
              return;
            }
            rovingKeyDown(e, { orientation: 'horizontal' });
          }}
        >
          {visible.map((t) => {
            const active = t.id === state.activeId;
            const name = t.pinned ? `${t.title}, pinned` : t.dirty ? `${t.title}, unsaved changes` : t.title;
            return (
              <div
                key={t.id}
                role="presentation"
                ref={(el) => {
                  if (el) tabEls.current.set(t.id, el);
                  else tabEls.current.delete(t.id);
                }}
                className={cx(
                  // shrink-0 (T8 fix): tabs keep their width so the overflow measurement can move extra tabs into "n more"
                  'group relative flex h-[calc(100%-4px)] max-w-[210px] min-w-0 shrink-0 items-center rounded-t-ods-control',
                  active ? 'bg-ods-surface text-ods-navy shadow-ods-card' : 'text-ods-slate hover:bg-ods-surface/70 hover:text-ods-navy',
                )}
              >
                {active ? <span aria-hidden className="absolute inset-x-0 top-0 h-(--ods-tab-bar) rounded-t-ods-control bg-ods-blue" /> : null}
                <button
                  type="button"
                  role="tab"
                  id={`${uid}-${t.id}`}
                  data-roving
                  data-tab-id={t.id}
                  data-testid="workspace-tab"
                  data-dirty={t.dirty ? 'true' : undefined}
                  aria-selected={active}
                  aria-label={t.pinned ? name : undefined}
                  tabIndex={active ? 0 : -1}
                  title={t.title}
                  onClick={() => dispatch({ type: 'activate', id: t.id })}
                  onAuxClick={(e) => {
                    if (e.button === 1 && !t.pinned) dispatch({ type: 'close', id: t.id });
                  }}
                  className={cx(
                    'flex h-full min-w-0 items-center gap-2 rounded-t-ods-control text-ods-small outline-offset-[-3px]',
                    active ? 'font-semibold' : 'font-medium',
                    t.pinned ? 'px-3' : 'ps-3 pe-1',
                  )}
                >
                  <Icon icon={iconFor(t)} />
                  {t.pinned ? null : (
                    <span className="min-w-0 truncate">
                      {t.title}
                      {t.dirty ? <span className="sr-only">, unsaved changes</span> : null}
                    </span>
                  )}
                </button>
                {t.pinned ? null : (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    title={t.dirty ? 'Unsaved changes — close' : 'Close tab'}
                    onClick={() => dispatch({ type: 'close', id: t.id })}
                    className="me-1 inline-grid size-5 shrink-0 place-items-center rounded-[4px] text-ods-slate hover:bg-ods-line hover:text-ods-navy"
                  >
                    {t.dirty ? <span className="size-2 rounded-full bg-ods-warning" /> : <Icon icon={X} size="xs" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {hidden.length ? <MoreTabs tabs={hidden} iconFor={iconFor} dispatchClose={(id) => dispatch({ type: 'close', id })} onActivate={(id) => dispatch({ type: 'activate', id })} onCloseAll={() => dispatch({ type: 'closeAllExceptPinned' })} /> : null}
        <button
          type="button"
          onClick={onNewTab}
          aria-label="New tab"
          title="New tab"
          className="mb-0.5 inline-grid size-[calc(var(--ods-tab-h)-8px)] shrink-0 place-items-center self-center rounded-ods-control text-ods-navy hover:bg-ods-surface"
        >
          <Icon icon={Plus} />
        </button>
      </div>

      <Modal
        open={!!pendingTab}
        onClose={() => {
          dispatch({ type: 'cancelPending' });
          focusActive();
        }}
        title={pendingTab ? `Save changes to “${pendingTab.title}”?` : 'Save changes?'}
        description="This tab has changes that aren't saved yet. If you discard them, they're lost."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => dispatch({ type: 'cancelPending' })}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => dispatch({ type: 'confirmPending' })}>
              Discard changes
            </Button>
            {onSave ? (
              <Button variant="primary" loading={saving} loadingText="Saving…" onClick={saveAndClose}>
                Save and close
              </Button>
            ) : null}
          </>
        }
      />
      <Modal
        open={pending?.kind === 'limit'}
        onClose={() => dispatch({ type: 'cancelPending' })}
        title={`You have ${state.limit} tabs open`}
        description={pending?.kind === 'limit' && victim ? `Close “${victim.title}” (the oldest tab) to open “${pending.tab.title}”?` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => dispatch({ type: 'cancelPending' })}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => dispatch({ type: 'confirmPending' })}>
              Close it and open
            </Button>
          </>
        }
      />
    </div>
  );
}

function MoreTabs({
  tabs,
  iconFor,
  dispatchClose,
  onActivate,
  onCloseAll,
}: {
  tabs: WorkspaceTab[];
  iconFor: (t: WorkspaceTab) => LucideIcon;
  dispatchClose: (id: string) => void;
  onActivate: (id: string) => void;
  onCloseAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restore = true) => {
    setOpen(false);
    if (restore) btn.current?.focus();
  };
  useEscape(open, () => close());
  useOutsideClick([btn, panel], open, () => close(false));
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  return (
    <div className="relative mb-0.5 shrink-0 self-center">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="flex h-[calc(var(--ods-tab-h)-8px)] items-center gap-1 rounded-ods-control px-2 text-ods-small font-semibold text-ods-navy hover:bg-ods-surface"
      >
        {tabs.length} more <Icon icon={ChevronDown} size="xs" />
        <span className="sr-only"> tabs</span>
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="group"
          aria-label="More open tabs"
          className="absolute end-0 top-full z-(--z-dropdown) mt-1 w-72 max-w-[calc(100vw-16px)] rounded-ods-control border border-ods-line bg-ods-surface py-1 shadow-ods-pop"
          onKeyDown={(e) => rovingKeyDown(e, { orientation: 'vertical' })}
        >
          <ul className="max-h-80 overflow-y-auto">
            {tabs.map((t) => (
              <li key={t.id} className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  data-roving
                  onClick={() => {
                    onActivate(t.id);
                    setOpen(false);
                  }}
                  className="flex min-h-ods-control min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 text-start text-ods-body hover:bg-ods-blue-tint"
                >
                  <Icon icon={iconFor(t)} className="text-ods-slate" />
                  <span className="truncate">{t.title}</span>
                  {t.dirty ? (
                    <span className="ms-auto flex shrink-0 items-center gap-1 text-ods-small text-ods-warning">
                      <span aria-hidden className="size-2 rounded-full bg-ods-warning" /> Unsaved
                    </span>
                  ) : null}
                </button>
                {t.pinned ? null : (
                  <button
                    type="button"
                    data-roving
                    aria-label={`Close ${t.title}`}
                    onClick={() => dispatchClose(t.id)}
                    className="inline-grid size-ods-control shrink-0 place-items-center rounded-[4px] text-ods-slate hover:bg-ods-line hover:text-ods-navy"
                  >
                    <Icon icon={X} size="xs" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-ods-line px-1 pt-1">
            <button
              type="button"
              data-roving
              onClick={() => {
                onCloseAll();
                close();
              }}
              className="flex min-h-ods-control w-full items-center rounded-[4px] px-2 text-start text-ods-body font-medium text-ods-navy hover:bg-ods-blue-tint"
            >
              Close all except pinned
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
