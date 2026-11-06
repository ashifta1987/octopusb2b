import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { ImportUploadForm } from './upload-form';

export const metadata = { title: 'Bulk import' };

type Run = { id: string; name: string; status: string; created_at: string; committed_at: string | null; diff: Record<string, { create?: number; update?: number; skip?: number; total?: number }>; report: Record<string, { create?: number }> | null };

/** Admin → Bulk import (ADDON-27): supplier workbook + photo ZIP → preview → review → commit as drafts. */
export default async function ImportPage() {
  await requireStaff('products', 'edit', '/admin/import');
  const sb = await createClient();
  const [{ data: runs }, { count: openReview }] = await Promise.all([
    sb.from('import_runs').select('id, name, status, created_at, committed_at, diff, report').order('created_at', { ascending: false }).limit(30),
    sb.from('import_review_items').select('id', { count: 'exact', head: true }).in('status', ['open', 'held']),
  ]);
  const now = new Date();
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

  return (
    <>
      <PageHeader title="Bulk import" subtitle="Load a supplier's products, tiered prices and photos from one workbook. You see every change before it is written; new products arrive as drafts."
        actions={openReview ? <Link href="/admin/import/review" className="btn btn-ghost">Review queue ({openReview})</Link> : undefined} />
      <Card title="New import" className="mb-6">
        <div className="px-6 pb-6"><ImportUploadForm defaultValidFrom={firstOfMonth} /></div>
      </Card>
      <Card title="Import runs">
        <Table head={['Import', 'Status', 'Products', 'Prices', 'Images', 'Review items', 'Started']} empty={<EmptyState title="No imports yet" body="Upload a supplier workbook above to start." />}>
          {((runs ?? []) as Run[]).map((r) => {
            const d = r.status === 'committed' && r.report ? r.report : r.diff;
            return (
              <tr key={r.id}>
                <td className="td font-semibold"><Link href={`/admin/import/${r.id}`} className="text-blue hover:underline">{r.name}</Link></td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td mono text-sm">{d?.products?.create ?? 0} new · {(d?.products as { update?: number })?.update ?? 0} upd</td>
                <td className="td mono text-sm">{d?.prices?.create ?? 0} new · {(d?.prices as { update?: number })?.update ?? 0} upd</td>
                <td className="td mono text-sm">{d?.images?.create ?? 0}</td>
                <td className="td mono text-sm">{r.status === 'committed' ? (r.report?.review?.create ?? 0) : (r.diff?.review?.total ?? 0)}</td>
                <td className="td text-sm text-muted">{fmtDate(r.created_at, true)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

