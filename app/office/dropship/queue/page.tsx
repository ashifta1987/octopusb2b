import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'Fulfilment queue · Back office' };

async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/queue');
  return (
    <DsPageHeader
      title="Fulfilment queue"
      subtitle="/office/dropship/queue · paid store orders ready to pick, pack, label and hand over, plus exceptions."
      icon="list"
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
