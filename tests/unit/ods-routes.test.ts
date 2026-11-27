import { describe, expect, it } from 'vitest';
import { ODS_SHOP_REDIRECTS, isOdsInternalPath, odsLegacyRedirect, odsOffFallback, odsRewritePath, odsShopRewritePath } from '@/lib/ods-routes';

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
  it('serves /shop/* from the ODS tree, except the CH-1 quote list', () => {
    expect(odsShopRewritePath('/shop')).toBe('/ods/shop');
    expect(odsShopRewritePath('/shop/products')).toBe('/ods/shop/products');
    expect(odsShopRewritePath('/shop/products/some-slug')).toBe('/ods/shop/products/some-slug');
    expect(odsShopRewritePath('/shop/turnkey/gym/start')).toBe('/ods/shop/turnkey/gym/start');
    expect(odsShopRewritePath('/shop/quote-list')).toBeNull();
    expect(odsShopRewritePath('/shopping')).toBeNull();
    expect(odsShopRewritePath('/account')).toBeNull();
    expect(odsShopRewritePath('/shop/../admin')).toBeNull();
    expect(ODS_SHOP_REDIRECTS['/shop/all']).toBe('/shop');
  });
});
