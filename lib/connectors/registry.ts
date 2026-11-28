import 'server-only';
import { PLATFORMS, type StorePlatform } from './platforms';
import { matchSignature } from './signatures';
import { tokenBoxConfigured } from '@/lib/crypto/token-box';
import { readCredential } from './credentials';
import { WooCommerceConnector } from './woocommerce';
import { MagentoConnector } from './magento';
import { PrestaShopConnector } from './prestashop';
import {
  ConnectorError, type Connector, type ConnectorId, type ConnectorStatus, type ConnectionRef, type InternalProduct, type InternalShipment,
  type PullResult, type PushResult, type StartConnectResult, type TestResult,
} from './types';

/**
 * C0 · Connector registry.
 *  - WooCommerce → WooCommerceConnector (CONN S2 / S2b);
 *  - Magento 2 → MagentoConnector (CONN S3, pasted access token);
 *  - PrestaShop → PrestaShopConnector (CONN S3, pasted Webservice key);
 *  - Shopify, Wix, BigCommerce, OpenCart (uses CSV file), eBay, TikTok Shop, Amazon, Walmart, Etsy →
 *    NotConfiguredConnector ("not configured" while their env keys are missing, "not built" once keys exist);
 *  - CSV → the file connector that works now (orders in through ds_order_intake channel 'csv'; product feed + tracking files out).
 * The registry never returns a value of a secret; missingEnv() lists NAMES only.
 */
const missing = (names: string[], env: NodeJS.ProcessEnv = process.env) => names.filter((n) => !env[n] || (n === 'CONNECTOR_TOKEN_KEY' && !tokenBoxConfigured(env)));

class NotConfiguredConnector implements Connector {
  constructor(readonly id: StorePlatform, readonly name: string, private readonly envNames: string[]) {}
  missingEnv(): string[] { return missing(this.envNames); }
  status(): ConnectorStatus { return this.missingEnv().length ? 'not_configured' : 'not_built'; }
  private refuse(): never {
    const m = this.missingEnv();
    throw m.length
      ? new ConnectorError('NOT_CONFIGURED', `${this.name} is not configured on this server yet (missing: ${m.join(', ')}). Connections open in the store-connection release.`)
      : new ConnectorError('NOT_BUILT', `${this.name} connections open in the store-connection release.`);
  }
  detect(page: Parameters<Connector['detect']>[0]): string[] | null {
    const m = matchSignature(page);
    return m && m.platform === this.id ? m.evidence : null;
  }
  async startConnect(): Promise<StartConnectResult> { return this.refuse(); }
  async finishConnect(): Promise<ConnectionRef> { return this.refuse(); }
  async testConnection(): Promise<TestResult> { return this.refuse(); }
  async pushProduct(): Promise<PushResult> { return this.refuse(); }
  async pullOrders(): Promise<PullResult> { return this.refuse(); }
  async sendTracking(): Promise<{ ok: boolean }> { return this.refuse(); }
  async syncStock(): Promise<{ ok: boolean; failed: string[] }> { return this.refuse(); }
  async syncPrice(): Promise<{ ok: boolean; failed: string[] }> { return this.refuse(); }
  async disconnect(): Promise<void> { return this.refuse(); }
}

/**
 * The file connector. There is no remote store: "pull orders" is the merchant's upload (lib/connectors/csv.ts → c0_csv_orders_import →
 * ds_order_intake channel 'csv'), "push product" is a row of the product feed CSV, "send tracking" is a row of the tracking CSV.
 * Live sync of stock / prices is not possible for a file.
 */
class CsvConnector implements Connector {
  readonly id = 'csv' as const;
  readonly name = 'CSV file';
  status(): ConnectorStatus { return 'ready'; }
  missingEnv(): string[] { return []; }
  detect(): null { return null; }
  async startConnect(): Promise<StartConnectResult> { return { kind: 'form', fields: [] }; }
  async finishConnect(): Promise<ConnectionRef> { throw new ConnectorError('NOT_SUPPORTED', 'A CSV file needs no connection.'); }
  async testConnection(): Promise<TestResult> { return { ok: true, message: 'Files work without a connection.' }; }
  async pushProduct(_c: ConnectionRef, p: InternalProduct): Promise<PushResult> {
    return { ok: true, message: `${p.variants.length} row(s) in the product feed file.` };
  }
  async pullOrders(): Promise<PullResult> { throw new ConnectorError('NOT_SUPPORTED', 'Upload an orders CSV on Integrations › File import.'); }
  async sendTracking(_c: ConnectionRef, s: InternalShipment): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: `${s.trackingNumbers.length} tracking number(s) in the tracking file.` };
  }
  async syncStock(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_SUPPORTED', 'Stock can\'t be synced to a file. Download a new product feed.'); }
  async syncPrice(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_SUPPORTED', 'Prices can\'t be synced to a file. Download a new product feed.'); }
  async disconnect(): Promise<void> { /* nothing to disconnect */ }
}

const REGISTRY = new Map<ConnectorId, Connector>();
for (const p of PLATFORMS) {
  if (p.kind === 'regional') continue;
  REGISTRY.set(p.key as StorePlatform, new NotConfiguredConnector(p.key as StorePlatform, p.name, p.env));
}
REGISTRY.set('csv', new CsvConnector());
// CONN S2: WooCommerce (merchant-approved keys; ready once CONNECTOR_TOKEN_KEY and CONNECTOR_WOOCOMMERCE=on are set)
REGISTRY.set('woocommerce', new WooCommerceConnector({
  keys: async (id) => {
    const [k, s] = await Promise.all([readCredential(id, 'consumer_key'), readCredential(id, 'consumer_secret')]);
    return k && s ? { consumerKey: k.value, consumerSecret: s.value } : null;
  },
}));
// CONN S3: Magento 2 and PrestaShop (merchant-pasted keys; ready once CONNECTOR_TOKEN_KEY and CONNECTOR_MAGENTO/PRESTASHOP=on are set)
REGISTRY.set('magento', new MagentoConnector({
  key: async (id) => (await readCredential(id, 'access_token'))?.value ?? null,
}));
REGISTRY.set('prestashop', new PrestaShopConnector({
  key: async (id) => (await readCredential(id, 'api_key'))?.value ?? null,
}));

export function getConnector(id: ConnectorId): Connector {
  const c = REGISTRY.get(id);
  if (!c) throw new ConnectorError('INVALID_INPUT', 'Unknown platform.');
  return c;
}

/** For the staff health card: status + missing env NAMES per platform (never values). */
export function connectorStatuses(): { id: ConnectorId; name: string; status: ConnectorStatus; missingEnv: string[] }[] {
  return [...REGISTRY.values()].map((c) => ({ id: c.id, name: c.name, status: c.status(), missingEnv: c.missingEnv() }));
}
