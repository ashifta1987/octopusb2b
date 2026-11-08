import { describe, expect, it } from 'vitest';
import { notificationFor, notificationKey } from '@/lib/api/outbox-rules';
import { readFileSync } from 'node:fs';

/** Bug 1 (8 Nov 2026): one notification per event; wording that tells two requests apart; badge reads one source. */
const ORG = '11111111-1111-1111-1111-111111111111';
const paid = (id: string, aggregate = 'aaaaaaaa-0000-0000-0000-000000000001') =>
  ({ id, event_type: 'service_request.paid', aggregate_type: 'service_request', aggregate_id: aggregate, payload: { org_id: ORG, service: '3pl' }, attempts: 0 });

describe('notificationKey — one notification per event', () => {
  it('the same payment event processed twice → same key', () => {
    expect(notificationKey(paid('e1'), ORG)).toBe(notificationKey(paid('e1'), ORG));
  });
  it('the same payment fired twice as two outbox events → still one key', () => {
    expect(notificationKey(paid('e1'), ORG)).toBe(notificationKey(paid('e2'), ORG));
  });
  it('two different requests → two keys', () => {
    expect(notificationKey(paid('e1'), ORG)).not.toBe(notificationKey(paid('e3', 'aaaaaaaa-0000-0000-0000-000000000002'), ORG));
  });
  it('a later status of the same request is a new notification', () => {
    const done = { ...paid('e4'), event_type: 'service_request.updated', payload: { org_id: ORG, to: 'completed' } };
    expect(notificationKey(done, ORG)).not.toBe(notificationKey(paid('e1'), ORG));
  });
  it('repeatable events (tracking, messages) are keyed by event id', () => {
    const t = (id: string) => ({ id, event_type: 'shipment.tracking', aggregate_type: 'shipment', aggregate_id: 's1', payload: {}, attempts: 0 });
    expect(notificationKey(t('x1'), ORG)).not.toBe(notificationKey(t('x2'), ORG));
  });
});

describe('notification wording', () => {
  it('names the service and the request code, links to the request', () => {
    const n = notificationFor({ ...paid('e1'), payload: { org_id: ORG, code: 'SR-1042', service_name: '3PL request' } })!;
    expect(n.title).toBe('3PL request SR-1042 paid');
    expect(n.link).toBe('/account/sourcing/SR-1042');
  });
  it('falls back to the generic wording without details', () => {
    expect(notificationFor(paid('e1'))!.title).toBe('Service request paid');
  });
  it('wallet credit shows the amount and reference when known', () => {
    const n = notificationFor({ event_type: 'wallet.updated', aggregate_id: 't1', payload: { amount_label: 'USD 500.00', reference: 'W-00012' } })!;
    expect(n.title).toBe('Wallet credited · USD 500.00');
    expect(n.body).toContain('W-00012');
  });
});

describe('badge and list read the same source', () => {
  it('the count bubble and the Notifications list both use my_notifications()', () => {
    const ctx = readFileSync('lib/core/account.ts', 'utf8');
    const page = readFileSync('app/account/notifications/page.tsx', 'utf8');
    expect(ctx).toMatch(/rpc\('my_notifications'[^)]*\)[^;]*?\.is\('read_at', null\)/);
    expect(page).toMatch(/rpc\('my_notifications'\)/);
  });
  it('opening a notification marks it read (not a plain link)', () => {
    const item = readFileSync('components/account/notification-item.tsx', 'utf8');
    expect(item).toMatch(/openNotification\(id\)/);
  });
});
