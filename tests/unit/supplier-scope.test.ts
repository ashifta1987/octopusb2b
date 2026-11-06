import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/components/backoffice/server-utils', () => ({ getManagedSuppliers: vi.fn() }));
import { findSupplier } from '@/lib/distributor/supplier-scope';

const S = [{ id: 'a2b7b0f9-868f-491c-8681-d4769f903b72', code: 'OCT-1132' }, { id: 'f0ab95d3-3b6b-4ae1-9c03-0036fa3ad2a4', code: 'OCT-1133' }] as never[];

describe('findSupplier (?supplier= on the distributor portal)', () => {
  it('no param → all suppliers', () => { expect(findSupplier(S, undefined)).toBeNull(); expect(findSupplier(S, ' ')).toBeNull(); });
  it('matches the code case-insensitively, or a legacy id', () => {
    expect(findSupplier(S, 'oct-1133')).toMatchObject({ code: 'OCT-1133' });
    expect(findSupplier(S, 'a2b7b0f9-868f-491c-8681-d4769f903b72')).toMatchObject({ code: 'OCT-1132' });
  });
  it('a code that is not in the caller\'s list is not found', () => { expect(findSupplier(S, 'OCT-9999')).toBe('not_found'); });
});

