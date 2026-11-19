import { describe, it, expect } from 'vitest';
import { customerCarrierLabel, DEFAULT_CUSTOMER_CARRIER } from '@/lib/carrier-label';

describe('customerCarrierLabel', () => {
  it('hides the carrier until the test shipment passed', () => {
    expect(customerCarrierLabel({ 'shipping.carrier_public_label': 'YunExpress network', 'shipping.carrier_test_passed': false })).toBe('Octopus B2B shipping');
    expect(customerCarrierLabel({ 'shipping.carrier_public_label': 'YunExpress network' })).toBe(DEFAULT_CUSTOMER_CARRIER);
    expect(customerCarrierLabel(null)).toBe(DEFAULT_CUSTOMER_CARRIER);
  });
  it('shows the public label once the test passed', () => {
    expect(customerCarrierLabel({ 'shipping.carrier_public_label': 'YunExpress network', 'shipping.carrier_test_passed': true })).toBe('YunExpress network');
    expect(customerCarrierLabel({ 'shipping.carrier_public_label': 'YunExpress network', 'shipping.carrier_test_passed': 'true' })).toBe('YunExpress network');
  });
  it('falls back when the label is empty', () => {
    expect(customerCarrierLabel({ 'shipping.carrier_public_label': '  ', 'shipping.carrier_test_passed': true })).toBe(DEFAULT_CUSTOMER_CARRIER);
  });
});
