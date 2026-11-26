import { WalletView } from '@/components/account/wallet-view';

export const metadata = { title: 'Wallet' };

/** ADDON-41 — US dollar wallet (body in components/account/wallet-view.tsx, shared with the Dropship shell). */
export default async function WalletPage() {
  return <WalletView next="/account/wallet" />;
}
