import { Suspense } from 'react';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { DropshipCsvImportClient } from './import-client';

export const metadata = { title: 'CSV bulk import · Dropshipping · Back office' };

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6 animate-pulse">Loading CSV import…</div>}>
      <CsvImportPage />
    </Suspense>
  );
}

async function CsvImportPage() {
  await requireDropshipStaff(true);
  return <DropshipCsvImportClient />;
}
