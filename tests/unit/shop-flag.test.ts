import { describe, expect, it } from 'vitest';
import { shopEnabledFrom, customerHome } from '@/lib/shop/flag';

describe('shop_enabled switch (owner 27 Nov: Shop OFF on live)', () => {
  it('a boolean in site_settings wins', () => {
    expect(shopEnabledFrom(false, { APP_ENVIRONMENT: 'staging', SHOP_ENABLED: 'true' })).toBe(false);
    expect(shopEnabledFrom(true, { APP_ENVIRONMENT: 'production', SHOP_ENABLED: 'false' })).toBe(true);
  });
  it('no row: SHOP_ENABLED decides, then the environment (staging ON, live OFF)', () => {
    expect(shopEnabledFrom(undefined, { SHOP_ENABLED: 'true' })).toBe(true);
    expect(shopEnabledFrom(undefined, { APP_ENVIRONMENT: 'staging', SHOP_ENABLED: 'false' })).toBe(false);
    expect(shopEnabledFrom(undefined, { APP_ENVIRONMENT: 'staging' })).toBe(true);
    expect(shopEnabledFrom(undefined, {})).toBe(false);
    expect(shopEnabledFrom('yes', { APP_ENVIRONMENT: 'production' })).toBe(false);
  });
  it('customers land on the Shop only when it is on', () => {
    expect(customerHome(true)).toBe('/shop');
    expect(customerHome(false)).toBe('/account');
  });
});
