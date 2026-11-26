import { Suspense } from 'react';
import { WalletView } from '@/components/account/wallet-view';
import { DsNotice } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getWalletDs, type WalletDsData } from '@/lib/dropship-orders';
import { DsWalletPanel } from './wallet-panel';

export const metadata = { title: 'Wallet · Octopus Dropship' };

/**
 * Step U1 Rule 2: the SAME shared wallet (components/account/wallet-view.tsx) inside the Dropship shell.
 * Release 3 · Step 8 (screens/Wallet.html, mobile/M_Wallet.html, states/States-Money.html): when Orders is switched on, the
 * two balances (Available, Held for protected orders) and "How new orders are paid" sit right under the balance. Pay later
 * appears only for credit_eligible organisations (ds_wallet_get returns null for everyone else). In early access (Orders
 * off) the page is the plain top-up wallet, as before.
 */
async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/wallet');
  let ds: WalletDsData | null = null;
  let error: string | null = null;
  try {
    ds = await getWalletDs();
  } catch (e) {
    error = rpcMessage(e);
  }
  const slot = ds?.orders_on
    ? <DsWalletPanel data={ds} />
    : error
      ? <div className="mb-6"><DsNotice tone="bad" title="Order payment settings could not be loaded" testId="ds-wallet-error">{error}</DsNotice></div>
      : null;
  return (
    <div className="ds-wallet" data-testid="ds-wallet-page">
      <WalletView next="/account/dropship/wallet" subtitle="Your Octopus wallet, in US dollars. The same wallet as the rest of your Octopus account." slot={slot} />
    </div>
  );
}

export default function DropshipWalletPage() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
