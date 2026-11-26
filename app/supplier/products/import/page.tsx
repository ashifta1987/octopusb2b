import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { SupplierFrame } from '../../frame';
import { ImportClient } from './import-client';

export const metadata = { title: 'Bulk upload · Supplier portal' };

/** SupplierBulkUpload.html: download template → fill in → upload → fix errors → submit the good rows. CSV (the spreadsheet is saved as CSV). */
async function Guarded() {
  return <ImportClient />;
}

export default function Page() {
  return (
    <Suspense fallback={<SupplierFrame testId="supplier-import-page"><div className="ds-card"><DsSkeleton immediate /></div></SupplierFrame>}>
      <Guarded />
    </Suspense>
  );
}
