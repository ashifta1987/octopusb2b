import { describe, expect, it } from 'vitest';
import { ODS_SHOP_REDIRECTS, isOdsInternalPath, odsAccountKeepsLegacy, odsDropshipRewritePath, odsOfficeRewritePath, odsStaffRewritePath, odsAccountOffFallback, odsAccountRedirect, odsAccountRewritePath, odsLegacyRedirect, odsOffFallback, odsRewritePath, odsShopRewritePath } from '@/lib/ods-routes';

describe('ODS T3 routes', () => {
  it('public URLs the ODS theme serves', () => {
    expect(odsRewritePath('/')).toBe('/ods');
    expect(odsRewritePath('/login')).toBe('/ods/login');
    expect(odsRewritePath('/signup')).toBe('/ods/login');
    for (const s of ['sourcing', 'pools', 'dropship', 'warehouse', 'brand']) expect(odsRewritePath(`/services/${s}`)).toBe(`/ods/services/${s}`);
    expect(odsRewritePath('/services/turnkey')).toBeNull(); // Turnkey stays at /turnkey (D4)
    expect(odsRewritePath('/turnkey')).toBe('/ods/turnkey');
    expect(odsRewritePath('/turnkey/catalogue')).toBeNull();
    for (const p of ['/how-it-works', '/shipping', '/help', '/welcome/setup']) expect(odsRewritePath(p)).toBe(`/ods${p}`);
    for (const l of ['terms', 'privacy', 'cookies', 'refunds']) expect(odsRewritePath(`/legal/${l}`)).toBe(`/ods/legal/${l}`);
    expect(odsRewritePath('/legal/group-buy')).toBeNull();
    expect(odsRewritePath('/invite/abc_123-X')).toBe('/ods/invite/abc_123-X');
    expect(odsRewritePath('/invite/a/b')).toBeNull();
    expect(odsRewritePath('/services/../admin')).toBeNull();
    expect(odsRewritePath('/account')).toBeNull();
    expect(odsRewritePath('/shop')).toBeNull();
    expect(odsRewritePath('/help/')).toBe('/ods/help');
  });
  it('old service URLs move only at "all" (proxy decides); the map', () => {
    expect(odsLegacyRedirect('/sourcing')).toBe('/services/sourcing');
    expect(odsLegacyRedirect('/pools')).toBe('/services/pools');
    expect(odsLegacyRedirect('/3pl')).toBe('/services/warehouse');
    expect(odsLegacyRedirect('/make-my-brand')).toBe('/services/brand');
    expect(odsLegacyRedirect('/turnkey')).toBeNull();
    expect(odsLegacyRedirect('/request/dropship')).toBeNull();
    expect(odsLegacyRedirect('/pools/terms')).toBeNull();
    expect(odsLegacyRedirect('/3pl/apply')).toBeNull();
  });
  it('switch off: new-only URLs fall back to today’s pages', () => {
    expect(odsOffFallback('/welcome/setup')).toBe('/onboarding');
    expect(odsOffFallback('/invite/t0k3n')).toBe('/account/dropship/join');
    expect(odsOffFallback('/services/sourcing')).toBeNull();
  });
  it('the internal tree is never served directly', () => {
    expect(isOdsInternalPath('/ods')).toBe(true);
    expect(isOdsInternalPath('/ods/login')).toBe(true);
    expect(isOdsInternalPath('/odsx')).toBe(false);
  });
});

describe('ODS T4 shop routes', () => {
  it('serves /shop/* from the ODS tree; the CH-1 quote list moves to the cart (T5a)', () => {
    expect(odsShopRewritePath('/shop')).toBe('/ods/shop');
    expect(odsShopRewritePath('/shop/products')).toBe('/ods/shop/products');
    expect(odsShopRewritePath('/shop/products/some-slug')).toBe('/ods/shop/products/some-slug');
    expect(odsShopRewritePath('/shop/turnkey/gym/start')).toBe('/ods/shop/turnkey/gym/start');
    expect(ODS_SHOP_REDIRECTS['/shop/quote-list']).toBe('/shop/cart?tab=quote');
    expect(odsShopRewritePath('/shopping')).toBeNull();
    expect(odsShopRewritePath('/account')).toBeNull();
    expect(odsShopRewritePath('/shop/../admin')).toBeNull();
    expect(ODS_SHOP_REDIRECTS['/shop/all']).toBe('/shop');
  });
});

