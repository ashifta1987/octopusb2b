import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import {
  StaffMerchantsClient,
  type StaffAccessRequestItem,
  type StaffMerchantItem,
} from './merchants-client';

export const metadata = { title: 'Merchants · Back office' };

async function Guarded() {
  const access = await requireDropshipV2Staff(false, '/office/dropship/merchants');
  const sb = await createClient();
  const { data, error } = await sb.rpc('list_dropship_merchants_staff');
  if (error) {
    throw new Error(`Could not load dropship merchants: ${error.message}`);
  }
  const payload = (data ?? {}) as {
    access_requests?: StaffAccessRequestItem[];
    merchants?: StaffMerchantItem[];
    can_edit?: boolean;
    can_propose_wallet_adjustment?: boolean;
  };

  return (
    <StaffMerchantsClient
      requests={payload.access_requests ?? []}
      merchants={payload.merchants ?? []}
      canEdit={Boolean(payload.can_edit ?? access.canEdit)}
      canProposeWalletAdjustment={Boolean(
        payload.can_propose_wallet_adjustment && !access.isSupportOnly,
      )}
    />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="ds-card">
          <DsSkeleton immediate />
        </div>
      }
    >
      <Guarded />
    </Suspense>
  );
}
