import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { getConnector } from './registry';
import { STORE_PLATFORMS, type StorePlatform } from './platforms';
import { runConnectorSync, processInbox, type RuntimeDeps } from './runtime';
import type { ConnectionRef } from './types';
import { runPushJobs, runStockSync, type PushRuntimeDeps } from './push-runtime';
import { storeMediaUrl } from './media';
import type { WooCommerceConnector } from './woocommerce';
import type { WooCaller } from './woocommerce-push';

/**
 * CONN S1 · the service-role wiring of lib/connectors/runtime.ts. Only cron (/api/cron/connector-sync) and the connector webhook
 * route's after() call these; the browser never reaches them. Tracking companies come from carrier_tracking_names (staff-set per
 * carrier and platform; "Other" when unset), the tracking link from NEXT_PUBLIC_SITE_URL (no link when it is not set).
 */
export function serverRuntimeDeps(): RuntimeDeps {
  const sb = createAdminClient();
  const names = new Map<string, string>();
  return {
    rpc: async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args ?? {});
      if (error) throw new Error(error.message);
      return data;
    },
    getConnector: (id: StorePlatform) => getConnector(id),
    loadConnection: async (id) => {
      const { data, error } = await sb.from('store_connections').select('id, org_id, platform, shop_domain, store_url, status').eq('id', id).maybeSingle();
      if (error) throw new Error('The store connection could not be read.');
      if (!data || data.status === 'disconnected') return null;
      return { id: data.id, orgId: data.org_id, platform: data.platform, shopDomain: data.shop_domain, storeUrl: data.store_url } as ConnectionRef;
    },
    trackingCompany: async (carrier, platform) => {
      if (!carrier) return 'Other';
      const key = `${carrier}:${platform}`;
      if (!names.has(key)) {
        const { data } = await sb.from('carrier_tracking_names').select('company_name').eq('carrier', carrier).eq('platform', platform).maybeSingle();
        names.set(key, (data?.company_name as string | null) || 'Other');
      }
      return names.get(key)!;
    },
    fxToUsd: async (currency) => {
      const { data, error } = await sb.rpc('ds_fx_for', { p_currency: currency });
      if (error) throw new Error('The exchange rate could not be read.');
      const rate = Number((data as { rate?: number | string } | null)?.rate ?? NaN);
      // dropship_fx_rates keeps "units of the currency per 1 USD"; intake wants "1 unit = x USD"
      return Number.isFinite(rate) && rate > 0 ? 1 / rate : null;
    },
    resolveStoreVariants: async (connectionId, refs) => {
      const { data, error } = await sb.from('dropship_variant_links').select('variant_id, variant_gid, dropship_product_links!inner(store_connection_id, status)')
        .eq('dropship_product_links.store_connection_id', connectionId).in('variant_gid', refs.slice(0, 200));
      if (error) throw new Error('The pushed products could not be read.');
      return Object.fromEntries((data ?? []).map((r) => [r.variant_gid as string, r.variant_id as string]));
    },
    origin: (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '') || null,
  };
}

/** CONN S2b: the push queue + stock loops for non-Shopify stores */
export function serverPushDeps(): PushRuntimeDeps {
  const base = serverRuntimeDeps();
  const woo = getConnector('woocommerce') as WooCommerceConnector;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.CONNECTOR_TOKEN_KEY ?? '';
  return {
    rpc: base.rpc,
    loadConnection: base.loadConnection,
    wooCaller: (conn) => (async (method, path, body) => (await woo.json(conn, method, path, body)).data) as WooCaller,
    setStockStatus: (conn, items) => woo.setStockStatus(conn, items),
    media: (url) => storeMediaUrl(url, { site, supabaseUrl, key }),
  };
}
const wooReady = () => getConnector('woocommerce').status() === 'ready';
export async function connectorPushNow() {
  if (!wooReady()) return { push: null, stock: null };
  const deps = serverPushDeps();
  const push = await runPushJobs(deps).catch((e) => ({ picked: 0, ok: 0, failed: 0, errors: [String(e instanceof Error ? e.message : e).slice(0, 200)] }));
  const stock = await runStockSync(deps).catch((e) => ({ picked: 0, ok: 0, failed: 0, errors: [String(e instanceof Error ? e.message : e).slice(0, 200)] }));
  return { push, stock };
}

export const connectorSyncNow = async () => ({ ...(await runConnectorSync(serverRuntimeDeps(), STORE_PLATFORMS)), ...(await connectorPushNow()) });
export const connectorInboxNow = (limit = 10) => processInbox(serverRuntimeDeps(), limit);
