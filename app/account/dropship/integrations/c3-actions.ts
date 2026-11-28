'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/api/rate-limit';
import { connectKeyStore } from '@/lib/connectors/key-connect';
import { keyConnectDeps } from '@/lib/connectors/key-connect-server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';

/**
 * CONN S3 · connect a key-paste store (Magento 2 or PrestaShop). Re-checks the merchant session, rate-limits attempts,
 * validates via c2_connect_start, tests the pasted key against the store (SSRF-guarded) BEFORE sealing or storing anything,
 * then seals the secret in store_credentials and activates the connection. Never logs or returns the secret.
 */
export type C3Result = { ok: true; connectionId: string; platform: 'magento' | 'prestashop'; message: string } | { ok: false; message: string };
const PATH = '/account/dropship/integrations';

export async function connectKeyStoreAction(platform: string, storeUrl: string, secretKey: string): Promise<C3Result> {
  await requireDropshipV2Merchant(PATH);
  const s = await getSession();
  const rl = rateLimit(`store-connect:${s?.userId ?? 'anon'}`, 10, 10 * 60_000);
  if (!rl.ok) return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).` };
  const sb = await createClient();
  const res = await connectKeyStore(
    keyConnectDeps(async (fn, args = {}) => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    }),
    { platform, storeUrl, secretKey },
  );
  if (res.ok) {
    revalidatePath(PATH);
    revalidatePath(`/ods${PATH}`);
  }
  return res;
}
