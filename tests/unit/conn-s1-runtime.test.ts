import { describe, expect, it } from 'vitest';
import { processInbox, pullSince, redact, runConnectorSync, runOrderCatchup, runTasks, shipmentFromTask, toStoreTask, type RuntimeDeps } from '@/lib/connectors/runtime';
import { handleConnectorWebhook, headerRecord, type WebhookDeps } from '@/lib/connectors/webhook';
import { ConnectorError, type Connector, type ConnectionRef, type InternalOrder } from '@/lib/connectors/types';
import type { StorePlatform } from '@/lib/connectors/platforms';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const conn: ConnectionRef = { id: CONN, orgId: ORG, platform: 'woocommerce', shopDomain: 'shop.example.com', storeUrl: 'https://shop.example.com' };
const order: InternalOrder = {
  externalOrderId: '1001', externalOrderName: '#1001', currency: 'aed', fxRateToUsd: 0.2723, address: { name: 'Buyer', line1: '1 Way', city: 'Dubai', country: 'ae' },
  lines: [{ modelNo: 'ds-000001-01', qty: 2, buyerPaidMinor: 18000 }],
};

function fakeConnector(over: Partial<Connector> = {}): Connector {
  return {
    id: 'woocommerce', name: 'WooCommerce', status: () => 'ready', missingEnv: () => [], detect: () => null,
    startConnect: async () => ({ kind: 'form', fields: [] }), finishConnect: async () => conn, testConnection: async () => ({ ok: true, message: 'ok' }),
    pushProduct: async () => ({ ok: true }), pullOrders: async () => ({ orders: [], cursor: null, errors: [] }),
    sendTracking: async () => ({ ok: true }), syncStock: async () => ({ ok: true, failed: [] }), syncPrice: async () => ({ ok: true, failed: [] }),
    disconnect: async () => undefined, ...over,
  } as Connector;
}

function harness(opts: { connector?: Connector; rpcData?: Record<string, unknown>; rpcFail?: Record<string, string> } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const connector = opts.connector ?? fakeConnector();
  const deps: RuntimeDeps = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      if (opts.rpcFail?.[fn]) throw new Error(opts.rpcFail[fn]);
      return opts.rpcData?.[fn] ?? null;
    },
    getConnector: (id: StorePlatform) => (id === 'woocommerce' ? connector : fakeConnector({ status: () => 'not_configured' })),
    loadConnection: async (id) => (id === CONN ? conn : null),
    trackingCompany: async (carrier) => (carrier === 'yunexpress' ? 'Other' : 'Other'),
    origin: 'https://track.merchant.example',
    now: () => new Date('2026-11-28T10:00:00Z'),
  };
  return { deps, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: 't1', action: 'send_tracking', attempts: 1, store_order_id: 'so1', org_id: ORG, channel: 'woocommerce', store_connection_id: CONN,
  external_order_id: '1001', external_order_name: '#1001', order_number: 'SO-1',
  detail: { tracking_numbers: ['YT123456789', ''], tracking_token: 'ab'.repeat(16), carrier: 'yunexpress', shipped_at: '2026-11-28T09:00:00Z' }, ...over,
});

describe('CONN S1 · redact', () => {
  it('never writes a key, token or signature back to the database', () => {
    const r = redact(new Error('401 Bearer abc.def.ghi for ck_1234567890abcdef / cs_abcdef1234567890 ?consumer_secret=xyz&x=1\nmore'));
    expect(r).not.toMatch(/abc\.def|ck_1234|cs_abcd|xyz/);
    expect(r).toContain('Bearer [hidden]');
    expect(r).not.toContain('\n');
    expect(redact('x'.repeat(500)).length).toBeLessThanOrEqual(300);
  });
});

