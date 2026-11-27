import { describe, expect, it } from 'vitest';
import {
  createWorkspaceState,
  oldestUnpinned,
  restoreWorkspace,
  serializeWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceTab,
} from '../../packages/ui/src/workspace-state';
import {
  clampGridPage,
  clampGridWidth,
  filterGridRows,
  gridHeaderCheck,
  gridPageCount,
  gridPageRange,
  nextGridSort,
  orderMenuItems,
  paginateGridRows,
  sortGridRows,
  toggleGridAll,
  toggleGridRow,
  type GridCellValue,
} from '../../packages/ui/src/grid-state';

const dash: WorkspaceTab = { id: 'dash', title: 'Dashboard', pinned: true };
const tab = (n: number): WorkspaceTab => ({ id: `t${n}`, title: `Tab ${n}`, href: `/office/t${n}` });
const run = (s: WorkspaceState, ...actions: WorkspaceAction[]) => actions.reduce(workspaceReducer, s);

describe('workspace reducer', () => {
  it('keeps pinned tabs first and refuses to close them', () => {
    let s = createWorkspaceState([tab(1), dash]);
    expect(s.tabs.map((t) => t.id)).toEqual(['dash', 't1']);
    s = run(s, { type: 'close', id: 'dash' });
    expect(s.tabs).toHaveLength(2);
    s = run(s, { type: 'pin', id: 't1', pinned: true }, { type: 'open', tab: tab(2) }, { type: 'reorder', from: 2, to: 0 });
    expect(s.tabs.map((t) => t.id)).toEqual(['dash', 't1', 't2']);
  });

  it('opens, activates existing tabs and activates the neighbour on close', () => {
    let s = createWorkspaceState([dash]);
    s = run(s, { type: 'open', tab: tab(1) }, { type: 'open', tab: tab(2) }, { type: 'open', tab: tab(3) });
    expect(s.activeId).toBe('t3');
    s = run(s, { type: 'open', tab: tab(1) });
    expect(s.activeId).toBe('t1');
    expect(s.tabs).toHaveLength(4);
    s = run(s, { type: 'close', id: 't1' });
    expect(s.activeId).toBe('t2');
    s = run(s, { type: 'activate', id: 't3' }, { type: 'close', id: 't3' });
    expect(s.activeId).toBe('t2');
  });

  it('asks before closing a tab with unsaved changes', () => {
    let s = run(createWorkspaceState([dash, tab(1)]), { type: 'markDirty', id: 't1', dirty: true }, { type: 'close', id: 't1' });
    expect(s.pending).toEqual({ kind: 'close-dirty', id: 't1' });
    expect(s.tabs).toHaveLength(2);
    s = run(s, { type: 'cancelPending' });
    expect(s.pending).toBeNull();
    expect(s.tabs).toHaveLength(2);
    s = run(s, { type: 'close', id: 't1' }, { type: 'confirmPending' });
    expect(s.tabs.map((t) => t.id)).toEqual(['dash']);
    s = run(s, { type: 'open', tab: { ...tab(2), dirty: true } }, { type: 'close', id: 't2', force: true });
    expect(s.tabs).toHaveLength(1);
  });

  it('limit 12: opening the 13th asks to close the oldest unpinned tab', () => {
    let s = createWorkspaceState([dash]);
    for (let i = 1; i <= 11; i++) s = run(s, { type: 'open', tab: tab(i) });
    expect(s.tabs).toHaveLength(12);
    s = run(s, { type: 'open', tab: tab(13) });
    expect(s.tabs).toHaveLength(12);
    expect(s.pending).toMatchObject({ kind: 'limit', closeId: 't1', tab: { id: 't13' } });
    s = run(s, { type: 'cancelPending' });
    expect(s.tabs.some((t) => t.id === 't13')).toBe(false);
    s = run(s, { type: 'open', tab: tab(13) }, { type: 'confirmPending' });
    expect(s.tabs).toHaveLength(12);
    expect(s.tabs.some((t) => t.id === 't1')).toBe(false);
    expect(s.activeId).toBe('t13');
  });

  it('oldest unpinned prefers tabs without unsaved changes', () => {
    const s = run(createWorkspaceState([dash, tab(1), tab(2)]), { type: 'markDirty', id: 't1', dirty: true });
    expect(oldestUnpinned(s.tabs)?.id).toBe('t2');
  });

  it('close all except pinned keeps pinned and unsaved tabs; next tab cycles', () => {
    let s = run(createWorkspaceState([dash, tab(1), tab(2), tab(3)]), { type: 'markDirty', id: 't2', dirty: true }, { type: 'activate', id: 't3' });
    s = run(s, { type: 'next' });
    expect(s.activeId).toBe('dash');
    s = run(s, { type: 'next', delta: -1 });
    expect(s.activeId).toBe('t3');
    s = run(s, { type: 'closeAllExceptPinned' });
    expect(s.tabs.map((t) => t.id)).toEqual(['dash', 't2']);
    expect(s.activeId).toBe('dash');
  });

  it('serialises without unsaved flags and restores', () => {
    const s = run(createWorkspaceState([dash, tab(1)]), { type: 'markDirty', id: 't1', dirty: true });
    const raw = serializeWorkspace(s);
    expect(raw).not.toContain('dirty');
    const back = restoreWorkspace(raw);
    expect(back?.tabs.map((t) => t.id)).toEqual(['dash', 't1']);
    expect(back?.activeId).toBe('dash');
    expect(restoreWorkspace('nonsense')).toBeNull();
    expect(restoreWorkspace(JSON.stringify({ v: 2, tabs: [] }))).toBeNull();
    const r = run(createWorkspaceState([]), { type: 'restore', state: back! });
    expect(r.tabs[0].pinned).toBe(true);
  });
});

