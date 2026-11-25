import { Suspense } from 'react';
import {
  getMyDropshipOnboardingState,
  requireDropshipV2Merchant,
} from '@/lib/dropship';
import { DsSkeleton } from '@/components/dropship-ui';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { OnboardingClient } from './onboarding-client';

export const metadata = { title: 'Set up Octopus Dropship · Onboarding' };

async function OnboardingContent({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  await requireDropshipV2Merchant('/account/dropship/onboarding');
  const sp = await searchParams;
  const [state, features] = await Promise.all([getMyDropshipOnboardingState(), getDropshipFeatures()]);
  const initialStep = Number(sp.step ?? 1);
  return (
    <OnboardingClient
      state={state}
      initialStep={Number.isInteger(initialStep) ? initialStep : 1}
      storeStep={features.stores}
    />
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <OnboardingContent searchParams={searchParams} />
    </Suspense>
  );
}
