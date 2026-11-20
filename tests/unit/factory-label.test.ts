import { describe, it, expect } from 'vitest';
import { factoryLabel, factoryPlace, countryName, provinceName } from '@/lib/factory-label';

describe('factoryLabel', () => {
  it('verified with country and province', () => {
    expect(factoryLabel({ verified: true, country: 'CN', province: 'Guangdong' })).toBe('Verified factory · China (Guangdong)');
  });
  it('unverified supplier', () => {
    expect(factoryLabel({ verified: false, country: 'CN', province: 'Guangdong' })).toBe('Factory · China (Guangdong)');
    expect(factoryLabel({ verified: null, country: 'CN', province: 'Zhejiang' })).toBe('Factory · China (Zhejiang)');
  });
  it('drops missing parts', () => {
    expect(factoryLabel({ verified: true, country: 'CN', province: null })).toBe('Verified factory · China');
    expect(factoryLabel({ verified: true, country: null, province: 'Guangdong' })).toBe('Verified factory · Guangdong');
    expect(factoryLabel({ verified: false, country: '', province: '  ' })).toBe('Factory');
    expect(factoryLabel(null)).toBe('Factory');
    expect(factoryLabel(undefined)).toBe('Factory');
  });
  it('strips a trailing "province"', () => {
    expect(factoryLabel({ verified: true, country: 'cn', province: 'Guangdong province' })).toBe('Verified factory · China (Guangdong)');
  });
  it('never contains a supplier code even if extra fields are passed', () => {
    const f = { verified: true, country: 'CN', province: 'Guangdong', code: 'OCT-1234', id: 'abc' } as Parameters<typeof factoryLabel>[0];
    expect(factoryLabel(f)).not.toContain('OCT-1234');
    expect(factoryLabel(f)).not.toContain('abc');
  });
});

describe('countryName', () => {
  it('maps codes to English names', () => {
    expect(countryName('CN')).toBe('China');
    expect(countryName('vn')).toBe('Vietnam');
    expect(countryName('IN')).toBe('India');
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('AE')).toBe('United Arab Emirates');
  });
  it('passes through names and blanks', () => {
    expect(countryName('China')).toBe('China');
    expect(countryName(null)).toBeNull();
    expect(countryName(' ')).toBeNull();
  });
});

describe('provinceName / factoryPlace', () => {
  it('works', () => {
    expect(provinceName('Zhejiang Province')).toBe('Zhejiang');
    expect(provinceName(null)).toBeNull();
    expect(factoryPlace({ country: 'CN' })).toBe('China');
    expect(factoryPlace({})).toBeNull();
  });
});
