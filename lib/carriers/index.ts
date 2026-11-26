import 'server-only';
import { FourPxAdapter, fourPxCredentials } from './fourpx';
import { SandboxCarrierAdapter } from './sandbox';
import { CarrierError, type CarrierAccountRef, type CarrierAdapter } from './types';

/**
 * Warehouse OS · W4 — the adapter for a warehouse carrier account (switchable per account: sandbox on staging, live where the
 * server has the credentials). Never returns a sandbox adapter outside staging and never invents a live label.
 */
export function getCarrierAdapter(a: Pick<CarrierAccountRef, 'carrier' | 'mode' | 'credentialEnv'>): CarrierAdapter {
  if (a.mode === 'sandbox') return new SandboxCarrierAdapter(a.carrier);
  if (a.carrier === '4px') return new FourPxAdapter(a.credentialEnv);
  // YunExpress live labels for Warehouse OS: the B2B YunExpress adapter (lib/adapters) is not reused here (different account,
  // waybill fields); connect it in a later step.
  throw new CarrierError('NOT_BUILT', 'YunExpress live labels are not connected in Warehouse OS yet. Use the sandbox account on staging.');
}

/** Are this account's credentials present on the server? (names only — values are never read out) */
export function credentialsPresent(a: Pick<CarrierAccountRef, 'carrier' | 'mode' | 'credentialEnv'>): boolean {
  if (a.mode === 'sandbox') return process.env.APP_ENVIRONMENT === 'staging';
  if (a.carrier === '4px') return fourPxCredentials(a.credentialEnv) !== null;
  return Boolean(a.credentialEnv && process.env[`${a.credentialEnv}_APP_KEY`] && process.env[`${a.credentialEnv}_APP_SECRET`]);
}

export { CarrierError } from './types';
export type { CarrierAdapter, LabelRequest, LabelResult } from './types';
