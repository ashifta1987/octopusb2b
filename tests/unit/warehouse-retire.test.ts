import { describe, expect, it } from 'vitest';
import {
  B2B_SHIPMENTS_PATH, WH_DROPSHIP_ORDERS_PATH, WH_PACK_PATH,
  b2bShippingAccess, classifyPackRef, dropshipQueueTarget, packFallback, packTargetFromMatches, whOrderPath,
} from '@/lib/warehouse-retire';
import { OFFICE_NAV, CUSTOMER_NAV } from '@/lib/nav';
import { WORKSPACES } from '@/lib/staff/workspaces';

const ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('W7 retired route targets', () => {
  it('/office/dropship/queue goes to Dropship orders, ?status=packing to the packing station', () => {
    expect(dropshipQueueTarget({})).toBe(WH_DROPSHIP_ORDERS_PATH);
    expect(dropshipQueueTarget({ status: 'packing' })).toBe(WH_PACK_PATH);
    expect(dropshipQueueTarget({ status: 'other' })).toBe(WH_DROPSHIP_ORDERS_PATH);
  });

  it('classifies /office/dropship/pack/[order] references', () => {
    expect(classifyPackRef('wo-000123')).toEqual({ kind: 'wo', code: 'WO-000123' });
    expect(classifyPackRef(ID.toUpperCase())).toEqual({ kind: 'store_order_id', id: ID });
    expect(classifyPackRef('dso-000045')).toEqual({ kind: 'number', q: 'DSO-000045' });
    expect(classifyPackRef('DSO%2D000045')).toEqual({ kind: 'number', q: 'DSO-000045' });
    expect(classifyPackRef('')).toEqual({ kind: 'none' });
    expect(classifyPackRef('a b/c')).toEqual({ kind: 'none' });
    expect(classifyPackRef('%E0%A4%A')).toEqual({ kind: 'none' });
  });

  it('maps exactly one warehouse order to its page, otherwise the searched Dropship list', () => {
    expect(whOrderPath('wo-000123')).toBe('/office/warehouse/orders/WO-000123');
    expect(packTargetFromMatches('DSO-1', ['WO-000123'])).toBe('/office/warehouse/orders/WO-000123');
    expect(packTargetFromMatches('DSO-1', ['WO-000123', 'WO-000123'])).toBe('/office/warehouse/orders/WO-000123');
    expect(packTargetFromMatches('DSO-1', ['WO-000123', 'WO-000124'])).toBe(`${WH_DROPSHIP_ORDERS_PATH}&q=DSO-1`);
    expect(packTargetFromMatches('DSO-1', [])).toBe(`${WH_DROPSHIP_ORDERS_PATH}&q=DSO-1`);
    expect(packFallback(null)).toBe(WH_DROPSHIP_ORDERS_PATH);
    expect(packFallback('A&B')).toBe(`${WH_DROPSHIP_ORDERS_PATH}&q=A%26B`);
  });
});

describe('W7 B2B shipments: who sees what', () => {
  const perms = (list: string[], isAdmin = false) => b2bShippingAccess({ isAdmin, can: (a, x) => isAdmin || list.includes(`${a}:${x}`) });

  it('Support alone: tracking only — no carrier, rate, label, supplier or ready-to-ship queue (F-05)', () => {
    const a = perms(['orders:view', 'support:view', 'support:edit']);
    expect(a).toEqual({ canEdit: false, canSeeRates: false, canSeeSuppliers: false, canDownloadLabels: false, canSeeCarrier: false, canSeeReadyToShip: false });
  });

  it('Sourcing operations (orders:edit + suppliers:view) can ship and see everything', () => {
    const a = perms(['orders:view', 'orders:edit', 'suppliers:view']);
    expect(a).toEqual({ canEdit: true, canSeeRates: true, canSeeSuppliers: true, canDownloadLabels: true, canSeeCarrier: true, canSeeReadyToShip: true });
  });

  it('Finance sees carrier, rate and suppliers but cannot ship or download labels', () => {
    const a = perms(['orders:view', 'finance:view']);
    expect(a.canEdit).toBe(false);
    expect(a.canSeeCarrier && a.canSeeRates && a.canSeeSuppliers && a.canSeeReadyToShip).toBe(true);
    expect(a.canDownloadLabels).toBe(false);
  });

  it('Warehouse role sees carrier and labels, not rates', () => {
    const a = perms(['orders:view', 'warehouse:view']);
    expect(a.canSeeCarrier && a.canDownloadLabels).toBe(true);
    expect(a.canSeeRates || a.canEdit || a.canSeeSuppliers).toBe(false);
  });

  it('admin sees everything', () => {
    expect(Object.values(perms([], true)).every(Boolean)).toBe(true);
  });
});

describe('W7 menus', () => {
  const items = OFFICE_NAV.flatMap((s) => s.items.map((i) => `${i.href}|${i.label}|${i.area}`));

  it('back office: Shipping is now B2B shipments in Warehouse OS with the same permission; no legacy /office/shipping link', () => {
    expect(items).toContain(`${B2B_SHIPMENTS_PATH}|B2B shipments|orders`);
    expect(items.some((i) => i.startsWith('/office/shipping|'))).toBe(false);
  });

  it('customer menu: 3PL opens the client portal (no /account/sourcing?type=3pl)', () => {
    const hrefs = CUSTOMER_NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain('/account/warehouse');
    expect(hrefs).not.toContain('/account/sourcing?type=3pl');
  });
});

describe('W7 carrier names (audit F-05)', () => {
  it('workspace tiles (seen by Support via orders:view) never name a carrier', () => {
    for (const w of WORKSPACES) expect(`${w.label} ${w.description}`).not.toMatch(/yun ?express|4px/i);
    expect(WORKSPACES.find((w) => w.key === 'shipping')?.href).toBe(B2B_SHIPMENTS_PATH);
  });
});

describe('W7 old 3PL request form removed', () => {
  it('3pl is no longer a Request Center type (no form, no service code)', async () => {
    const { REQUEST_TYPES, REQUEST_FIELDS, SERVICE_CODE, isRequestType } = await import('@/components/store/request-schema');
    expect(isRequestType('3pl')).toBe(false);
    expect((REQUEST_TYPES as readonly string[]).includes('3pl')).toBe(false);
    expect('3pl' in REQUEST_FIELDS || '3pl' in SERVICE_CODE).toBe(false);
    expect(Object.values(REQUEST_FIELDS).flat().flatMap((s) => s.fields).some((f) => (f.kind as string) === 'warehouse')).toBe(false);
  });

  it('legacy URLs are permanent redirects that keep the query string', async () => {
    const cfg = (await import('@/next.config')).default;
    const list = await cfg.redirects!();
    expect(list).toContainEqual({ source: '/office/shipping', destination: B2B_SHIPMENTS_PATH, permanent: true });
    expect(list).toContainEqual({ source: '/request/3pl', destination: '/3pl', permanent: true });
  });
});
