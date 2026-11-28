import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { StoreCarrierHealth } from './dropship-c5-shared';

export type { StoreCarrierHealth } from './dropship-c5-shared';

/** CONN S5 · Staff › System health: store connections in error, failed store updates, carrier accounts (c5_health_connectors). */
export async function getStoreCarrierHealth(): Promise<StoreCarrierHealth> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('c5_health_connectors');
  if (error) throw new Error(error.message);
  return data as StoreCarrierHealth;
}