describe('ODS T6 account routes', () => {
  it('rewrites only the pages that have an ODS version', () => {
    for (const p of ['/account', '/account/action', '/account/requests', '/account/requests/RFQ-1042', '/account/orders', '/account/orders/OCT-SRC-2026-0207', '/account/wallet', '/account/invoices', '/account/turnkey', '/account/turnkey/TKP-00012', '/account/warehouse', '/account/shipping', '/account/brand', '/account/settings', '/account/support', '/account/support/0b9c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'])
      expect(odsAccountRewritePath(p), p).toBe(`/ods${p}`);
    for (const p of ['/account/ledger', '/account/notifications', '/account/turnkey/new', '/account/dropship', '/account/dropship/orders', '/account/pools', '/account/developer', '/account/orders/../admin'])
      expect(odsAccountRewritePath(p), p).toBeNull();
  });
  it('renames (ODS on) and fallbacks (ODS off)', () => {
    expect(odsAccountRedirect('/account/sourcing')).toBe('/account/requests');
    expect(odsAccountRedirect('/account/sourcing/RFQ-7')).toBe('/account/requests/RFQ-7');
    expect(odsAccountRedirect('/account/kyc')).toBe('/account/settings?tab=verification');
    expect(odsAccountRedirect('/account/wallet')).toBeNull();
    expect(odsAccountOffFallback('/account/requests/RFQ-7')).toBe('/account/sourcing/RFQ-7');
    expect(odsAccountOffFallback('/account/settings')).toBe('/account/kyc');
    expect(odsAccountOffFallback('/account/action')).toBe('/account#waiting');
    expect(odsAccountOffFallback('/account')).toBeNull();
  });
});

describe('ODS T6 warehouse tools stay on today’s page', () => {
  it('only the legacy tab keys', () => {
    expect(odsAccountKeepsLegacy('/account/warehouse', new URLSearchParams('tab=send'))).toBe(true);
    expect(odsAccountKeepsLegacy('/account/warehouse', new URLSearchParams('tab=orders&order=WO-1'))).toBe(true);
    expect(odsAccountKeepsLegacy('/account/warehouse', new URLSearchParams('tab=stock'))).toBe(false);
    expect(odsAccountKeepsLegacy('/account/warehouse', new URLSearchParams(''))).toBe(false);
    expect(odsAccountKeepsLegacy('/account/wallet', new URLSearchParams('tab=send'))).toBe(false);
  });
});

describe('ODS T7 dropship routes', () => {
  it('every page under /account/dropship, never the export route handlers', () => {
    for (const p of ['/account/dropship', '/account/dropship/orders', '/account/dropship/orders/abc', '/account/dropship/catalogue/x1', '/account/dropship/integrations/shopify'])
      expect(odsDropshipRewritePath(p), p).toBe(`/ods${p}`);
    for (const p of ['/account/dropship/export', '/account/dropship/export/csv', '/account/dropship/reports/csv', '/account/dropship/integrations/file/export', '/account/dropshipx', '/account/dropship/../wallet'])
      expect(odsDropshipRewritePath(p), p).toBeNull();
  });
});

describe('ODS T8 back office routes', () => {
  it('every /office and /admin page; never the export / template route handlers', () => {
    for (const p of ['/office', '/admin', '/office/rfqs/abc', '/admin/customers/1', '/office/warehouse/pick', '/admin/finance/holds'])
      expect(odsOfficeRewritePath(p), p).toBe(`/ods${p}`);
    for (const p of ['/admin/finance/export', '/office/warehouse/reports/csv', '/office/dropship/docs/file/9', '/admin/import/template', '/officex', '/office/../account'])
      expect(odsOfficeRewritePath(p), p).toBeNull();
  });
  it('staff sign-in pages', () => {
    for (const p of ['/staff', '/staff/login', '/staff/verify', '/staff/forgot', '/staff/set-password', '/staff/account', '/staff/workspace'])
      expect(odsStaffRewritePath(p), p).toBe(`/ods${p}`);
    expect(odsStaffRewritePath('/staff/other')).toBeNull();
  });
});

describe('ODS T9 accounts routes (Invoices, Credit notes, Ledger, Payments)', () => {
  it('rewrite to the ODS tree (new pages: with the switch off they 404, as today has no /office/accounts pages)', () => {
    for (const p of ['/office/accounts/invoices', '/office/accounts/credit-notes', '/office/accounts/ledger', '/office/accounts/payments'])
      expect(odsOfficeRewritePath(p), p).toBe(`/ods${p}`);
    expect(odsOfficeRewritePath('/office/accounts/ledger/')).toBe('/ods/office/accounts/ledger');
    expect(odsOfficeRewritePath('/office/accounts/../account')).toBeNull();
    // the CSV exports they link to stay route handlers (never rewritten)
    expect(odsOfficeRewritePath('/admin/finance/export')).toBeNull();
  });
});
