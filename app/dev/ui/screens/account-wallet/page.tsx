import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WalletPageView } from '@/app/ods/account/wallet/_components/wallet-view';
import { parseWalletParams } from '@/app/ods/account/wallet/_lib/wallet-logic';
import { CommerceFixture, pick } from '../account-orders/_fixture';
import { SAMPLE_WALLET_ERRORS, SAMPLE_WALLET_NEW, SAMPLE_WALLET_OFF, SAMPLE_WALLET_VM } from '../account-orders/_samples';
import { sampleSubmitTransfer } from '../account-orders/fixture-actions';

export const metadata: Metadata = { title: 'Wallet · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-wallet';
const STATES = [
  ['available', 'Available'],
  ['held', 'Held'],
  ['due', 'Invoices due'],
  ['new', 'Brand-new customer'],
  ['wallet-off', 'Wallet switched off'],
  ['errors', 'Panels failed'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** /account/wallet with SAMPLE props (?state=; ?view= and ?period= also work). The transfer form never sends. */
export default function WalletFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const base = parseWalletParams(sp);
  const state = current === 'held' ? { ...base, view: 'held' as const } : current === 'due' ? { ...base, view: 'due' as const } : base;
  const w = current === 'new' ? SAMPLE_WALLET_NEW : current === 'errors' ? SAMPLE_WALLET_ERRORS : current === 'wallet-off' ? SAMPLE_WALLET_OFF : SAMPLE_WALLET_VM;
  return (
    <CommerceFixture path="/account/wallet" base={BASE} states={STATES} current={current}>
      <WalletPageView state={state} status={current === 'loading' ? 'loading' : 'ready'} wallet={w} submitTransfer={sampleSubmitTransfer} base={BASE} demo />
    </CommerceFixture>
  );
}
