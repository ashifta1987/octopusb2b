import WalletPage from '@/app/account/wallet/page';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Wallet · Octopus Dropship' };

/**
 * Step U1 Rule 2: Renders the SAME shared wallet component and data inside the Dropship shell.
 * Sidebar and phone Wallet tab point here; /account/wallet stays as it is for the rest of the account.
 */
export default async function DropshipWalletPage() {
  await requireDropshipV2Merchant('/account/dropship/wallet');
  return <WalletPage />;
}
