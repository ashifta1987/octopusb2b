import { describe, it, expect } from 'vitest';
import { scrubCustomerReply } from '@/lib/assistant/scrub';

describe('scrubCustomerReply', () => {
  it('removes supplier codes', () => {
    expect(scrubCustomerReply('Quote Q-1 from OCT-1115 is cheapest.', 'Octopus B2B shipping')).toBe('Quote Q-1 from the factory is cheapest.');
  });
  it('replaces carrier names until the public label is allowed', () => {
    expect(scrubCustomerReply('Your parcel is with YunExpress, tracking YT123.', 'Octopus B2B shipping')).toBe('Your parcel is with Octopus B2B shipping, tracking YT123.');
    expect(scrubCustomerReply('Shipped by DHL.', 'Octopus B2B shipping')).toBe('Shipped by Octopus B2B shipping.');
  });
  it('keeps the approved public label', () => {
    expect(scrubCustomerReply('Carrier: YunExpress network.', 'YunExpress network')).toBe('Carrier: YunExpress network.');
  });
  it('leaves ordinary words alone', () => {
    expect(scrubCustomerReply('Pick-ups happen daily; order ORD-1001 ships soon.', 'Octopus B2B shipping')).toBe('Pick-ups happen daily; order ORD-1001 ships soon.');
  });
});
