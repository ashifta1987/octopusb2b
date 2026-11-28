import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { WalletFixture } from '../office-holds/_fixtures';
import { WALLET, SAMPLE_LIMIT } from '../office-holds/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-holds/_shared';

export const metadata: Metadata = { title: 'Wallets · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-wallets';
const STATES = ['list', 'credit', 'drawer', 'topups', 'second-approver', 'prices', 'settings', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 3): Admin › Wallets, SAMPLE data. ?state=list|credit|drawer|topups|second-approver|prices|settings|empty|error|loading|no-permission&role=admin|finance|sales */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'admin');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'list';
  const data =
    state === 'error'
      ? { ...WALLET, wallets: null, credit: null, topups: null, prices: null, spent: null, walletTotals: [], convertedTotal: null }
      : state === 'empty'
        ? { ...WALLET, wallets: [], credit: [], topups: [], prices: [], walletTotals: [], convertedTotal: null, topupsThisMonth: { totals: [], count: 0 }, spent: [], creditUsedMinor: 0 }
        : WALLET;
  return (
    <WalletFixture
      role={role}
      links={fixtureLinks(BASE, STATES, state, role)}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        data: state === 'loading' ? null : data,
        perms: { isAdmin: role === 'admin', canApproveTopups: role !== 'sales', canSeeRevenue: role !== 'sales' },
        approvalLimitMinor: SAMPLE_LIMIT,
        initialTab: state === 'credit' || state === 'drawer' ? 'credit' : state === 'topups' || state === 'second-approver' ? 'topups' : state === 'prices' ? 'prices' : state === 'settings' ? 'settings' : 'wallets',
        initialCredit: state === 'drawer' && role === 'admin',
        initialTopup: state === 'second-approver' ? { id: WALLET.topups![0].id, outcome: { kind: 'second-approver', code: 'APR-00043', message: 'Second approver needed (APR-00043).' } } : null,
      }}
    />
  );
}
