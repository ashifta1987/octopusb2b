import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getStaffSuppliers, type StaffSuppliers } from '@/lib/dropship-ds14';
import { SuppliersClient } from './suppliers-client';

export const metadata = { title: 'Suppliers · Back office' };

/**
 * AdminSuppliers.html, partner part: which suppliers ship for Octopus, their portal accounts, and the paid orders waiting to go to
 * a partner supplier. The full supplier records stay in Admin › Suppliers, applications in KYC review (links below). The DSers /
 * Alibaba source connection of the design is an external connection: shown as "not connected yet" (owner decision).
 */
async function Guarded() {
  const access = await requireDropshipV2Staff(false, '/office/dropship/suppliers');
  let data: StaffSuppliers | null = null;
  let error: string | null = null;
  try { data = await getStaffSuppliers(); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="staff-suppliers-page">
        <DsPageHeader title="Suppliers" icon="users" />
        <DsNotice tone="bad" title="Suppliers could not be loaded" testId="suppliers-error" action={<DsLinkButton href="/office/dropship/suppliers" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <SuppliersClient data={data} canEdit={access.canEdit} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
