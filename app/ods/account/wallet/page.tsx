import { Suspense } from 'react';
import type { Metadata } from 'next';
import { submitTransfer } from '@/app/account/wallet/actions';
import type { SearchParamsRecord } from '../orders/_lib/commerce-format';
import { parseWalletParams } from './_lib/wallet-logic';
import { loadWallet } from './_lib/loaders';
import { WalletPageView } from './_components/wallet-view';

export const metadata: Metadata = { title: 'Wallet', robots: { index: false, follow: false } };

/**
 * ODS /account/wallet (Part 6.7). URL state: ?view=available|held|due (CardTabs), ?period=month|quarter|year (Segmented).
 * Money action: TODAY's submitTransfer (app/account/wallet/actions.ts → submit_bank_transfer) after the slip upload, as
 * today. Bank details: getCompanyBankAccount('USD') (Admin › Payment settings). No card top-up and no online withdrawal
 * exist today, so none are offered. Statements: today's /account/ledger and /account/ledger/statement.
 */
export default function OdsWalletPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<WalletPageView state={parseWalletParams({})} status="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const state = parseWalletParams(await searchParams);
  const wallet = await loadWallet(state.period);
  return <WalletPageView state={state} status="ready" wallet={wallet} submitTransfer={submitTransfer} />;
}
