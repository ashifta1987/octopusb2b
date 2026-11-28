import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { saveCredential } from './credentials';
import { getConnector } from './registry';
import { serverRuntimeDeps } from './runtime-server';
import type { KeyConnectDeps, KeyStoreConnector } from './key-connect';
import type { Rpc } from './runtime';
import type { StorePlatform } from './platforms';
import type { ConnectionRef } from './types';

/** CONN S3 · service-role wiring for Magento 2 and PrestaShop key-paste connections (server only). */
export function keyConnectDeps(userRpc?: Rpc): KeyConnectDeps {
  const sb = createAdminClient();
  const base = serverRuntimeDeps();
  return {
    userRpc: userRpc ?? (async () => { throw new Error('FORBIDDEN: Merchant session required.'); }),
    adminRpc: base.rpc,
    saveCredential: (id, kind, value) => saveCredential(id, kind, value),
    connector: (platform) => getConnector(platform) as unknown as KeyStoreConnector,
    loadConnection: async (id) => {
      const { data, error } = await sb.from('store_connections').select('id, org_id, platform, shop_domain, store_url, status').eq('id', id).maybeSingle();
      if (error) throw new Error('The store connection could not be read.');
      if (!data || data.status === 'disconnected') return null;
      return {
        id: data.id as string,
        orgId: data.org_id as string,
        platform: data.platform as StorePlatform,
        shopDomain: data.shop_domain as string,
        storeUrl: (data.store_url as string | null) ?? null,
      } satisfies ConnectionRef;
    },
  };
}
