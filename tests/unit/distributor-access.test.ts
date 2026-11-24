import { describe, expect, it } from 'vitest';
import { supplierAccess, isRestrictedDistributor } from '@/lib/distributor/access-rules';

/** Item 3 (change request v2): a distributor works only with the products of suppliers assigned to them. */
const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const dist = { isAdmin: false, roles: ['distributor'], permissions: new Set(['products:create', 'products:edit']) };
const sup = { isAdmin: false, roles: ['supplier'], permissions: new Set<string>() };
const admin = { isAdmin: true, roles: ['admin'], permissions: new Set<string>() };
const ops = { isAdmin: false, roles: ['operations'], permissions: new Set(['products:view', 'products:approve']) };

describe('supplierAccess', () => {
  it('distributor: assigned supplier ok, another supplier forbidden', () => {
    expect(supplierAccess(dist, new Set([A]), A)).toBe('ok');
    expect(supplierAccess(dist, new Set([A]), B)).toBe('forbidden');
  });
  it('supplier: own supplier ok, another supplier forbidden', () => {
    expect(supplierAccess(sup, new Set([A]), A)).toBe('ok');
    expect(supplierAccess(sup, new Set([A]), B)).toBe('forbidden');
  });
  it('unknown product/supplier → not_found', () => { expect(supplierAccess(dist, new Set([A]), null)).toBe('not_found'); });
  it('admin and staff with products:view keep platform-wide access', () => {
    expect(supplierAccess(admin, new Set(), B)).toBe('ok');
    expect(supplierAccess(ops, new Set(), B)).toBe('ok');
  });
  it('restricted = distributor without platform-wide product rights (same rule as distributor_restricted() in SQL)', () => {
    expect(isRestrictedDistributor(dist)).toBe(true);
    expect(isRestrictedDistributor(admin)).toBe(false);
    expect(isRestrictedDistributor({ ...dist, permissions: new Set(['products:view']) })).toBe(false);
  });
});
