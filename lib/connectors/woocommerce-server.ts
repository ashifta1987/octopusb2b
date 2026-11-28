import 'server-only';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { readCredential, saveCredential } from './credentials';
import { getConnector } from './registry';
import { serverRuntimeDeps } from './runtime-server';
import type { WooCommerceConnector } from './woocommerce';
import type { WooConnectDeps } from './woocommerce-connect';
import type { StorePlatform } from './platforms';

/** CONN S2 · service-role wiring for the WooCommerce key callback (server only). */
export function wooConnectDeps(): WooConnectDeps {
  const sb = createAdminClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  return {
    rpc: serverRuntimeDeps().rpc,
    saveCredential: (id, kind, value) => saveCredential(id, kind, value),
    readWebhookSecret: async (id) => (await readCredential(id, 'webhook_secret'))?.value ?? null,
    randomSecret: () => crypto.randomBytes(32).toString('base64url'),
    connector: getConnector('woocommerce') as WooCommerceConnector,
    loadConnection: async (id) => {
      const { data, error } = await sb.from('store_connections').select('id, org_id, platform, shop_domain, store_url, status, remote_webhook_ids').eq('id', id).maybeSingle();
      if (error) throw new Error('The store connection could not be read.');
      if (!data || data.status === 'disconnected') return null;
      return {
        id: data.id as string, orgId: data.org_id as string, platform: data.platform as StorePlatform, shopDomain: data.shop_domain as string,
        storeUrl: (data.store_url as string | null) ?? null, remoteWebhookIds: ((data.remote_webhook_ids as string[] | null) ?? []),
      };
    },
    // webhooks need a public https address; a local / http server gets the hourly pull only
    site: /^https:\/\//.test(site) ? site : null,
  };
}
