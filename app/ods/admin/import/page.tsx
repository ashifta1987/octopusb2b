// ODS T9 · Catalogue › Bulk import. Replaces the T8 re-export of app/admin/import/page.tsx inside the ODS Back Office frame.
// Same guard (requireStaff('products','edit')), the same reads as today (import_runs, open review count, active suppliers),
// today's upload steps unchanged (createImportUploads → signed upload → stageImportRun). The template download is today's
// /admin/import/template route handler (never rewritten).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { firstOfMonth } from '../_catalogue/core';
import { ImportListLive } from './_components/import-list-live';
import type { RunRow, SupplierOpt } from './_components/import-list';

export const metadata = { title: 'Bulk import' };

async function ImportContent() {
  await requireStaff('products', 'edit', '/admin/import');
  const sb = await createClient();
  const [{ data: runs, error }, { count: openReview }, { data: suppliers }] = await Promise.all([
    sb.from('import_runs').select('id, name, status, created_at, committed_at, diff, report').order('created_at', { ascending: false }).limit(30),
    sb.from('import_review_items').select('id', { count: 'exact', head: true }).in('status', ['open', 'held']),
    sb.from('suppliers').select('id, code, legal_name, external_id').is('archived_at', null).order('code'),
  ]);
  return (
    <ImportListLive
      state="ok"
      runs={error ? null : ((runs ?? []) as RunRow[])}
      openReview={openReview ?? 0}
      suppliers={(suppliers ?? []) as SupplierOpt[]}
      defaultValidFrom={firstOfMonth(getNowMs())}
    />
  );
}

export default function ImportPage() {
  return (
    <Suspense fallback={<ImportListLive state="loading" runs={[]} openReview={0} suppliers={[]} defaultValidFrom="" />}>
      <ImportContent />
    </Suspense>
  );
}
