import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_TAB, DEFAULT_PREFS, MAX_OPEN_TABS, activeOrDashboard, approvalFromRow, clientIpFrom, decideCall, errorCode, isAppPath,
  isMissingObjectError, mergePrefs, normalizeTabs, notificationFromRow, officeFail, oldestUnpinned, prefsFromRow, prefsPatchPayload,
  sortViews, viewFromRow, viewPageKey, type SavedView, type WorkspaceTab,
} from '@/lib/office/workspace-core';

const tab = (i: number, extra: Partial<WorkspaceTab> = {}): WorkspaceTab => ({ id: `t${i}`, href: `/office/orders/ORD-${i}`, title: `Order ${i}`, openedAt: i, ...extra });

describe('ODS office data: workspace tabs', () => {
  it('always puts the pinned Dashboard first', () => {
    const t = normalizeTabs([tab(1)]);
    expect(t[0]).toEqual(DASHBOARD_TAB);
    expect(t.map((x) => x.id)).toEqual(['dashboard', 't1']);
  });
  it('drops bad tabs: outside / protocol-relative / backslash links, missing title, duplicates, a second dashboard', () => {
    const t = normalizeTabs([
      tab(1), tab(1), { id: 'x', href: 'https://evil.example', title: 'x' }, { id: 'y', href: '//evil', title: 'y' },
      { id: 'z', href: '/\\evil', title: 'z' }, { id: 'n', href: '/office', title: '' }, { id: 'dashboard', href: '/office', title: 'Dash' }, 42, null,
    ]);
    expect(t.map((x) => x.id)).toEqual(['dashboard', 't1']);
  });
  it('keeps at most 12 besides the Dashboard, closing the oldest unpinned first', () => {
    const many = Array.from({ length: 15 }, (_, i) => tab(i + 1, i === 0 ? { pinned: true } : {}));
    const t = normalizeTabs(many);
    expect(t).toHaveLength(MAX_OPEN_TABS + 1);
    expect(t.some((x) => x.id === 't1')).toBe(true); // pinned kept although oldest
    expect(t.some((x) => x.id === 't2' || x.id === 't3' || x.id === 't4')).toBe(false);
    expect(t.at(-1)?.id).toBe('t15');
  });
  it('caps sizes and keeps only known fields', () => {
    const [, t] = normalizeTabs([{ id: 'a', href: '/office/x', title: 'T'.repeat(300), scrollY: 12.7, filters: { q: 'x' }, evil: 1 }]);
    expect(t.title).toHaveLength(200);
    expect(t.scrollY).toBe(13);
    expect(t.filters).toEqual({ q: 'x' });
    expect('evil' in t).toBe(false);
  });
  it('oldestUnpinned / activeOrDashboard', () => {
    expect(oldestUnpinned([DASHBOARD_TAB, tab(5), tab(2), tab(3, { pinned: true })])?.id).toBe('t2');
    expect(oldestUnpinned([DASHBOARD_TAB])).toBeNull();
    expect(activeOrDashboard([DASHBOARD_TAB, tab(1)], 't1')).toBe('t1');
    expect(activeOrDashboard([DASHBOARD_TAB], 'gone')).toBe('dashboard');
  });
  it('isAppPath', () => {
    expect(isAppPath('/office')).toBe(true);
    expect(isAppPath('/')).toBe(true);
    for (const bad of ['office', '//x', '/\\x', 'javascript:alert(1)', '/a\nb', 5]) expect(isAppPath(bad)).toBe(false);
  });
});

describe('ODS office data: UI prefs', () => {
  it('reads a row and fills defaults', () => {
    expect(prefsFromRow(null)).toEqual(DEFAULT_PREFS);
    expect(prefsFromRow({ sidebar_collapsed: true, density_override: 'compact', groups_collapsed: ['accounts', 3], extra: { a: 1 } }))
      .toEqual({ sidebarCollapsed: true, density: 'compact', groupsCollapsed: ['accounts'], extra: { a: 1 } });
    expect(prefsFromRow({ density_override: 'huge' }).density).toBeNull();
  });
  it('builds the patch payload with only the keys given', () => {
    expect(prefsPatchPayload({ sidebarCollapsed: true })).toEqual({ sidebar_collapsed: true });
    expect(prefsPatchPayload({ density: null, groupsCollapsed: ['a', 'a', ''] })).toEqual({ density_override: null, groups_collapsed: ['a'] });
  });
  it('merges like the server (null removes an extra key)', () => {
    const m = mergePrefs({ ...DEFAULT_PREFS, extra: { a: 1, b: 2 } }, { extra: { a: null, c: 3 }, density: 'comfortable' });
    expect(m).toEqual({ sidebarCollapsed: false, density: 'comfortable', groupsCollapsed: [], extra: { b: 2, c: 3 } });
  });
});

