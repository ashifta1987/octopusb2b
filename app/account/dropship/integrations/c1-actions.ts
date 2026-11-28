'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getConnector } from '@/lib/connectors/registry';
import type { WooCommerceConnector } from '@/lib/connectors/woocommerce';

/**
 * CONN S1 · merchant actions on connected stores. Disconnect runs as the signed-in user (c1_connection_disconnect checks the
 * organisation, the setup role and the stores feature); the sealed keys are wiped by the database (trg_c0_connection_wipe) and open
 * store updates for that store are closed. Server Functions are reachable by direct POST, so the session is checked again here.
 * CONN S2: a WooCommerce store's webhooks are removed from the store first (best effort, 8 s), while the keys still exist.
 * CONN S3: Magento and PrestaShop tell the merchant where to revoke/delete the key in their own store admin.
 */
export type C1Result = { ok: true; message: string } | { ok: false; message: string };
const PATH = '/account/dropship/integrations';

async function removeRemoteWebhooks(row: { id: string; org_id: string; platform: string; shop_domain: string; store_url: string | null; remote_webhook_ids: string[] | null }) {
  if (row.platform !== 'woocommerce' || !row.remote_webhook_ids?.length) return;
  const c = getConnector('woocommerce') as WooCommerceConnector;
  if (c.status() !== 'ready') return;
  const work = c.deleteWebhooks({ id: row.id, orgId: row.org_id, platform: 'woocommerce', shopDomain: row.shop_domain, storeUrl: row.store_url }, row.remote_webhook_ids);
  await Promise.race([work.catch(() => 0), new Promise((r) => setTimeout(r, 8_000))]);
}

export async function disconnectStoreAction(id: string): Promise<C1Result> {
  await requireDropshipV2Merchant(PATH);
  const p = z.string().uuid().safeParse(id);
  if (!p.success) return { ok: false, message: 'Store not found.' };
  const sb = await createClient();
  // read as the merchant (RLS: own organisation only) — only then are the store's keys used to tidy up
  const { data: row } = await sb.from('store_connections').select('id, org_id, platform, shop_domain, store_url, status, remote_webhook_ids').eq('id', p.data).maybeSingle();
  if (row && row.status !== 'disconnected') await removeRemoteWebhooks(row);
  const { data, error } = await sb.rpc('c1_connection_disconnect', { p_id: p.data, p_reason: 'Disconnected by the merchant' });
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath(PATH);
  revalidatePath(`/ods${PATH}`);
  const tail = row?.platform === 'woocommerce'
    ? ' You can also delete the Octopus key in WooCommerce › Settings › Advanced › REST API.'
    : row?.platform === 'magento'
      ? ' You can also revoke the Octopus integration in Magento › System › Extensions › Integrations.'
      : row?.platform === 'prestashop'
        ? ' You can also delete the Octopus key in PrestaShop › Advanced Parameters › Webservice.'
        : '';
  return { ok: true, message: (data as { already?: boolean } | null)?.already ? 'This store was already disconnected.' : `Store disconnected. We no longer send or read anything there.${tail}` };
}
