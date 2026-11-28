'use server';

import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { rateLimit } from '@/lib/api/rate-limit';
import { getConnector } from '@/lib/connectors/registry';
import { normaliseStoreUrl } from '@/lib/connectors/signatures';
import { wooAuthorizeUrl } from '@/lib/connectors/woocommerce-map';

/**
 * CONN S2 · start connecting a store that approves access on the merchant's own admin (WooCommerce). Creates the single-use request
 * (c2_connect_start: role, plan limit, another account's store) and returns WooCommerce's approval address; the browser goes there,
 * the merchant approves read and write access, WooCommerce sends the keys to our callback and the merchant back to Integrations.
 * Nothing is stored here and no key passes through the browser.
 */
export type C2Result = { ok: true; url: string } | { ok: false; message: string };
const RETURN_PATHS = new Set(['/account/dropship/integrations', '/ods/account/dropship/integrations']);

export async function startStoreConnectAction(platform: string, storeUrl: string, returnPath: string): Promise<C2Result> {
  await requireDropshipV2Merchant('/account/dropship/integrations');
  if (platform !== 'woocommerce') return { ok: false, message: 'This platform does not connect this way yet.' };
  if (getConnector('woocommerce').status() !== 'ready') return { ok: false, message: 'WooCommerce connections open soon.' };
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\//.test(site)) return { ok: false, message: 'Store connections need the secure site address. Contact support.' };
  const s = await getSession();
  const rl = rateLimit(`store-connect:${s?.userId ?? 'anon'}`, 10, 10 * 60_000);
  if (!rl.ok) return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).` };
  const n = normaliseStoreUrl(typeof storeUrl === 'string' ? storeUrl : '');
  if ('error' in n) return { ok: false, message: n.error };
  const base = `https://${n.host}${n.path && n.path !== '/' ? n.path.replace(/\/+$/, '') : ''}`;
  const sb = await createClient();
  const { data, error } = await sb.rpc('c2_connect_start', { p_platform: 'woocommerce', p_shop_domain: n.host, p_store_url: base });
  if (error) return { ok: false, message: rpcMessage(error) };
  const state = (data as { state?: string } | null)?.state;
  if (!state) return { ok: false, message: 'The connection could not be started. Try again.' };
  const back = RETURN_PATHS.has(returnPath) ? returnPath : '/account/dropship/integrations';
  return {
    ok: true,
    url: wooAuthorizeUrl({
      storeUrl: base, state, appName: (process.env.CONNECTOR_APP_NAME || 'Octopus Dropship').slice(0, 60),
      returnUrl: `${site}${back}?connect=woocommerce`, callbackUrl: `${site}/api/webhooks/connect/woocommerce`,
    }),
  };
}
