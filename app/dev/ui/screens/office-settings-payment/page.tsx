import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { PaymentMatrixAndProvidersClient } from '@/app/admin/settings/payment/matrix-client';
import { SettingsShell } from '@/app/ods/office/_components/admin-c-company';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_ENTITIES, SAMPLE_MATRIX, SAMPLE_PROVIDERS } from '../office-staff/sample-data';

export const metadata: Metadata = { title: 'Payment settings · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [['default', 'Finance / Admin (can edit)'], ['view-only', 'Finance role, no edit'], ['restricted', 'Not company-wide Finance']] as const;
const BASE = '/dev/ui/screens/office-settings-payment';
const SUB = 'Manage the 3 payment options per service (Pay now, Payment protection, Pay later), online payment providers (Stripe, Airwallex, Mock), legal entities, and company bank accounts.';

/**
 * Staging-only fixture (T9 batch 5): /admin/settings/payment. TODAY's matrix / providers / legal entities client with
 * SAMPLE rows (its save buttons call today's guarded actions, which refuse without a staff session). The bank accounts
 * panel is today's server component that reads live data, so the fixture shows a placeholder for it.
 */
export default function FixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = STATES.find(([s]) => s === raw)?.[0] ?? 'default';
  const canEdit = state === 'default';
  return (
    <OfficeScreenFrame pathname="/admin/settings/payment" role="finance">
      <FixtureStates label="Fixture states (sample data)" links={STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {state === 'restricted' ? (
        <SettingsShell crumb="Admin › Payment settings" title="Payment settings" sub={SUB} testId="settings-payment-page" notice="Payment settings are restricted to company-wide Admin and company-wide Finance staff." />
      ) : (
        <SettingsShell crumb="Admin › Payment settings" title="Payment settings" sub={SUB} testId="settings-payment-page" notice={canEdit ? undefined : 'View only: editing needs the Finance · edit permission.'}>
          <div className="rounded-ods-card border border-dashed border-ods-line-strong bg-ods-surface p-ods-pad-card text-ods-small text-ods-slate" data-testid="bank-accounts-placeholder">
            Bank accounts — today&apos;s panel (reads the live company bank accounts; not shown in this fixture).
          </div>
          <div className="ods-legacy-section min-w-0">
            <PaymentMatrixAndProvidersClient matrix={SAMPLE_MATRIX} providers={SAMPLE_PROVIDERS} entities={SAMPLE_ENTITIES as never[]} canEdit={canEdit} isAdmin={false} />
          </div>
        </SettingsShell>
      )}
    </OfficeScreenFrame>
  );
}
