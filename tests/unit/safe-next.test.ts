import { describe, expect, it } from 'vitest';
import { safeNext, safeCustomerNext, landingFor, CUSTOMER_HOME } from '@/lib/safe-next';

describe('safeNext (CH-1)', () => {
  it('keeps same-site paths with their query', () => {
    expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/account/turnkey/new?project=gym')).toBe('/account/turnkey/new?project=gym');
    expect(safeNext('/shop/products?q=lamp&sort=lead_asc')).toBe('/shop/products?q=lamp&sort=lead_asc');
    expect(safeNext('/p/silicone-mat#reviews')).toBe('/p/silicone-mat#reviews');
  });
  it('falls back to the shop for anything off-site or odd', () => {
    for (const bad of [
      undefined, null, 42, '', '   ', 'shop', 'https://evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', '/%2F%2Fevil.com',
      '/%5Cevil.com', '/\tevil', '/x\r\nSet-Cookie: a=b', 'javascript:alert(1)', '/%00', '/../admin', '/shop/../../etc', '/%2e%2e/admin',
      '/api/v1/rfqs', '/API/health', '/auth/callback?next=//evil.com', '/auth', `/${'a'.repeat(600)}`, '/%E0%A4%A',
    ]) expect(safeNext(bad), String(bad)).toBe(CUSTOMER_HOME);
  });
  it('uses the given fallback', () => {
    expect(safeNext('//evil.com', '/account')).toBe('/account');
  });
});

describe('safeCustomerNext', () => {
  it('allows only /account and /shop paths', () => {
    expect(safeCustomerNext('/account/warehouse')).toBe('/account/warehouse');
    expect(safeCustomerNext('/shop/quote-list')).toBe('/shop/quote-list');
    expect(safeCustomerNext('/account/sourcing?tab=open')).toBe('/account/sourcing?tab=open');
    expect(safeCustomerNext('/office')).toBe('/shop');
    expect(safeCustomerNext('/admin/finance')).toBe('/shop');
    expect(safeCustomerNext('/accounting')).toBe('/shop');
    expect(safeCustomerNext('//evil.com/account')).toBe('/shop');
  });
});

describe('landingFor', () => {
  it('customer → shop, supplier → portal, staff → 2FA', () => {
    expect(landingFor({ isStaff: false, isSupplier: false })).toBe('/shop');
    expect(landingFor({ isStaff: false, isSupplier: true })).toBe('/supplier');
    expect(landingFor({ isStaff: true, isSupplier: false })).toBe('/staff/verify');
  });
});
