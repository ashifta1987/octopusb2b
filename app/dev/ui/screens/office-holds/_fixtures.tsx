'use client';

import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { HoldsScreen, type HoldsScreenProps } from '@/app/ods/admin/finance/holds/_components/holds-screen';
import { CreditScreen, type CreditScreenProps } from '@/app/ods/admin/finance/credit/_components/credit-screen';
import { TransfersScreen, type TransfersScreenProps } from '@/app/ods/admin/finance/transfers/_components/transfers-screen';
import { SaasScreen, type SaasScreenProps } from '@/app/ods/admin/finance/saas/_components/saas-screen';
import { WalletScreen, type WalletScreenProps } from '@/app/ods/admin/wallet/_components/wallet-screen';
import { amountToMinor, runTwoPersonPayment } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import type { SampleRole } from '../office-dashboard/sample-data';
import { SAMPLE_LIMIT } from './sample-data';

type Links = { href: string; text: string; current: boolean }[];
const SAMPLE = ' (sample — nothing was saved)';
const ok = (message: string) => async () => ({ ok: true as const, message: message + SAMPLE });
/** The REAL two-person order with sample steps (above the sample limit → "Second approver needed"). */
const gate = (minor: number, code: string, message: string) =>
  runTwoPersonPayment({
    ready: async () => ({ ok: true, data: null }),
    request: async () => (minor > SAMPLE_LIMIT ? { ok: true, data: { required: true, id: 'sample', code } } : { ok: true, data: { required: false } }),
    execute: async () => ({ ok: true, message: message + SAMPLE }),
    markExecuted: async () => ({ ok: true, data: null }),
  });

function Frame({ role, pathname, links, children }: { role: SampleRole; pathname: string; links: Links; children: React.ReactNode }) {
  return (
    <OfficeScreenFrame role={role} pathname={pathname}>
      <FixtureStates label="Fixture states (sample data)" links={links} />
      {children}
    </OfficeScreenFrame>
  );
}

export function HoldsFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<HoldsScreenProps, 'actions' | 'fixture'> }) {
  return (
    <Frame role={role} pathname="/admin/finance/holds" links={links}>
      <HoldsScreen {...screen} fixture actions={{ act: async (fd) => ({ ok: true, requiresSecondApprover: Number(fd.get('amount_cents')) > screen.thresholdCents }), decide: async () => ({ ok: true }) }} />
    </Frame>
  );
}

export function CreditFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<CreditScreenProps, 'actions' | 'fixture'> }) {
  return (
    <Frame role={role} pathname="/admin/finance/credit" links={links}>
      <CreditScreen {...screen} fixture actions={{ propose: async () => ({ ok: true }), decide: async () => ({ ok: true }), statement: async () => ({ ok: true, statementNumber: 'STMT-DS-2026-W48-0009', invoiceCount: 11, sampleCount: 1 }) }} />
    </Frame>
  );
}

export function TransfersFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<TransfersScreenProps, 'actions' | 'fixture'> }) {
  return (
    <Frame role={role} pathname="/admin/finance/transfers" links={links}>
      <TransfersScreen
        {...screen}
        fixture
        actions={{
          confirm: async (i) => gate(amountToMinor(i.received), 'APR-00041', 'Confirmed. The wallet is credited and a receipt was issued.'),
          reject: ok('Rejected. The customer sees the reason.'),
          proforma: async (i) => gate(amountToMinor(i.amount), 'APR-00042', `${i.number.toUpperCase()} fully paid — tax invoice issued.`),
        }}
      />
    </Frame>
  );
}

export function SaasFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<SaasScreenProps, 'actions' | 'fixture'> }) {
  return (
    <Frame role={role} pathname="/admin/finance/saas" links={links}>
      <SaasScreen
        {...screen}
        fixture
        actions={{ proposeSwitch: ok('Proposed'), decideSwitch: ok('Decided'), withdrawSwitch: ok('Withdrawn'), setOverride: ok('Override saved'), removeOverride: ok('Override removed'), proposePlan: ok('Plan proposed'), decidePlan: ok('Plan decided') }}
      />
    </Frame>
  );
}

export function WalletFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<WalletScreenProps, 'actions' | 'fixture'> }) {
  return (
    <Frame role={role} pathname="/admin/wallet" links={links}>
      <WalletScreen
        {...screen}
        fixture
        actions={{
          setWallet: ok('Wallet setting saved'),
          saveCreditDefault: ok('Default credit limit saved'),
          saveCustomerCredit: ok('Customer credit limit saved'),
          saveSettings: ok('Settings saved'),
          confirmTopup: async (id) => gate(id.endsWith('61') ? 300_000 : 50_000, 'APR-00043', 'Top-up credited.'),
        }}
      />
    </Frame>
  );
}
