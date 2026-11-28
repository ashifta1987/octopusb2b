// ODS T9 · Catalogue › Bulk import › run (preview / committed). Replaces the T8 re-export of app/admin/import/[id]/page.tsx
// inside the ODS Back Office frame. Same guard (requireStaff('products','edit', …)), the same reads as today (import_runs row,
// portal_products() for the committed products' hidden listing status, the supplier by external id), today's
// commitImportRun / discardImportRun / submitImportRun unchanged.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { portalProducts } from '@/components/backoffice/hidden-columns';
import type { StagingBatch } from '@/lib/import/types';
import type { ImportDiff } from '@/lib/import/core';
import { commitImportRun, discardImportRun, submitImportRun } from '@/app/admin/import/actions';
import { draftCount } from '../../_catalogue/core';
import { ImportRunScreen } from '../_components/import-run';

export const metadata = { title: 'Import preview' };

const ACTIONS = { commit: commitImportRun, discard: discardImportRun, submit: submitImportRun };
type Props = { params: Promise<{ id: string }> };

async function RunContent({ params }: Props) {
  const { id } = await params;
  const s = await requireStaff('products', 'edit', `/admin/import/${id}`);
  const sb = await createClient();
  const { data: run } = await sb.from('import_runs').select('*').eq('id', id).maybeSingle();
  if (!run) notFound();
  const batch = run.staging as StagingBatch;
  const committed = run.status === 'committed';
  const { data: liveStatus } = committed ? await portalProducts(sb).select('sku, status, listing_status').in('sku', batch.products.map((x) => x.external_id)) : { data: [] };
  const statusOf = new Map(((liveStatus ?? []) as { sku: string; status: string; listing_status: string | null }[]).map((x) => [x.sku, x.status]));
  const listingOf = new Map(((liveStatus ?? []) as { sku: string; status: string; listing_status: string | null }[]).map((x) => [x.sku, x.listing_status]));
  const { data: sup } = await sb.from('suppliers').select('id, code, identity_status').eq('external_id', batch.supplier.external_id).maybeSingle();
  return (
    <ImportRunScreen
      state="ok"
      canEdit={can(s, 'products', 'edit')}
      actions={ACTIONS}
      data={{
        id,
        name: String(run.name),
        status: String(run.status),
        created_at: String(run.created_at),
        committed_at: (run.committed_at as string | null) ?? null,
        error: (run.error as string | null) ?? null,
        batch,
        diff: run.diff as ImportDiff,
        report: (run.report as Record<string, Record<string, number>> | null) ?? null,
        statusOf: Object.fromEntries(statusOf),
        listingOf: Object.fromEntries(listingOf),
        drafts: draftCount(statusOf, listingOf),
        submitResults: ((run.submit_report as { results?: Record<string, string> } | null)?.results ?? {}) as Record<string, string>,
        supplier: sup ? { id: sup.id as string, code: sup.code as string, identity_status: (sup.identity_status as string | null) ?? null } : null,
      }}
    />
  );
}

export default function ImportRunPage(props: Props) {
  return (
    <Suspense fallback={<ImportRunScreen state="loading" data={null} canEdit={false} actions={ACTIONS} />}>
      <RunContent {...props} />
    </Suspense>
  );
}
