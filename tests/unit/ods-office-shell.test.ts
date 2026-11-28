import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ALL_NAV,
  EXTRA_GOTO,
  NAV_GROUPS,
  appsFor,
  buildOfficeNav,
  currentAppId,
  currentNavId,
  currentSidebarId,
  dashboardHref,
  gotoItems,
  isComfortablePath,
  isDesktopEditingPath,
  isOfficeHref,
  newItemsFor,
  phoneNavCurrent,
  roleLabel,
  type OfficePerms,
} from '../../app/ods/office/_lib/nav';
import { sectionFor, sectionItems } from '../../app/ods/office/_lib/section-nav';
import { cleanQuery, searchableKinds, toPaletteItems } from '../../app/ods/office/_lib/search-core';
import { parseRecent, prepareWorkspace, pushRecent, samePath } from '../../app/ods/office/_lib/persistence';
import { restoreWorkspace } from '../../packages/ui/src/workspace-state';

const base: OfficePerms = {
  isAdmin: false, roles: [], permissions: [], canOpenDropship: false, canSeeRates: false, canSeeFeesDuty: false, canEditDropship: false,
  canSeeSaas: false, warehouseMember: false, dropshipV2Ui: false,
};
const perms = (over: Partial<OfficePerms>): OfficePerms => ({ ...base, ...over });
const visibleIds = (p: OfficePerms) => {
  const n = buildOfficeNav(p);
  return [...n.top, ...n.groups.flatMap((g) => g.items)].filter((i) => !i.hidden).map((i) => i.id);
};

