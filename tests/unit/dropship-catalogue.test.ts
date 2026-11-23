import { describe, it, expect } from 'vitest';
import { sanitiseCsvCell, computeRouteMargin } from '@/lib/dropship-staff';

describe('dropship catalogue v2 helpers', () => {
  it('sanitiseCsvCell strips leading =, +, -, @ formula triggers and tab/CR characters', () => {
    expect(sanitiseCsvCell('=cmd|\' /C calc\'!A0')).toBe("cmd|' /C calc'!A0");
    expect(sanitiseCsvCell('++--@@=SUM(A1:A5)')).toBe('SUM(A1:A5)');
    expect(sanitiseCsvCell('  -10+20 ')).toBe('10+20');
    expect(sanitiseCsvCell('@Bowijie\tFactory\rLine')).toBe('Bowijie Factory Line');
    expect(sanitiseCsvCell('Cordless LED Desk Lamp')).toBe('Cordless LED Desk Lamp');
  });

  it('computeRouteMargin calculates integer cents margin and warns below minimum basis points', () => {
    const okRoute = computeRouteMargin({
      landedPriceCents: 2000,
      unitCostCents: 800,
      estShippingCents: 600,
      estDutiesCents: 100,
      minMarginBp: 1500, // 15%
    });
    expect(okRoute.marginCents).toBe(500);
    expect(okRoute.marginBp).toBe(2500); // 25%
    expect(okRoute.belowMin).toBe(false);

    const lowRoute = computeRouteMargin({
      landedPriceCents: 1600,
      unitCostCents: 900,
      estShippingCents: 500,
      estDutiesCents: 50,
      minMarginBp: 1500, // 15%
    });
    expect(lowRoute.marginCents).toBe(150);
    expect(lowRoute.marginBp).toBe(938); // 9.38%
    expect(lowRoute.belowMin).toBe(true);
  });
});
