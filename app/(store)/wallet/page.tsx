import type { Metadata } from 'next';
import { ExplainerPage } from '@/components/store/explainer';

export const metadata: Metadata = {
  title: 'Wallet and escrow — pay suppliers safely',
  description: 'Top up your Octopus B2B wallet by bank transfer, pay orders from it, and keep supplier payments in escrow until your goods pass QC and ship.',
  alternates: { canonical: '/wallet' },
};

/** ADDON-36 H4 — public explainer for the account wallet. */
export default function WalletExplainer() {
  return (
    <ExplainerPage e={{
      name: 'Wallet and escrow',
      h1: 'Pay suppliers safely with your wallet and escrow',
      intro: 'Top up once, then pay RFQ fees, samples, inspections and order deposits from one balance. Money for an order stays in escrow until the goods pass QC and ship.',
      next: '/account/wallet',
      points: [
        ['Top up by bank transfer', 'Send funds to our company bank account. Your wallet is credited once the transfer is matched.'],
        ['Deposit into escrow', 'When you accept a quote, the order deposit is held in escrow, not paid straight to the factory.'],
        ['Released after QC', 'The supplier is paid after inspection and shipping, so you are not paying for goods you have not seen checked.'],
        ['One statement', 'Every top-up, fee, deposit and refund is listed in your wallet ledger and on your invoices.'],
        ['Refunds back to the wallet', 'If a pool does not fill, your deposit returns to your balance.'],
      ],
    }} />
  );
}