describe('ODS office data: saved views', () => {
  it('page key from a pathname', () => {
    expect(viewPageKey('/office/accounts/invoices?tab=overdue')).toBe('/office/accounts/invoices');
    expect(viewPageKey('/Office/Accounts/')).toBe('/office/accounts');
    expect(viewPageKey('/office/x y')).toBe('/office');
  });
  it('maps rows and sorts mine (default first) before shared', () => {
    const rows = [
      { id: '1', user_id: 'other', scope: 'shared', page: '/p', name: 'A shared', shared_role: 'finance', filters: {}, columns: ['a', 1], sort: [], is_default: false, updated_at: 'x' },
      { id: '2', user_id: 'me', scope: 'personal', page: '/p', name: 'Z mine', filters: {}, columns: [], sort: [], is_default: true, updated_at: 'x' },
      { id: '3', user_id: 'me', scope: 'personal', page: '/p', name: 'B mine', filters: {}, columns: [], sort: [], is_default: false, updated_at: 'x' },
    ];
    const v: SavedView[] = sortViews(rows.map((r) => viewFromRow(r, 'me')));
    expect(v.map((x) => x.id)).toEqual(['2', '3', '1']);
    expect(v[2]).toMatchObject({ mine: false, scope: 'shared', sharedRole: 'finance', columns: ['a'] });
  });
});

describe('ODS office data: errors', () => {
  it('detects a migration that is not applied', () => {
    expect(isMissingObjectError({ code: '42P01', message: 'relation "public.workspace_tabs" does not exist' })).toBe(true);
    expect(isMissingObjectError({ code: 'PGRST202', message: 'Could not find the function public.save_view in the schema cache' })).toBe(true);
    expect(isMissingObjectError({ message: 'function public.staff_notifications_list(integer, boolean) does not exist' })).toBe(true);
    expect(isMissingObjectError({ code: 'P0001', message: 'FORBIDDEN' })).toBe(false);
    expect(officeFail({ code: '42P01', message: 'relation "saved_views" does not exist' })).toMatchObject({ ok: false, unavailable: true });
  });
  it('friendly messages by code', () => {
    expect(officeFail({ message: 'MAKER_CANNOT_APPROVE: a different person must decide what you recorded' })).toMatchObject({ code: 'MAKER_CANNOT_APPROVE', error: expect.stringMatching(/different person/) });
    expect(officeFail({ message: 'VIEW_NAME_TAKEN: you already have a view called "x" on this page' })).toMatchObject({ code: 'VIEW_NAME_TAKEN', error: 'You already have a view called "x" on this page' });
    expect(officeFail('STAFF_ONLY')).toMatchObject({ code: 'STAFF_ONLY' });
    expect(officeFail({ message: 'new row violates row-level security policy' })).toMatchObject({ code: 'FORBIDDEN' });
    expect(errorCode({ message: 'INVALID_INPUT: tabs must be a list' })).toBe('INVALID_INPUT');
  });
  it('step-up errors carry the verify redirect back to the page', () => {
    const r = officeFail({ message: 'STEP_UP_REQUIRED' }, '/office/approvals');
    expect(r).toMatchObject({ ok: false, code: 'STEP_UP_REQUIRED', redirect: '/staff/verify?next=%2Foffice%2Fapprovals&reason=step_up' });
  });
});

describe('ODS office data: approvals', () => {
  it('routes each source to its decide function (existing ones unchanged)', () => {
    expect(decideCall('staff_approvals', 'a', true, ' ok ', '1.2.3.4')).toEqual({ fn: 'staff_approval_decide', args: { p_id: 'a', p_approve: true, p_note: 'ok', p_ip: '1.2.3.4' } });
    expect(decideCall('finance_approvals', 'b', false, 'nope', null)).toEqual({ fn: 'decide_finance_approval', args: { p_id: 'b', p_approve: false, p_note: 'nope' } });
    expect(decideCall('escrow_hold_approvals', 'c', true, '', null)).toEqual({ fn: 'decide_escrow_hold_approval', args: { p_approval_id: 'c', p_approve: true, p_note: null } });
    expect(decideCall('customer_credit_terms', 'd', true, null, null)).toEqual({ fn: 'decide_customer_credit_terms', args: { p_terms_id: 'd', p_approve: true, p_note: null } });
  });
  it('maps queue rows', () => {
    const a = approvalFromRow({ source: 'finance_approvals', id: 'x', code: null, kind: 'refund', status: 'waiting', amount_minor: '280000', currency: 'USD',
      reason: 'r', requested_by: 'me', requested_at: 't', can_decide: false }, 'me');
    expect(a).toMatchObject({ source: 'finance_approvals', amountMinor: 280000, mine: true, canDecide: false, status: 'waiting' });
    expect(approvalFromRow({ source: 'nope', status: 'odd' }, null)).toMatchObject({ source: 'staff_approvals', status: 'waiting', mine: false });
  });
  it('client IP from forwarding headers', () => {
    expect(clientIpFrom('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIpFrom(null, '2001:db8::1')).toBe('2001:db8::1');
    expect(clientIpFrom('999.1.1.1')).toBeNull();
    expect(clientIpFrom('evil<script>')).toBeNull();
    expect(clientIpFrom(undefined)).toBeNull();
  });
});

describe('ODS office data: notifications', () => {
  it('maps rows and drops unsafe links', () => {
    expect(notificationFromRow({ id: '1', kind: 'approval.waiting', title: 'T', link: '/office/approvals?item=1', for_role: 'finance', created_at: 'c' }))
      .toMatchObject({ link: '/office/approvals?item=1', forRole: 'finance', readAt: null });
    expect(notificationFromRow({ id: '2', link: 'https://evil.example' }).link).toBeNull();
  });
});
