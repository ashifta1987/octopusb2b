import { Suspense } from 'react';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { can } from '@/lib/auth';
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
    target_landed_cents: r.target_landed_cents == null ? null : Number(r.target_landed_cents),
  }));
  // Processing is its own line on every landed quote (active fee version, first item)
  const fee = await sb.rpc('list_fee_versions');
  const activeFee = ((fee.data ?? []) as { status: string; pick_pack_first_cents: number }[]).find((f) => f.status === 'active');
  const processingCents = activeFee ? Number(activeFee.pick_pack_first_cents) : null;
  const canSeeSourcing = access.session.isAdmin || can(access.session, 'suppliers', 'view');
  return (
    <div className="flex flex-col gap-5" data-testid="staff-dropship-requests-page">
      <DsPageHeader
        title="Product requests"
        subtitle="Requests from Dropship merchants. Quote a landed cost; an accepted quote becomes a product only that merchant can see."
        icon="file"
        actions={rows.length > 0 ? <a className="ds-btn ds-btn-secondary" href="/office/dropship/requests/export" download>Export</a> : undefined}
      />
      <StaffDropshipRequestsClient rows={rows} canEdit={access.canEdit} canSeeSourcing={canSeeSourcing} processingCents={processingCents} />
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
