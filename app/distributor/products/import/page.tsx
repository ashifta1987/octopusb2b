import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Notice } from '@/components/ui';
import { ActionForm, RunButton } from '@/components/backoffice/action-form';
import { FileDrop } from '@/components/client';
import { IMPORT_COLUMNS, type ImportData } from '@/components/backoffice/import-columns';
import { usd, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { validateImport, importValidRows, submitImported } from './actions';

export const metadata = { title: 'Bulk upload (Excel)' };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job: jobId } = await searchParams;
  const s = (await getSession())!;
  const sb = await createClient();
  const [{ data: history }, jobRes] = await Promise.all([
    sb.from('import_jobs').select('id, file_name, status, total_rows, valid_rows, error_rows, created_at, suppliers(code)').eq('created_by', s.userId).order('created_at', { ascending: false }).limit(15),
    jobId ? sb.from('import_jobs').select('id, file_name, status, total_rows, valid_rows, error_rows, created_at').eq('id', jobId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const job = jobRes.data;
  const { data: rows } = job ? await sb.from('import_rows').select('id, row_no, data, errors, product_id').eq('job_id', job.id).order('row_no') : { data: null };
  const importable = (rows ?? []).filter((r) => !r.errors && !r.product_id).length;
  const imported = (rows ?? []).filter((r) => r.product_id).length;
  const step = !job ? 1 : job.status === 'validated' ? 3 : 4;
  const steps = ['Get template', 'Upload', 'Check results', 'Import'];

  return (
    <>
      <PageHeader title="Bulk upload (Excel)" subtitle="Add hundreds of products at once. Fill in the template, upload it, fix any rows we flag, then import." />
      <ol className="grid grid-cols-4 gap-3 mb-6" aria-label="Progress">
        {steps.map((t, i) => (
          <li key={t} aria-current={i + 1 === step ? 'step' : undefined}>
            <div className={cn('h-1 rounded-full', i + 1 <= step ? 'bg-blue' : 'bg-line')} />
            <div className={cn('mt-2 text-sm', i + 1 <= step ? 'font-semibold text-navy' : 'text-muted')}>{i + 1} · {t}</div>
          </li>
        ))}
      </ol>

      <div className="grid lg:grid-cols-2 gap-6 mb-6 items-start">
        <Card title="1 · Get the template">
          <div className="px-6 pb-6">
            <p className="text-sm text-muted">One row per product. Sheets: <b>Products</b>, <b>Lists</b> (drop-downs for category, supplier, unit, Incoterm) and <b>Instructions</b>.</p>
            <a href="/distributor/products/import/template" className="btn btn-primary mt-4">Download template (.xlsx)</a>
            <div className="mt-4 border border-line rounded-[10px] overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr><th className="th">Column</th><th className="th">Required</th></tr></thead>
                <tbody>
                  {IMPORT_COLUMNS.map((c) => (
                    <tr key={c.key}>
                      <td className="px-4 py-2 border-b border-line"><span className="mono font-semibold">{c.key}</span><div className="text-xs text-muted">{c.note}</div></td>
                      <td className="px-4 py-2 border-b border-line"><StatusBadge status={c.required ? 'rejected' : 'draft'} label={c.required ? 'Required' : 'Optional'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card title="2 · Upload">
          <div className="px-6 pb-6">
            <ActionForm action={validateImport} submitLabel="Upload and check">
              <FileDrop name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hint="Drop your .xlsx file here · up to 2,000 rows and 10 MB" />
            </ActionForm>
            <p className="text-xs text-muted mt-3">Each row is checked for: missing title, unknown category or supplier, supplier not assigned to you, product upload switched off, bad numbers and tier quantities that don&apos;t go up.</p>
          </div>
        </Card>
      </div>

      {job && (
        <Card className="mb-6" title={<>3 · Check results <span className="mono text-sm text-muted font-normal">· {job.file_name}</span></>}
          action={<StatusBadge status={job.status === 'validated' ? 'in_review' : job.status === 'imported' ? 'completed' : 'submitted'} label={job.status} />}>
          <div className="px-6 pb-4 flex flex-wrap gap-3 items-center">
            <span className="text-sm"><b>{job.total_rows}</b> rows · <span className="text-ok font-semibold">{(rows ?? []).filter((r) => !r.errors).length} valid</span> · <span className="text-bad font-semibold">{(rows ?? []).filter((r) => r.errors).length} with errors</span> · {imported} imported</span>
            <span className="flex-1" />
            {importable > 0 && <RunButton className="btn btn-primary btn-sm" action={importValidRows.bind(null, job.id)} confirm={`Import ${importable} valid rows as draft products?`}>Import {importable} valid rows as drafts</RunButton>}
            {imported > 0 && job.status !== 'submitted' && <RunButton className="btn btn-dark btn-sm" action={submitImported.bind(null, job.id)} confirm={`Submit ${imported} imported drafts for moderation?`}>Submit all for moderation</RunButton>}
          </div>
          {importable === 0 && imported === 0 && <div className="px-6 pb-4"><Notice tone="amber">No valid rows to import. Fix the errors in your file and upload it again.</Notice></div>}
          <Table head={['Row', 'Title', 'Supplier', 'Category', 'MOQ', 'Tiers', 'Result']}>
            {(rows ?? []).map((r) => {
              const d = r.data as ImportData;
              const errs = (r.errors ?? []) as string[];
              return (
                <tr key={r.id} className={errs.length ? 'bg-[#FDF6F6]' : undefined}>
                  <td className="td mono text-sm">{r.row_no}</td>
                  <td className="td text-sm">{d.title || <span className="text-muted">—</span>}</td>
                  <td className="td mono text-sm">{d.supplier_code}</td>
                  <td className="td text-sm">{d.category_path}</td>
                  <td className="td text-sm">{d.moq ?? '—'} {d.unit}</td>
                  <td className="td text-xs mono">{d.tiers.map((t) => `${t.min_qty}+ ${usd(t.unit_price_cents)}`).join(' · ')}</td>
                  <td className="td text-sm">
                    {errs.length ? <ul className="text-bad text-xs list-disc pl-4">{errs.map((e) => <li key={e}>{e}</li>)}</ul>
                      : r.product_id ? <Link href={`/distributor/products/${r.product_id}/edit`} className="text-ok font-semibold text-xs">✓ Imported · edit</Link>
                        : <span className="text-ok text-xs font-semibold">✓ Valid</span>}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      <Card title="Upload history">
        <Table head={['Job', 'File', 'Supplier', 'Date', 'Result', '']} empty={<EmptyState title="No uploads yet" body="Download the template, fill it in and upload it above." />}>
          {(history ?? []).map((h) => (
            <tr key={h.id}>
              <td className="td mono text-sm">JOB-{h.id.slice(0, 6).toUpperCase()}</td>
              <td className="td mono text-sm">{h.file_name}</td>
              <td className="td mono text-sm">{(Array.isArray(h.suppliers) ? h.suppliers[0] : h.suppliers)?.code ?? 'Multiple'}</td>
              <td className="td text-sm">{fmtDate(h.created_at)}</td>
              <td className="td"><StatusBadge status={h.error_rows ? 'pending' : 'completed'} label={`${h.status} · ${h.valid_rows} valid${h.error_rows ? ` · ${h.error_rows} errors` : ''}`} /></td>
              <td className="td text-right"><Link className="btn btn-ghost btn-sm" href={`/distributor/products/import?job=${h.id}`}>Report</Link></td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