describe('CONN S1 · webhook inbox', () => {
  it('turns a verified order event into ds_order_intake with the internal format, then closes it and logs the sync', async () => {
    const h = harness({
      connector: fakeConnector({ webhookEvent: () => ({ kind: 'order', order }) }),
      rpcData: { c1_webhook_claim: [{ id: 'w1', source: 'woocommerce', topic: 'order.created', payload: {}, store_connection_id: CONN, org_id: ORG, attempts: 1 }] },
    });
    const r = await processInbox(h.deps);
    expect(r).toMatchObject({ picked: 1, ok: 1, failed: 0 });
    const intake = h.of('ds_order_intake')[0].args as { p_org: string; p_channel: string; p_order: Record<string, unknown> };
    expect(intake.p_org).toBe(ORG);
    expect(intake.p_channel).toBe('woocommerce');
    expect(intake.p_order).toMatchObject({ external_order_id: '1001', currency: 'AED', lines: [{ model_no: 'DS-000001-01', qty: 2, buyer_paid_cents: 18000 }] });
    expect(h.of('c1_webhook_done')[0].args).toEqual({ p_id: 'w1', p_error: null });
    expect(h.of('c1_connection_record_sync')[0].args).toMatchObject({ p_id: CONN, p_kind: 'webhooks', p_ok: true });
  });

  it('keeps a refused event open with its (redacted) error, cancels and disconnects through the database', async () => {
    const events = [
      { id: 'w1', topic: 'order.created', ev: { kind: 'order', order } },
      { id: 'w2', topic: 'order.cancelled', ev: { kind: 'order_cancelled', externalOrderId: '1001' } },
      { id: 'w3', topic: 'app.uninstalled', ev: { kind: 'uninstalled' } },
    ] as const;
    const h = harness({
      connector: fakeConnector({ webhookEvent: ({ topic }) => events.find((e) => e.topic === topic)!.ev as never }),
      rpcData: { c1_webhook_claim: events.map((e) => ({ id: e.id, source: 'woocommerce', topic: e.topic, payload: {}, store_connection_id: CONN, org_id: ORG, attempts: 1 })) },
      rpcFail: { ds_order_intake: 'BUYER_PRICE_MISSING: line 1 has no price (token Bearer zzz)' },
    });
    const r = await processInbox(h.deps);
    expect(r).toMatchObject({ picked: 3, ok: 2, failed: 1 });
    const done = h.of('c1_webhook_done').map((c) => c.args);
    expect(done[0].p_error).toMatch(/BUYER_PRICE_MISSING/);
    expect(done[0].p_error).not.toMatch(/zzz/);
    expect(done[1].p_error).toBeNull();
    expect(h.of('ds_order_channel_cancel')[0].args).toMatchObject({ p_org: ORG, p_channel: 'woocommerce', p_external_order_id: '1001' });
    expect(h.of('c1_connection_disconnect')[0].args).toMatchObject({ p_id: CONN });
    expect(h.of('c1_connection_record_sync')[0].args).toMatchObject({ p_ok: false, p_summary: '2 event(s) handled, 1 failed' });
  });

  it('an order intake refuses on purpose (ok:false) is NOT closed as handled', async () => {
    const h = harness({
      connector: fakeConnector({ webhookEvent: () => ({ kind: 'order', order }) }),
      rpcData: { c1_webhook_claim: [{ id: 'w1', source: 'woocommerce', topic: 'order.created', payload: {}, store_connection_id: CONN, org_id: ORG, attempts: 1 }], ds_order_intake: { ok: false, code: 'FEATURE_OFF', message: 'Orders are not switched on yet.' } },
    });
    expect(await processInbox(h.deps)).toMatchObject({ ok: 0, failed: 1 });
    expect(h.of('c1_webhook_done')[0].args.p_error).toBe('FEATURE_OFF: Orders are not switched on yet.');
  });

  it('a platform without webhook handling leaves the event with an error (no guessing)', async () => {
    const h = harness({ rpcData: { c1_webhook_claim: [{ id: 'w1', source: 'woocommerce', topic: null, payload: {}, store_connection_id: CONN, org_id: ORG, attempts: 1 }] } });
    await processInbox(h.deps);
    expect(h.of('c1_webhook_done')[0].args.p_error).toMatch(/not handled yet/);
    expect(h.of('ds_order_intake')).toHaveLength(0);
  });
});

