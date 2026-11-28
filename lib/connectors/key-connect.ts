/**
 * CONN S3 · server-side connection and re-test orchestration for key-paste connectors (Magento 2 and PrestaShop).
 * Pure orchestration with injected dependencies (unit-tested with fakes; wired in lib/connectors/key-connect-server.ts).
 *
 * Flow on connectKeyStore:
 *   1. Validate platform, store address (SSRF-safe normaliseStoreUrl) and secret key shape.
 *   2. Run c2_connect_start as the merchant user (checks setup role, plan limit, ALREADY_LINKED, rate limit; returns single-use state).
 *   3. Test the key against the store BEFORE anything is sealed or stored in store_connections / store_credentials.
 *   4. Only if testKey passes: claim state once (c2_connect_claim) → upsert connection → seal key → activate → log test.
 * Never logs, echoes or returns any key or token.
 */
import type { CredentialKind } from './credentials';
import { normaliseStoreUrl } from './signatures';
import { redact, type Rpc } from './runtime';
import { ConnectorError, type ConnectionRef, type ConnectorStatus } from './types';

export type KeyConnectPlatform = 'magento' | 'prestashop';
export const isKeyConnectPlatform = (p: string): p is KeyConnectPlatform => p === 'magento' || p === 'prestashop';

export const KEY_CREDENTIAL_KIND: Record<KeyConnectPlatform, CredentialKind> = {
  magento: 'access_token',
  prestashop: 'api_key',
};

export const KEY_SCOPES: Record<KeyConnectPlatform, string[]> = {
  magento: ['Magento_Sales::sales', 'Magento_Backend::stores'],
  prestashop: ['orders:read', 'addresses:read', 'countries:read', 'currencies:read', 'configurations:read', 'order_carriers:write'],
};

export type KeyStoreConnector = {
  status: () => ConnectorStatus;
  testKey: (storeUrl: string, key: string) => Promise<{ ok: boolean; message: string; currency: string | null }>;
  testConnection: (conn: ConnectionRef) => Promise<{ ok: boolean; message: string }>;
};

export type KeyConnectDeps = {
  /** merchant-scoped RPC (calls c2_connect_start with auth.uid()) */
  userRpc: Rpc;
  /** service-role RPC (c2_connect_claim, c1_connection_upsert, c1_connection_set_status, c1_connection_record_sync) */
  adminRpc: Rpc;
  saveCredential: (connectionId: string, kind: CredentialKind, value: string) => Promise<void>;
  connector: (platform: KeyConnectPlatform) => KeyStoreConnector;
  loadConnection: (id: string) => Promise<ConnectionRef | null>;
};

export type KeyConnectResult =
  | { ok: true; connectionId: string; platform: KeyConnectPlatform; message: string }
  | { ok: false; message: string };

const dbCode = (e: unknown) => (e instanceof Error ? e.message.split(':')[0].trim() : '');
const cleanDbError = (e: unknown) => {
  if (e instanceof Error) {
    const idx = e.message.indexOf(':');
    const code = e.message.slice(0, idx).trim();
    if (/^[A-Z_]+$/.test(code) && idx !== -1) {
      const rest = e.message.slice(idx + 1).trim();
      if (rest) return redact(rest);
    }
  }
  return redact(e);
};

