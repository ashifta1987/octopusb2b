import { DsNotice } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getStoreCarrierHealth, type StoreCarrierHealth } from '@/lib/dropship-c5';
import { StoreCarrierHealthClient } from './c5-health-client';

/** CONN S5 · Staff › System health: store connections in error, failed store updates, carrier accounts and failures. */
export async function StoreAndCarrierHealthCard() {
  let data: StoreCarrierHealth | null = null;
  let error: string | null = null;
  try { data = await getStoreCarrierHealth(); } catch (e) { error = rpcMessage(e); }
  if (!data) return <DsNotice tone="bad" title="Store and carrier health could not be loaded" testId="c5-health-error">{error}</DsNotice>;
  return <StoreCarrierHealthClient data={data} />;
}
