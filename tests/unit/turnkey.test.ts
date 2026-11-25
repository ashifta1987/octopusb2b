import { describe, expect, it } from 'vitest';
import { TK_PHASES, categoryLabel, fromPrice, projectFrom, servicePrice, tkImageUrl } from '@/lib/turnkey/format';

describe('turnkey format (design turnkey-v2)', () => {
  it('every price is a starting price', () => {
    expect(fromPrice(9900)).toBe('From $99');
    expect(fromPrice(25000, true)).toBe('About $250');
    expect(fromPrice(0)).toBe('Free');
    expect(fromPrice(1550)).toBe('From $15.50');
    expect(servicePrice({ from_cents: 39900, approx: false, unit: 'day' })).toBe('From $399 per day');
    expect(servicePrice({ from_cents: 29900, approx: false, unit: 'project' })).toBe('From $299 per project');
    expect(servicePrice({ from_cents: 0, approx: false, unit: 'free' })).toBe('Free');
  });

  it('project starting budget', () => {
    expect(projectFrom({ starting_budget_usd: 22000, budget_unit: 'per court' })).toBe('From $22,000 per court');
    expect(projectFrom({ starting_budget_usd: null, budget_unit: null })).toBeNull();
  });

  it('category chips: old codes get labels, new categories show as typed', () => {
    expect(categoryLabel('food')).toBe('Food & hospitality');
    expect(categoryLabel('Laundry')).toBe('Laundry');
  });

  it('8 phases, 7 payment gates (only the enquiry is free)', () => {
    expect(TK_PHASES).toHaveLength(8);
    expect(TK_PHASES.filter((p) => p.paid)).toHaveLength(7);
    expect(TK_PHASES[0]).toMatchObject({ name: 'Enquiry', paid: false });
  });

  it('image urls: https and site paths pass through, storage paths use the public media bucket, nothing for empty', () => {
    expect(tkImageUrl('https://x.test/a.webp', 'https://p.supabase.co')).toBe('https://x.test/a.webp');
    expect(tkImageUrl('/images/a.webp', undefined)).toBe('/images/a.webp');
    expect(tkImageUrl('turnkey/a.webp', 'https://p.supabase.co')).toBe('https://p.supabase.co/storage/v1/object/public/site-media/turnkey/a.webp');
    expect(tkImageUrl(null, 'https://p.supabase.co')).toBeNull();
  });
});