export async function connectKeyStore(
  deps: KeyConnectDeps,
  input: { platform: string; storeUrl: string; secretKey: string },
): Promise<KeyConnectResult> {
  if (!isKeyConnectPlatform(input.platform)) return { ok: false, message: 'This platform does not connect with a pasted key.' };
  const platform = input.platform;
  const connector = deps.connector(platform);
  if (connector.status() !== 'ready') {
    return { ok: false, message: `${platform === 'magento' ? 'Magento' : 'PrestaShop'} connections open soon.` };
  }

  const n = normaliseStoreUrl(typeof input.storeUrl === 'string' ? input.storeUrl : '');
  if ('error' in n) return { ok: false, message: n.error };
  const base = `https://${n.host}${n.path && n.path !== '/' ? n.path.replace(/\/+$/, '') : ''}`;

  const key = typeof input.secretKey === 'string' ? input.secretKey.trim() : '';
  if (key.length < 8 || key.length > 2048 || /[\r\n\0]/.test(key)) {
    return { ok: false, message: platform === 'magento' ? 'Paste the Magento integration access token.' : 'Paste the PrestaShop Webservice key.' };
  }

  // 1. Pre-check role, plan limit, ALREADY_LINKED and rate limit; create single-use state
  let state: string | null = null;
  try {
    const res = (await deps.userRpc('c2_connect_start', { p_platform: platform, p_shop_domain: n.host, p_store_url: base })) as { state?: string } | null;
    state = res?.state ?? null;
  } catch (e) {
    return { ok: false, message: cleanDbError(e) };
  }
  if (!state) return { ok: false, message: 'The connection could not be started. Try again.' };

  // 2. Test the pasted key against the store BEFORE anything is stored or sealed
  let tested: { ok: boolean; message: string; currency: string | null };
  try {
    tested = await connector.testKey(base, key);
    if (!tested.ok) return { ok: false, message: tested.message || 'The store refused the key.' };
  } catch (e) {
    return { ok: false, message: redact(e) };
  }

  // 3. Claim state → create/update connection → seal credential → activate → record test
  let claim: { org_id: string; shop_domain: string; store_url: string | null };
  try {
    claim = (await deps.adminRpc('c2_connect_claim', { p_platform: platform, p_state: state })) as typeof claim;
  } catch (e) {
    return { ok: false, message: dbCode(e) === 'INVALID_STATE' ? 'This connection request expired. Try again.' : 'Could not save the connection. Try again.' };
  }

  let connectionId: string;
  try {
    connectionId = (await deps.adminRpc('c1_connection_upsert', {
      p_org: claim.org_id,
      p_platform: platform,
      p_shop_domain: claim.shop_domain,
      p_store_url: claim.store_url,
      p_shop_name: null,
      p_currency: tested.currency,
      p_external_store_id: null,
      p_scopes: KEY_SCOPES[platform],
    })) as string;
  } catch (e) {
    return { ok: false, message: dbCode(e) === 'ALREADY_LINKED' ? 'This store is already linked to another Octopus account.' : cleanDbError(e) };
  }

  try {
    await deps.saveCredential(connectionId, KEY_CREDENTIAL_KIND[platform], key);
  } catch {
    await deps.adminRpc('c1_connection_record_sync', {
      p_id: connectionId, p_kind: 'test', p_ok: false, p_summary: 'The store key could not be stored. Connect again.',
    }).catch(() => undefined);
    return { ok: false, message: 'The store key could not be saved on the server. Try again.' };
  }

  try {
    await deps.adminRpc('c1_connection_set_status', { p_id: connectionId, p_status: 'active', p_reason: null });
    await deps.adminRpc('c1_connection_record_sync', { p_id: connectionId, p_kind: 'test', p_ok: true, p_summary: tested.message });
  } catch (e) {
    const msg = cleanDbError(e);
    await deps.adminRpc('c1_connection_record_sync', { p_id: connectionId, p_kind: 'test', p_ok: false, p_summary: msg }).catch(() => undefined);
    return { ok: false, message: msg };
  }

  return { ok: true, connectionId, platform, message: tested.message };
}

/** CONN S3 / S5: staff System health Retry re-tests a key-paste connection using its sealed credential. */
export async function retestKeyConnection(deps: Pick<KeyConnectDeps, 'adminRpc' | 'connector' | 'loadConnection'>, connectionId: string): Promise<{ ok: boolean; message: string }> {
  const conn = await deps.loadConnection(connectionId);
  if (!conn || !isKeyConnectPlatform(conn.platform)) return { ok: false, message: 'Store connection not found.' };
  const connector = deps.connector(conn.platform);
  if (connector.status() !== 'ready') {
    return { ok: false, message: 'This platform is not switched on on this server, so the store can\'t be tested. Contact the merchant instead.' };
  }
  try {
    const t = await connector.testConnection(conn);
    if (!t.ok) throw new ConnectorError('PLATFORM_REFUSED', t.message);
    await deps.adminRpc('c1_connection_set_status', { p_id: conn.id, p_status: 'active', p_reason: null });
    await deps.adminRpc('c1_connection_record_sync', { p_id: conn.id, p_kind: 'test', p_ok: true, p_summary: t.message });
    return { ok: true, message: t.message };
  } catch (e) {
    const msg = cleanDbError(e);
    if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') {
      await deps.adminRpc('c1_connection_set_status', { p_id: conn.id, p_status: 'needs_reconnect', p_reason: msg }).catch(() => undefined);
    }
    await deps.adminRpc('c1_connection_record_sync', { p_id: conn.id, p_kind: 'test', p_ok: false, p_summary: msg }).catch(() => undefined);
    return { ok: false, message: msg };
  }
}
