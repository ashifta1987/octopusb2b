import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'Merchants · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/merchants');
  return (
    <DsPageHeader
      title="Merchants"
      subtitle="/office/dropship/merchants · active dropship merchants, selling countries, connected stores and access requests."
      icon="users"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