describe('CONN S1 · store tasks', () => {
  it('maps a send_tracking task to the store shipment: numbers, mapped company, branded /t/ link — never a carrier name it was not given', () => {
    const s = shipmentFromTask(toStoreTask(taskRow() as never), 'Other', 'https://track.merchant.example');
    expect(s).toEqual({
      storeOrderNumber: 'SO-1', externalOrderId: '1001', externalOrderName: '#1001', trackingNumbers: ['YT123456789'], trackingCompany: 'Other',
      trackingUrl: `https://track.merchant.example/t/${'ab'.repeat(16)}`, shippedAt: '2026-11-28T09:00:00Z',
    });
    expect(shipmentFromTask(toStoreTask(taskRow() as never), '', null)).toMatchObject({ trackingCompany: 'Other', trackingUrl: null });
  });

  it('sends tracking and marks the task done; a refusal goes back with the message', async () => {
    let sent: unknown = null;
    const ok = harness({ connector: fakeConnector({ sendTracking: async (_c, s) => { sent = s; return { ok: true }; } }), rpcData: { c1_task_claim: [taskRow()] } });
    expect(await runTasks(ok.deps)).toMatchObject({ picked: 1, ok: 1 });
    expect(sent).toMatchObject({ trackingNumbers: ['YT123456789'], trackingCompany: 'Other' });
    expect(ok.of('c1_task_done')[0].args).toEqual({ p_id: 't1', p_ok: true, p_error: null });
    const no = harness({ connector: fakeConnector({ sendTracking: async () => ({ ok: false, message: 'Order 1001 not found' }) }), rpcData: { c1_task_claim: [taskRow()] } });
    expect(await runTasks(no.deps)).toMatchObject({ failed: 1 });
    expect(no.of('c1_task_done')[0].args).toEqual({ p_id: 't1', p_ok: false, p_error: 'Order 1001 not found' });
  });

  it('a store that refuses our access → needs reconnect once; the other tasks of that store are not sent', async () => {
    let tries = 0;
    const h = harness({
      connector: fakeConnector({ sendTracking: async () => { tries++; throw new ConnectorError('AUTH_FAILED', 'HTTP 401'); } }),
      rpcData: { c1_task_claim: [taskRow(), taskRow({ id: 't2' })] },
    });
    const r = await runTasks(h.deps);
    expect(tries).toBe(1);
    expect(r).toMatchObject({ picked: 2, failed: 2 });
    expect(h.of('c1_connection_set_status')).toHaveLength(1);
    expect(h.of('c1_connection_set_status')[0].args).toMatchObject({ p_id: CONN, p_status: 'needs_reconnect' });
    expect(h.of('c1_task_done').every((c) => c.args.p_ok === false)).toBe(true);
  });

  it('a step the platform does not have (no orderAction) is done; a task without tracking yet waits', async () => {
    const h = harness({ rpcData: { c1_task_claim: [taskRow({ action: 'release_fulfillment', detail: {} }), taskRow({ id: 't2', detail: {} })] } });
    await runTasks(h.deps);
    const done = h.of('c1_task_done').map((c) => c.args);
    expect(done[0]).toMatchObject({ p_id: 't1', p_ok: true });
    expect(done[1]).toMatchObject({ p_id: 't2', p_ok: false, p_error: 'No tracking number yet.' });
  });

  it('a task for a connection that is gone fails safely', async () => {
    const h = harness({ rpcData: { c1_task_claim: [taskRow({ store_connection_id: '33333333-3333-4333-8333-333333333333' })] } });
    await runTasks(h.deps);
    expect(h.of('c1_task_done')[0].args).toMatchObject({ p_ok: false, p_error: 'Store connection not found.' });
  });
});