describe('Back Office nav mapping (Part 7.1 → today\'s routes)', () => {
  it('every item points at an existing /office or /admin page (or a top-bar page)', () => {
    const app = join(__dirname, '../../app');
    for (const d of [...ALL_NAV, ...EXTRA_GOTO]) {
      const path = d.href.split(/[?#]/)[0];
      // T9: new ODS-only pages (My work, Approvals, Accounts › Invoices) exist only in the ODS tree (switch off → 404, as today)
      expect(existsSync(join(app, path, 'page.tsx')) || existsSync(join(app, 'ods', path, 'page.tsx')), `${d.id} → ${path}`).toBe(true);
    }
  });

  it('keeps the Part 7.1 group order and ids unique', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Sales', 'Services', 'Accounts', 'Catalogue', 'Website', 'Admin']);
    const ids = [...ALL_NAV, ...EXTRA_GOTO].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('longest prefix wins for the current item; exact items only match themselves', () => {
    expect(currentNavId('/office')).toBe('dashboard');
    expect(currentNavId('/admin')).toBe('my-work');
    expect(currentNavId('/office/orders/123')).toBe('orders');
    expect(currentNavId('/office/warehouse/b2b-shipments')).toBe('shipping');
    expect(currentNavId('/office/warehouse/pick')).toBe('warehouse');
    expect(currentNavId('/admin/finance/saas')).toBe('saas');
    expect(currentNavId('/admin/finance')).toBe('finance');
    expect(currentNavId('/admin/finance/export-something')).toBeUndefined();
    expect(currentNavId('/admin/reports/divisions')).toBe('division-reports');
    expect(currentNavId('/admin/customers/abc')).toBe('customers');
    expect(currentNavId('/admin/notifications')).toBe('notifications');
  });
});

describe('permission filtering (items the role can\'t open are hidden)', () => {
  it('an admin sees every item', () => {
    const all = visibleIds(perms({ isAdmin: true, canOpenDropship: true, canSeeSaas: true }));
    expect(all).toEqual(expect.arrayContaining(ALL_NAV.map((d) => d.id)));
  });

  it('a staff member with no permissions sees only Dashboard → /admin (work queue)', () => {
    const p = perms({ roles: ['support'] });
    expect(visibleIds(p)).toEqual(['dashboard']);
    expect(dashboardHref(p)).toBe('/admin');
    expect(buildOfficeNav(p).top.find((i) => i.id === 'dashboard')?.href).toBe('/admin');
    expect(currentSidebarId('/admin', p)).toBe('dashboard');
  });

  it('follows today\'s OFFICE_NAV areas and StaffShell rules', () => {
    const finance = perms({ roles: ['finance'], permissions: ['finance:view', 'wallet:view', 'dashboard:view'], canSeeSaas: true, canOpenDropship: true });
    const ids = visibleIds(finance);
    expect(ids).toEqual(expect.arrayContaining(['dashboard', 'my-work', 'finance', 'holds', 'credit', 'receivables', 'wallets', 'reports', 'saas', 'currency', 'dropship']));
    expect(ids).not.toContain('bank'); // needs wallet:approve
    expect(ids).not.toContain('payment-settings'); // finance:edit
    expect(ids).not.toContain('customers');
    expect(ids).not.toContain('company'); // admin only

    const manager = perms({ roles: ['account_manager'] });
    expect(visibleIds(manager)).toEqual(expect.arrayContaining(['customers', 'brand', 'approvals']));

    const qc = perms({ roles: ['qc_coordinator'], permissions: ['turnkey_qc:edit'] });
    expect(visibleIds(qc)).toContain('inspections');
    expect(visibleIds(perms({ permissions: ['turnkey_qc:view'] }))).not.toContain('inspections');
  });

  it('palette Go to only lists pages the person may open; G shortcuts are unique', () => {
    const p = perms({ permissions: ['orders:view', 'dashboard:view'] });
    const g = gotoItems(p).map((i) => i.id);
    expect(g).toEqual(expect.arrayContaining(['dashboard', 'orders', 'pools', 'shipping', 'notifications']));
    expect(g).not.toContain('customers');
    const keys = [...ALL_NAV, ...EXTRA_GOTO].map((d) => d.g).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('app switcher and + New follow permissions', () => {
    expect(appsFor(perms({})).map((a) => a.id)).toEqual(['backoffice']);
    expect(appsFor(perms({ permissions: ['finance:view', 'content:view'], warehouseMember: true })).map((a) => a.id)).toEqual(['backoffice', 'accounts', 'warehouse', 'website']);
    expect(currentAppId('/office/warehouse/pick', perms({ warehouseMember: true }))).toBe('warehouse');
    expect(currentAppId('/office/warehouse/pick', perms({}))).toBe('backoffice');
    expect(newItemsFor(perms({})).length).toBe(0);
    expect(newItemsFor(perms({ permissions: ['requests:create', 'finance:approve'] })).map((n) => n.id)).toEqual(['new-quote', 'new-payment']);
    expect(newItemsFor(perms({ isAdmin: true, dropshipV2Ui: true, canOpenDropship: true, canEditDropship: true })).map((n) => n.id)).toContain('new-dropship-product');
  });

  it('counts come from today\'s shell counts', () => {
    const n = buildOfficeNav(perms({ isAdmin: true }), { queue: 3, approvals: 2, transfers: 0, moderation: 5 });
    expect(n.top.find((i) => i.id === 'my-work')?.count).toBe(3);
    expect(n.top.find((i) => i.id === 'approvals')?.count).toBe(2);
    expect(n.groups.flatMap((g) => g.items).find((i) => i.id === 'bank')?.count).toBeUndefined();
    expect(n.groups.flatMap((g) => g.items).find((i) => i.id === 'products')?.count).toBe(5);
  });

  it('role label matches today\'s shell wording', () => {
    expect(roleLabel({ isAdmin: true, roles: ['admin'] })).toBe('Owner');
    expect(roleLabel({ isAdmin: false, roles: ['account_manager', 'support'] })).toBe('Account manager');
    expect(roleLabel({ isAdmin: false, roles: ['sourcing_agent'] })).toBe('Sourcing agent');
  });
});

describe('section menus (today\'s Dropship / Warehouse staff shells)', () => {
  it('Dropship menu only with dropship_v2_ui, Warehouse always', () => {
    expect(sectionFor('/office/dropship/rates', perms({}))).toBeNull();
    expect(sectionFor('/office/dropship/rates', perms({ dropshipV2Ui: true }))).toBe('dropship');
    expect(sectionFor('/admin/finance/saas', perms({ dropshipV2Ui: true }))).toBe('dropship');
    expect(sectionFor('/office/warehouse', perms({}))).toBe('warehouse');
  });
  it('visibility and current item follow the old shells', () => {
    const p = perms({ canOpenDropship: true, dropshipV2Ui: true });
    const items = sectionItems('dropship', '/office/dropship/abc-123', p);
    expect(items.find((i) => i.current)?.label).toBe('Products');
    expect(items.map((i) => i.label)).not.toContain('Shipping rates');
    expect(items.map((i) => i.label)).not.toContain('Fulfilment queue');
    expect(items.map((i) => i.label)).not.toContain('Import products');
    const wh = sectionItems('warehouse', '/office/warehouse/b2b-shipments', perms({}));
    expect(wh.map((i) => i.label)).toEqual(['B2B shipments', 'Client invoices']);
    expect(wh[0].current).toBe(true);
    expect(sectionItems('warehouse', '/office/warehouse', perms({ isAdmin: true })).map((i) => i.label)).toContain('Locations');
  });
});

describe('density and phone rules', () => {
  it('floor screens stay comfortable; editing screens ask for a computer on phones', () => {
    expect(isComfortablePath('/office/warehouse/pick')).toBe(true);
    expect(isComfortablePath('/office/warehouse/receive/ASN-1')).toBe(true);
    expect(isComfortablePath('/office/turnkey/inspect/123')).toBe(true);
    expect(isComfortablePath('/office/warehouse/orders')).toBe(false);
    expect(isDesktopEditingPath('/admin/settings/payment')).toBe(true);
    expect(isDesktopEditingPath('/office/dropship/3f2a')).toBe(true); // product editor
    expect(isDesktopEditingPath('/office/dropship/merchants')).toBe(false);
    expect(isDesktopEditingPath('/admin/approvals')).toBe(false);
    expect(isDesktopEditingPath('/office/warehouse/pick')).toBe(false);
    expect(phoneNavCurrent('/admin/approvals')).toBe('approvals');
    expect(phoneNavCurrent('/office')).toBe('home');
  });
  it('the floor segments in the ODS tree have a comfortable layout', () => {
    for (const pre of ['pick', 'pack', 'multi-parcel', 'putaway', 'counts', 'scale', 'dock', 'receive']) {
      const f = join(__dirname, '../../app/ods/office/warehouse', pre, 'layout.tsx');
      expect(readFileSync(f, 'utf8')).toContain('data-density="comfortable"');
    }
  });
  it('Ctrl-click interception only takes Back Office pages (not CSV / file handlers)', () => {
    expect(isOfficeHref('/office/orders/1')).toBe(true);
    expect(isOfficeHref('/admin/customers?q=x')).toBe(true);
    expect(isOfficeHref('/office/warehouse/reports/csv')).toBe(false);
    expect(isOfficeHref('/admin/finance/export?type=revenue')).toBe(false);
    expect(isOfficeHref('/account')).toBe(false);
    expect(isOfficeHref('https://example.com/office')).toBe(false);
  });
});

describe('palette records', () => {
  it('cleans queries for PostgREST filters', () => {
    expect(cleanQuery('a')).toBe('');
    expect(cleanQuery(' ORD-12, (x) % ')).toBe('ORD-12 x');
  });
  it('searches only what the role may open; actions need the action permission', () => {
    expect(searchableKinds(perms({}))).toEqual([]);
    expect(searchableKinds(perms({ roles: ['account_manager'] }))).toEqual(['customer']);
    const rows = {
      rfq: [{ id: 'r1', code: 'RFQ-1', title: 'Cups', status: 'submitted' }],
      order: [{ id: 'o1', code: 'ORD-1', title: 'Cups', status: 'balance_pending', total_cents: 1000, paid_cents: 300 }],
    };
    const viewer = toPaletteItems(rows, perms({ permissions: ['requests:view', 'orders:view'] }));
    expect(viewer.filter((i) => i.group === 'actions')).toEqual([]);
    const doer = toPaletteItems(rows, perms({ permissions: ['requests:view', 'requests:create', 'orders:view', 'finance:approve'] }));
    expect(doer.filter((i) => i.group === 'actions').map((i) => i.label)).toEqual(['New quote for RFQ-1', 'Record payment for ORD-1']);
  });
});

describe('workspace persistence', () => {
  const cur = (path: string) => ({ path, href: path, title: 'Page' });
  it('adds the loaded URL as the active tab after the pinned Dashboard', () => {
    const out = restoreWorkspace(prepareWorkspace(null, null, cur('/office/orders'), '/office', () => 'n1'))!;
    expect(out.tabs.map((t) => t.id)).toEqual(['dashboard', 'n1']);
    expect(out.activeId).toBe('n1');
  });
  it('re-uses an open tab for the same path and keeps the dashboard active on /office', () => {
    const first = prepareWorkspace(null, null, cur('/office/orders'), '/office', () => 'n1');
    const again = restoreWorkspace(prepareWorkspace(first, null, cur('/office/orders'), '/office', () => 'n2'))!;
    expect(again.tabs.map((t) => t.id)).toEqual(['dashboard', 'n1']);
    const dash = restoreWorkspace(prepareWorkspace(first, null, cur('/office'), '/office'))!;
    expect(dash.activeId).toBe('dashboard');
  });
  it('uses the server copy only when there is no local copy; respects the 12-tab limit', () => {
    const server = { tabs: [{ id: 's1', title: 'Customers', href: '/admin/customers' }], activeId: 's1' };
    const fromServer = restoreWorkspace(prepareWorkspace(null, server, cur('/admin/customers'), '/office'))!;
    expect(fromServer.tabs.map((t) => t.id)).toEqual(['dashboard', 's1']);
    const many = { tabs: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, href: `/office/x${i}`, openedAt: i + 1 })), activeId: 't0' };
    const full = restoreWorkspace(prepareWorkspace(null, many, cur('/office/new'), '/office', () => 'new'))!;
    expect(full.tabs.length).toBe(12);
    expect(full.tabs.map((t) => t.id)).toContain('new');
    expect(full.activeId).toBe('new');
  });
  it('recent items: newest first, de-duplicated, capped', () => {
    let r = pushRecent([], { id: 'a', group: 'goto', label: 'A', href: '/office' });
    r = pushRecent(r, { id: 'b', group: 'records', label: 'B', href: '/office/orders/1' });
    r = pushRecent(r, { id: 'a', group: 'goto', label: 'A', href: '/office' });
    expect(r.map((e) => e.id)).toEqual(['a', 'b']);
    expect(parseRecent(JSON.stringify(r))).toEqual(r);
    expect(parseRecent('nope')).toEqual([]);
    expect(samePath('/office/orders?f=1', '/office/orders/')).toBe(true);
  });
});

describe('static: every one of today\'s staff pages has an ODS re-export', () => {
  const root = join(__dirname, '../..');
  const pages = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name === 'page.tsx' ? [join(dir, e.name)] : []));
  for (const area of ['office', 'admin', 'staff']) {
    it(`app/${area}/** → app/ods/${area}/**`, () => {
      const list = pages(join(root, 'app', area));
      expect(list.length).toBeGreaterThan(0);
      for (const abs of list) {
        const rel = relative(join(root, 'app'), abs);
        const ods = join(root, 'app', 'ods', rel);
        expect(existsSync(ods), rel).toBe(true);
        const src = readFileSync(ods, 'utf8');
        // either a re-export of today's module or a T9 ODS screen that says so
        expect(src.includes(`from '@/app/${rel.replace(/\.tsx$/, '')}'`) || src.includes('ODS T9'), rel).toBe(true);
      }
    });
  }
});
