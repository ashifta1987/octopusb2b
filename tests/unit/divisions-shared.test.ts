import { describe, it, expect } from 'vitest';
import { divisionCodeForService, DIVISION_LOGOS, DIVISION_ROLES, COMPANY_WIDE_ROLES } from '@/lib/divisions/shared';

describe('divisions (step 4 switcher helpers)', () => {
  it('maps service words to division codes like the database does', () => {
    expect(divisionCodeForService('rfq')).toBe('SRC');
    expect(divisionCodeForService('sample')).toBe('SRC');
    expect(divisionCodeForService('3pl')).toBe('3PL');
    expect(divisionCodeForService('dropship')).toBe('DS');
    expect(divisionCodeForService('brand')).toBe('MMB');
    expect(divisionCodeForService('POOLS')).toBe('POOL');
    expect(divisionCodeForService('turnkey')).toBe('TK');
    expect(divisionCodeForService('wallet')).toBeNull();
    expect(divisionCodeForService(null)).toBeNull();
  });
  it('only the two approved logo files, the four division roles and the three company-wide roles', () => {
    expect(Object.keys(DIVISION_LOGOS).sort()).toEqual(['octopus-b2b', 'octopus-dropship']);
    expect([...DIVISION_ROLES]).toEqual(['manager', 'staff', 'warehouse', 'finance']);
    expect([...COMPANY_WIDE_ROLES]).toEqual(['admin', 'finance', 'support']);
  });
});
