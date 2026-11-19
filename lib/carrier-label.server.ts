import 'server-only';
import { createPublicClient } from '@/lib/supabase/server';
import { CARRIER_SETTING_KEYS, customerCarrierLabel, DEFAULT_CUSTOMER_CARRIER } from '@/lib/carrier-label';

/** Reads the two public site settings and returns the carrier name a customer may see. */
export async function getCustomerCarrierLabel(): Promise<string> {
  try {
    const { data } = await createPublicClient().from('site_settings').select('key, value').in('key', [...CARRIER_SETTING_KEYS]);
    const raw: Record<string, unknown> = {};
    (data ?? []).forEach((r) => (raw[r.key as string] = r.value));
    return customerCarrierLabel(raw);
  } catch {
    return DEFAULT_CUSTOMER_CARRIER;
  }
}