describe('CONN S1 · order catch-up', () => {
  it('pulls only from configured connectors, overlaps the last read by 2 h, intakes each order and logs one sync', async () => {
    let since: string | null = 'unset';
    const h = harness({
      connector: fakeConnector({ pullOrders: async (_c, s) => { since = s; return { orders: [order, { ...order, externalOrderId: '1002' }], cursor: null, errors: [] }; } }),
      rpcData: { c1_pull_targets: [{ id: CONN, org_id: ORG, platform: 'woocommerce', shop_domain: 'shop.example.com', store_url: null, last_sync_at: '2026-11-28T08:00:00Z' }] },
    });
    const r = await runOrderCatchup(h.deps, ['woocommerce', 'magento', 'shopify']);
    expect(h.of('c1_pull_targets')[0].args.p_platforms).toEqual(['woocommerce']);
    expect(since).toBe('2026-11-28T06:00:00.000Z');
    expect(h.of('ds_order_intake')).toHaveLength(2);
    expect(h.of('c1_connection_record_sync')[0].args).toMatchObject({ p_kind: 'orders', p_ok: true, p_summary: '2 order(s) read, 2 taken in' });
    expect(r).toMatchObject({ picked: 1, ok: 1 });
  });

  it('makes no call at all when no connector can pull', async () => {
    const h = harness({ connector: fakeConnector({ status: () => 'not_built' }) });
    expect(await runOrderCatchup(h.deps, ['woocommerce'])).toMatchObject({ picked: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it('first read looks back 3 days', () => {
    expect(pullSince(null, new Date('2026-11-28T10:00:00Z'))).toBe('2026-11-25T10:00:00.000Z');
  });

  it('an auth failure marks the store "needs reconnect" and logs a failed sync', async () => {
    const h = harness({
      connector: fakeConnector({ pullOrders: async () => { throw new ConnectorError('AUTH_FAILED', 'HTTP 401 consumer_key=ck_abcdefghijkl'); } }),
      rpcData: { c1_pull_targets: [{ id: CONN, org_id: ORG, platform: 'woocommerce', shop_domain: 'shop.example.com', store_url: null, last_sync_at: null }] },
    });
    await runOrderCatchup(h.deps, ['woocommerce']);
    expect(h.of('c1_connection_set_status')[0].args).toMatchObject({ p_status: 'needs_reconnect' });
    const log = h.of('c1_connection_record_sync')[0].args;
    expect(log).toMatchObject({ p_ok: false });
    expect(String(log.p_summary)).not.toContain('ck_abcdefghijkl');
  });

  it('one loop failing does not stop the others', async () => {
    const h = harness({ rpcFail: { c1_webhook_claim: 'boom' }, rpcData: { c1_task_claim: [] } });
    const r = await runConnectorSync(h.deps, ['woocommerce']);
    expect(r.inbox.errors).toEqual(['boom']);
    expect(h.of('c1_task_claim')).toHaveLength(1);
    expect(h.of('c1_pull_targets')).toHaveLength(1);
  });
});

describe('CONN S1 · webhook route decision', () => {
  const body = JSON.stringify({ id: 7 });
  function wh(over: Partial<WebhookDeps> = {}, connector: Connector = fakeConnector({
    verifyWebhook: ({ headers, secret }) => headers['x-sig'] === `ok:${secret}`,
    webhookMeta: ({ headers }) => ({ eventId: headers['x-id'] ?? null, topic: headers['x-topic'] ?? null }),
  })) {
    const received: unknown[] = [];
    const deps: WebhookDeps = {
      getConnector: (id) => (id === 'woocommerce' ? connector : fakeConnector()),
      findConnection: async (id) => (id === CONN ? { id: CONN, platform: 'woocommerce', status: 'active' } : null),
      readSecret: async () => 'sekret',
      receive: async (i) => { received.push(i); return { id: 'w1', duplicate: false }; },
      ...over,
    };
    return { deps, received };
  }
  const call = (deps: WebhookDeps, o: Partial<{ platform: string; connection: string; headers: Record<string, string>; rawBody: string }> = {}) =>
    handleConnectorWebhook(deps, { platform: 'woocommerce', connection: CONN, headers: { 'x-sig': 'ok:sekret', 'x-id': 'e1', 'x-topic': 'order.created' }, rawBody: body, ...o });

  it('stores a verified event (deduped by id) and asks for processing', async () => {
    const { deps, received } = wh();
    expect(await call(deps)).toEqual({ status: 200, body: { received: true, duplicate: false }, process: true });
    expect(received[0]).toEqual({ platform: 'woocommerce', connectionId: CONN, eventId: 'e1', topic: 'order.created', signatureOk: true, payload: { id: 7 } });
  });

  it('a bad signature → 401, recorded without the payload', async () => {
    const { deps, received } = wh();
    expect(await call(deps, { headers: { 'x-sig': 'nope' } })).toMatchObject({ status: 401, code: 'BAD_SIGNATURE' });
    expect(received[0]).toMatchObject({ signatureOk: false, payload: null, eventId: null });
  });

  it('no stored secret is a bad signature too', async () => {
    const { deps } = wh({ readSecret: async () => null });
    expect(await call(deps)).toMatchObject({ status: 401 });
  });

  it('404 for unknown platforms, Shopify, bad ids, unknown connections, a connection of another platform, platforms without webhooks', async () => {
    const { deps } = wh();
    expect(await call(deps, { platform: 'myspace' })).toMatchObject({ status: 404 });
    expect(await call(deps, { platform: 'shopify' })).toMatchObject({ status: 404 });
    expect(await call(deps, { connection: 'not-a-uuid' })).toMatchObject({ status: 404 });
    expect(await call(deps, { connection: '33333333-3333-4333-8333-333333333333' })).toMatchObject({ status: 404 });
    expect(await call(wh({ findConnection: async () => ({ id: CONN, platform: 'magento', status: 'active' }) }).deps)).toMatchObject({ status: 404 });
    expect(await call(wh({}, fakeConnector()).deps)).toMatchObject({ status: 404 });
  });

  it('410 for a disconnected store, 413 over 1 MB, 400 for a verified non-JSON body, no processing for a duplicate', async () => {
    expect(await call(wh({ findConnection: async () => ({ id: CONN, platform: 'woocommerce', status: 'disconnected' }) }).deps)).toMatchObject({ status: 410 });
    expect(await call(wh().deps, { rawBody: 'x'.repeat(1_000_001) })).toMatchObject({ status: 413 });
    expect(await call(wh().deps, { rawBody: 'not json' })).toMatchObject({ status: 400 });
    expect(await call(wh({ receive: async () => ({ id: null, duplicate: true }) }).deps)).toMatchObject({ status: 200, process: false });
  });

  it('lower-cases header names', () => {
    expect(headerRecord(new Headers({ 'X-WC-Webhook-Signature': 'a' }))).toEqual({ 'x-wc-webhook-signature': 'a' });
  });
});
