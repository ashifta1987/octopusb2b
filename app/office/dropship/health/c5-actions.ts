'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getConnector } from '@/lib/connectors/registry';
import { isKeyConnectPlatform, retestKeyConnection } from '@/lib/connectors/key-connect';
import { keyConnectDeps } from '@/lib/connectors/key-connect-server';
import { finishWooConnect } from '@/lib/connectors/woocommerce-connect';
import { wooConnectDeps } from '@/lib/connectors/woocommerce-server';

/**
 * CONN S5 · System health actions (Dropship editors and admins; every database function checks again).
 *  - Retry a store connection: the database says whether this staff member may (c5_connection_retry_check, audited); the server
 *    then re-tests with the store's sealed keys (service role) and records the result. Staff never see a key.
 *    Supports WooCommerce (S2) plus Magento 2 and PrestaShop (S3).
 *  - Contact merchant: an in-app message with the problem and a link to Integrations.
 *  - Retry a failed store update (tracking / cancellation answer): back in the queue from zero (c1_task_retry).
 */
export type C5Result = { ok: true; message: string } | { ok: false; message: string };
const PATH = '/office/dropship/health';
const Id = z.string().uuid();

async function staffRpc(fn: string, args: Record<string, unknown>) {
  await requireDropshipV2Staff(false, PATH);
  const sb = await createClient();
  return sb.rpc(fn, args);
}

export async function retryConnectionAction(id: string): Promise<C5Result> {
  if (!Id.safeParse(id).success) return { ok: false, message: 'This store was not found.' };
  const { data, error } = await staffRpc('c5_connection_retry_check', { p_id: id });
  if (error) return { ok: false, message: rpcMessage(error) };
  const platform = (data as { platform: string }).platform;
  revalidatePath(PATH);
  if (platform === 'woocommerce' && getConnector('woocommerce').status() === 'ready') {
    const r = await finishWooConnect(wooConnectDeps(), id);
    return r.ok ? { ok: true, message: `The store answered: ${r.message}` } : { ok: false, message: `Still failing: ${r.message}` };
  }
  if (isKeyConnectPlatform(platform) && getConnector(platform).status() === 'ready') {
    const r = await retestKeyConnection(keyConnectDeps(), id);
    return r.ok ? { ok: true, message: `The store answered: ${r.message}` } : { ok: false, message: `Still failing: ${r.message}` };
  }
  return { ok: false, message: 'This platform is not switched on on this server, so the store can\'t be tested. Contact the merchant instead.' };
}

export async function contactMerchantAction(id: string): Promise<C5Result> {
  if (!Id.safeParse(id).success) return { ok: false, message: 'This store was not found.' };
  const { error } = await staffRpc('c5_notify_merchant', { p_connection: id });
  revalidatePath(PATH);
  return error ? { ok: false, message: rpcMessage(error) } : { ok: true, message: 'The merchant got a message with the problem and a link to Integrations.' };
}

export async function retryStoreTaskAction(id: string): Promise<C5Result> {
  if (!Id.safeParse(id).success) return { ok: false, message: 'This update was not found.' };
  const { error } = await staffRpc('c1_task_retry', { p_id: id });
  revalidatePath(PATH);
  return error ? { ok: false, message: rpcMessage(error) } : { ok: true, message: 'Back in the queue. It is sent within 5 minutes.' };
}
