/**
 * CONN S2 · the WooCommerce key callback and the first test (deps injected; the route wires the service role).
 *   acceptWooKeys    WooCommerce POSTs the approved key pair with our state → claim the state once (organisation + store) →
 *                    create / re-authorise the connection → seal consumer key, consumer secret and a fresh webhook secret.
 *                    Answers fast: WooCommerce shows the merchant an error unless the callback answers 200.
 *   finishWooConnect after the answer: test the keys on the store → active → replace our webhooks on the store (order created /
 *                    updated / deleted, signed with the sealed secret) → log the test. A refusal marks "needs reconnect"; an
 *                    unreachable store stays "connecting" with the reason (the merchant sees it on Integrations).
 * Never logs or returns a key.
 */
import { parseWooCallback } from './woocommerce-map';
import { redact, type Rpc } from './runtime';
import { ConnectorError, type ConnectionRef } from './types';

export type WooConnectDeps = {
  rpc: Rpc;
  saveCredential: (connectionId: string, kind: 'consumer_key' | 'consumer_secret' | 'webhook_secret', value: string) => Promise<void>;
  readWebhookSecret: (connectionId: string) => Promise<string | null>;
  randomSecret: () => string;
  connector: {
    testConnection: (c: ConnectionRef) => Promise<{ ok: boolean; message: string }>;
    registerWebhooks: (c: ConnectionRef, deliveryUrl: string, secret: string) => Promise<string[]>;
    deleteWebhooks: (c: ConnectionRef, ids: string[]) => Promise<number>;
  };
  loadConnection: (id: string) => Promise<(ConnectionRef & { remoteWebhookIds: string[] }) | null>;
  /** https origin of this app (webhook delivery URL); null → no webhooks, the hourly pull still takes orders */
  site: string | null;
};

const dbCode = (e: unknown) => (e instanceof Error ? e.message.split(':')[0].trim() : '');

export async function acceptWooKeys(deps: WooConnectDeps, raw: string, contentType: string | null): Promise<{ status: 200 | 400 | 503; message: string; connectionId?: string }> {
  const p = parseWooCallback(raw, contentType);
  if ('error' in p) return { status: 400, message: p.error };
  let claim: { org_id: string; shop_domain: string; store_url: string | null };
  try {
    claim = (await deps.rpc('c2_connect_claim', { p_platform: 'woocommerce', p_state: p.state })) as typeof claim;
  } catch (e) {
    return dbCode(e) === 'INVALID_STATE' ? { status: 400, message: 'This connection request is unknown or expired. Start again from Octopus.' } : { status: 503, message: 'Try again.' };
  }
  let id: string;
  try {
    id = (await deps.rpc('c1_connection_upsert', {
      p_org: claim.org_id, p_platform: 'woocommerce', p_shop_domain: claim.shop_domain, p_store_url: claim.store_url, p_shop_name: null, p_currency: null,
      p_external_store_id: p.keyId ? `key:${p.keyId}` : null, p_scopes: ['read_write'],
    })) as string;
  } catch (e) {
    if (dbCode(e) === 'ALREADY_LINKED') return { status: 400, message: 'This store is already linked to another Octopus account.' };
    return { status: 503, message: 'Try again.' };
  }
  try {
    await deps.saveCredential(id, 'consumer_key', p.consumerKey);
    await deps.saveCredential(id, 'consumer_secret', p.consumerSecret);
    await deps.saveCredential(id, 'webhook_secret', deps.randomSecret());
  } catch {
    await deps.rpc('c1_connection_record_sync', { p_id: id, p_kind: 'test', p_ok: false, p_summary: 'The store keys could not be stored. Connect again.' }).catch(() => undefined);
    return { status: 503, message: 'Try again.' };
  }
  return { status: 200, message: 'ok', connectionId: id };
}

export async function finishWooConnect(deps: WooConnectDeps, connectionId: string): Promise<{ ok: boolean; message: string; webhooks: number }> {
  const conn = await deps.loadConnection(connectionId);
  if (!conn) return { ok: false, message: 'Store connection not found.', webhooks: 0 };
  try {
    const t = await deps.connector.testConnection(conn);
    if (!t.ok) throw new ConnectorError('PLATFORM_REFUSED', t.message);
    await deps.rpc('c1_connection_set_status', { p_id: conn.id, p_status: 'active', p_reason: null });
    let webhooks = 0;
    let note = '';
    if (deps.site) {
      const secret = await deps.readWebhookSecret(conn.id);
      if (!secret) throw new ConnectorError('INVALID_INPUT', 'The webhook secret is missing. Connect again.');
      if (conn.remoteWebhookIds.length) await deps.connector.deleteWebhooks(conn, conn.remoteWebhookIds);
      try {
        const ids = await deps.connector.registerWebhooks(conn, `${deps.site}/api/webhooks/connectors/woocommerce/${conn.id}`, secret);
        await deps.rpc('c2_connection_set_webhooks', { p_id: conn.id, p_ids: ids });
        webhooks = ids.length;
      } catch (e) {
        if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') throw e;
        // orders still arrive through the hourly check; the reason is shown, the store stays connected
        note = ` Instant order updates could not be set up (${redact(e)}); orders are checked every hour instead.`;
      }
    } else {
      note = ' Orders are checked every hour.';
    }
    const message = `${t.message}${webhooks ? ` ${webhooks} order update(s) set up.` : ''}${note}`.trim();
    await deps.rpc('c1_connection_record_sync', { p_id: conn.id, p_kind: 'test', p_ok: !note || webhooks > 0, p_summary: message });
    return { ok: true, message, webhooks };
  } catch (e) {
    const msg = dbCode(e) === 'PLAN_LIMIT' && e instanceof Error ? e.message.replace(/^PLAN_LIMIT:\s*/, '') : redact(e);
    if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') {
      await deps.rpc('c1_connection_set_status', { p_id: conn.id, p_status: 'needs_reconnect', p_reason: msg }).catch(() => undefined);
    }
    await deps.rpc('c1_connection_record_sync', { p_id: conn.id, p_kind: 'test', p_ok: false, p_summary: msg }).catch(() => undefined);
    return { ok: false, message: msg, webhooks: 0 };
  }
}
