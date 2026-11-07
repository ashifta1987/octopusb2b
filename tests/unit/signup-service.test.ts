import { describe, expect, it } from 'vitest';
import { SERVICE_TARGET, safeAccountNext, onboardingHref } from '@/lib/signup-service';

describe('ADDON-44-F /signup?service=', () => {
  it('maps each service to its My account section', () => {
    expect(SERVICE_TARGET.dropship).toBe('/account/dropship');
    expect(SERVICE_TARGET['3pl']).toBe('/account/warehouse');
    expect(SERVICE_TARGET.brand).toBe('/account/brand');
    expect(SERVICE_TARGET.sourcing).toBe('/account/sourcing');
  });
  it('only lets My account paths through (no open redirects)', () => {
    expect(safeAccountNext('/account/dropship')).toBe('/account/dropship');
    expect(safeAccountNext('/account/brand?project=MB-0001')).toBe('/account/brand?project=MB-0001');
    for (const bad of ['https://evil.example', '//evil.example', '/admin', '/account/../admin', 'javascript:alert(1)', null, 42]) expect(safeAccountNext(bad)).toBe('/account');
  });
  it('carries the section through onboarding', () => {
    expect(onboardingHref('/account')).toBe('/onboarding');
    expect(onboardingHref('/account/dropship')).toBe('/onboarding?next=%2Faccount%2Fdropship');
    expect(onboardingHref('https://evil.example')).toBe('/onboarding');
  });
});