type Row = { id: string; n: string; amount: number | null; due: Date };
const rows: Row[] = [
  { id: 'a', n: 'INV-10', amount: 50, due: new Date('2026-11-02') },
  { id: 'b', n: 'INV-9', amount: null, due: new Date('2026-10-01') },
  { id: 'c', n: 'INV-100', amount: 10, due: new Date('2026-12-01') },
];
const get = (r: Row, id: string) => r[id as keyof Row] as GridCellValue;

describe('grid helpers', () => {
  it('sort cycle and stable sort with empty values last', () => {
    expect(nextGridSort(null, 'n')).toEqual({ id: 'n', desc: false });
    expect(nextGridSort({ id: 'n', desc: false }, 'n')).toEqual({ id: 'n', desc: true });
    expect(nextGridSort({ id: 'n', desc: true }, 'n')).toBeNull();
    expect(nextGridSort({ id: 'n', desc: true }, 'amount')).toEqual({ id: 'amount', desc: false });
    expect(sortGridRows(rows, { id: 'n', desc: false }, get).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortGridRows(rows, { id: 'amount', desc: false }, get).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortGridRows(rows, { id: 'amount', desc: true }, get).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortGridRows(rows, { id: 'due', desc: false }, get).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortGridRows(rows, null, get)).toEqual(rows);
  });

  it('filters and paginates', () => {
    expect(filterGridRows(rows, ' inv-1', (r) => r.n).map((r) => r.id)).toEqual(['a', 'c']);
    const many = Array.from({ length: 312 }, (_, i) => i);
    expect(gridPageCount(312, 25)).toBe(13);
    expect(gridPageCount(0, 25)).toBe(1);
    expect(clampGridPage(99, 312, 25)).toBe(12);
    expect(paginateGridRows(many, 12, 25)).toHaveLength(12);
    expect(gridPageRange(0, 25, 312)).toEqual({ from: 1, to: 25, total: 312 });
    expect(gridPageRange(12, 25, 312)).toEqual({ from: 301, to: 312, total: 312 });
    expect(gridPageRange(0, 25, 0)).toEqual({ from: 0, to: 0, total: 0 });
    expect(clampGridWidth(10)).toBe(64);
    expect(clampGridWidth(1000, 64, 400)).toBe(400);
  });

  it('selection helpers', () => {
    const sel = new Set(['a']);
    expect(gridHeaderCheck(['a', 'b'], sel)).toBe('some');
    expect(gridHeaderCheck([], sel)).toBe('none');
    const all = toggleGridAll(['a', 'b'], sel);
    expect([...all].sort()).toEqual(['a', 'b']);
    expect(gridHeaderCheck(['a', 'b'], all)).toBe('all');
    expect(toggleGridAll(['a', 'b'], new Set(['a', 'b', 'z']))).toEqual(new Set(['z']));
    expect(toggleGridRow(sel, 'a').size).toBe(0);
  });

  it('context menu puts destructive items last after one separator', () => {
    const items = [
      { id: 'del', label: 'Cancel invoice', destructive: true },
      { id: 's0', separator: true },
      { id: 'open', label: 'Open' },
      { id: 's1', separator: true },
      { id: 'copy', label: 'Copy number' },
      { id: 's2', separator: true },
    ];
    expect(orderMenuItems(items).map((i) => i.id)).toEqual(['open', 's1', 'copy', '__danger-sep', 'del']);
  });
});
