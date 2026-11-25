import { Suspense } from 'react';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { StaffDropshipRequestsClient, type StaffDropshipRequest } from './requests-staff-client';

export const metadata = { title: 'Product requests · Back office' };

async function Guarded() {
  const access = await requireDropshipV2Staff(false, '/office/dropship/requests');
  const sb = await createClient();
  const { data, error } = await sb.rpc('list_dropship_product_requests', { p_status: null });
  if (error) throw new Error(`Could not load product requests: ${error.message}`);
  const rows = ((data ?? []) as StaffDropshipRequest[]).map((r) => ({
    ...r,
    quoted_landed_cents: r.quoted_landed_cents == null ? null : Number(r.quoted_landed_cents),
  }));
  return (
    <div className="flex flex-col gap-5" data-testid="staff-dropship-requests-page">
      <DsPageHeader
        title="Product requests"
        subtitle="Merchants ask Octopus to source a product. Send a landed price per unit; the merchant accepts it and gets a private draft."
        icon="file"
      />
      <StaffDropshipRequestsClient rows={rows} canEdit={access.canEdit} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
