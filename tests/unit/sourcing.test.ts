import { describe, expect, it } from 'vitest';
import { rfqStatus, serviceStatus, serviceType, timelineStep, SOURCING_STATUSES } from '@/lib/sourcing';
import { notificationFor, wantsEmail } from '@/lib/api/outbox-rules';

describe('Product sourcing statuses', () => {
  it('maps RFQ states to the customer steps', () => {
    expect(rfqStatus('submitted')).toBe('Submitted');
    expect(rfqStatus('assigned')).toBe('Under review');
    expect(rfqStatus('quoting')).toBe('Under review');
    expect(rfqStatus('quoted')).toBe('Quoted');
    expect(rfqStatus('accepted', 'pi_issued')).toBe('Accepted');
    expect(rfqStatus('accepted', 'deposit_paid')).toBe('Active');
    expect(rfqStatus('accepted', 'closed')).toBe('Closed');
    expect(rfqStatus('expired')).toBe('Closed');
  });
  it('maps service requests, with Onboarding for dropshipping and 3PL', () => {
    expect(serviceStatus('requested', 'qc')).toBe('Submitted');
    expect(serviceStatus('paid', 'qc')).toBe('Under review');
    expect(serviceStatus('accepted', 'dropship')).toBe('Onboarding');
    expect(serviceStatus('accepted', 'sample')).toBe('Accepted');
    expect(serviceStatus('in_progress', '3pl')).toBe('Active');
    expect(serviceStatus('refunded', 'qc')).toBe('Closed');
    expect(serviceType('3pl')).toBe('3pl');
  });
  it('timeline: 6 steps, Closed keeps the furthest step reached', () => {
    expect(SOURCING_STATUSES.length).toBe(7);
    expect(timelineStep('Quoted')).toBe(2);
    expect(timelineStep('Closed', 'Quoted')).toBe(2);
  });
});

describe('sourcing notifications', () => {
  it('quote, review and staff questions notify the customer in-app and by email', () => {
    expect(notificationFor({ event_type: 'quote.sent', aggregate_id: 'q', payload: { rfq_id: 'r1' } })?.link).toBe('/account/sourcing/r1');
    expect(notificationFor({ event_type: 'rfq.reviewed', aggregate_id: 'r1', payload: { code: 'RFQ-1' } })?.title).toMatch(/under review/);
    expect(notificationFor({ event_type: 'request.message', aggregate_id: 'r1', payload: { from_staff: true } })?.link).toBe('/account/sourcing/r1');
    expect(notificationFor({ event_type: 'request.message', aggregate_id: 'r1', payload: { from_staff: false } })).toBeNull();
    expect(wantsEmail({ event_type: 'rfq.reviewed', payload: {} })).toBe(true);
    expect(wantsEmail({ event_type: 'request.message', payload: { from_staff: true } })).toBe(true);
    expect(wantsEmail({ event_type: 'request.message', payload: { from_staff: false } })).toBe(false);
  });
});

