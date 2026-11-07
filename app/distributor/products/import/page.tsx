import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Notice } from '@/components/ui';
import { RunButton } from '@/components/backoffice/action-form';
import { IMPORT_COLUMNS, type ImportData } from '@/components/backoffice/import-columns';
import { money, fmtDate, productStatusView } from '@/lib/format';
import { cn } from '@/lib/cn';
import { importValidRows, submitImported, confirmCostPrices } from './actions';
import { ImportUploader } from './uploader';
import { supplierScope } from '@/lib/distributor/supplier-scope';

export const metadata = { title: 'Bulk upload (Excel)' };

const MODE: Record<string, { label: string; tone: string }> = {
  create: { label: 'Create', tone: 'text-blue' }, update: { label: 'Update', tone: 'text-warn' }, unchanged: { label: 'No change', tone: 'text-muted' },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ job?: string; supplier?: string }> }) {
  const { job: jobId, supplier: supplierParam } = await searchParams;
  const s = (await getSession())!;
  const { selected } = await supplierScope(s, supplierParam);   // unassigned code → 404
  const supQ = selected ? `?supplier=${encodeURIComponent(selected.code)}` : '';
  const sb = await createClient();
  const [{ data: history }, jobRes] = await Promise.all([
    sb.from('import_jobs').select('id, file_name, status, total_rows, valid_rows, error_rows, created_at, suppliers(code)').eq('created_by', s.userId).order('created_at', { ascending: false }).limit(15),
    jobId ? sb.from('import_jobs').select('id, file_name, status, total_rows, valid_rows, error_rows, unchanged_rows, zip_path, zip_unreferenced, submit_report, cost_flagged_rows, cost_confirmed_at, created_at').eq('id', jobId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const job = jobRes.data;
  const { data: rows } = job ? await sb.from('import_rows').select('id, row_no, data, errors, warnings, product_id, submit_error, products(status, listing_status)').eq('job_id', job.id).order('row_no') : { data: null };
  const pendingRows = (rows ?? []).filter((r) => !r.errors && !r.product_id);
  const importable = pendingRows.filter((r) => (r.data as ImportData).mode !== 'unchanged').length;
  const creates = pendingRows.filter((r) => (r.data as ImportData).mode !== 'update' && (r.data as ImportData).mode !== 'unchanged').length;
  const updates = pendingRows.filter((r) => (r.data as ImportData).mode === 'update').length;
  const imported = (rows ?? []).filter((r) => r.product_id).length;
  const prod = (r: { products?: unknown }) => (Array.isArray(r.products) ? r.products[0] : r.products) as { status?: string; listing_status?: string | null } | null;
  const pstatus = (r: { products?: unknown }) => prod(r)?.status ?? null;
  const submittable = (rows ?? []).filter((r) => r.product_id && !r.errors && ['draft', 'rejected'].includes(pstatus(r) ?? '')).length;
  const failedSubmit = (rows ?? []).filter((r) => r.submit_error).length;
  const catChanges = (rows ?? []).filter((r) => !r.errors && !r.product_id && (r.data as ImportData).diff?.some((x) => x.field === 'category')).length;
  const step = !job ? 1 : job.status === 'validated' ? 3 : 4;
  const steps = ['Get template', 'Upload sheet + images', 'Check results', 'Import'];
  const extra = (job?.zip_unreferenced ?? []) as string[];

  return (
    <>
      <PageHeader title={selected ? `Bulk upload · ${selected.code} · ${selected.legal_name}` : 'Bulk upload (Excel)'}
        eyebrow={selected ? <Link href="/distributor/products/import" className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-white px-3 py-1 text-[13px] font-semibold hover:border-navy"><span aria-hidden>×</span> All suppliers</Link> : undefined}
        subtitle="Create or update hundreds of products at once. Every product has a platform-wide unique SKU: a new SKU creates a product, a SKU you already own updates it." />
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" aria-label="Progress">
        {steps.map((t, i) => (
          <li key={t} aria-current={i + 1 === step ? 'step' : undefined}>
            <div className={cn('h-1 rounded-full', i + 1 <= step ? 'bg-blue-fill' : 'bg-line')} />
            <div className={cn('mt-2 text-sm', i + 1 <= step ? 'font-semibold text-navy' : 'text-muted')}>{i + 1} · {t}</div>
          </li>
        ))}
      </ol>

      <div className="grid lg:grid-cols-2 gap-6 mb-6 items-start">
        <Card title="1 · Get the template">
          <div className="px-6 pb-6">
            <p className="text-sm text-muted">One row per product. <b>sku</b> is column A and required; up to three photos per product in <b>image_file</b>, <b>image_file_2</b>, <b>image_file_3</b> (file names inside a .zip you upload in step 2).</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <a href="/distributor/products/import/template" className="btn btn-primary">Download template (.xlsx)</a>
              <a href={`/distributor/products/import/export${supQ}`} className="btn btn-ghost">Download my products{selected ? ` (${selected.code})` : ''}</a>
            </div>
            <form action="/distributor/products/import/fill-skus" method="post" encType="multipart/form-data" className="mt-5 rounded-[10px] border border-line p-4 space-y-2">
              <div className="font-semibold text-sm">Generate SKUs</div>
              <p className="text-xs text-muted">Left some SKUs blank? Upload your filled template and get it back with a free SKU on every row that has none — category code + running number (e.g. FST-000124), checked against every SKU ever used on the platform.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <input type="file" name="file" required accept=".xlsx" aria-label="Filled template for SKU generation" className="text-sm" />
                <button type="submit" className="btn btn-dark btn-sm">Generate SKUs</button>
              </div>
            </form>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">All {IMPORT_COLUMNS.length} columns</summary>
              <div className="mt-2 border border-line rounded-[10px] overflow-hidden">
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
            </details>
          </div>
        </Card>

        <Card title="2 · Upload sheet + images">
          <div className="px-6 pb-6">
            {selected && <p className="text-sm mb-3" data-testid="upload-scope">Uploading for <b className="mono">{selected.code}</b>: rows with a blank <span className="mono">supplier_code</span> are assigned to it, rows for another supplier are rejected.</p>}
            <ImportUploader supplier={selected?.code ?? null} />
            <p className="text-xs text-muted mt-3">Nothing is saved until you confirm. Each row is checked for: SKU (blank, format, repeated in the file, used by another supplier), missing title, unknown category or supplier, supplier not assigned to you, bad numbers, tiers that don&apos;t go up, and image names missing from the zip.</p>
          </div>
        </Card>
      </div>

      {job && (
        <Card className="mb-6" title={<>3 · Check results <span className="mono text-sm text-muted font-normal">· {job.file_name}</span></>}
          action={<StatusBadge status={job.status === 'validated' ? 'in_review' : job.status === 'imported' ? 'completed' : 'submitted'} label={job.status} />}>
          <div className="px-6 pb-4 flex flex-wrap gap-3 items-center">
            <span className="text-sm" data-testid="import-summary"><b>{job.total_rows}</b> rows · <span className="text-blue font-semibold">{creates} new</span> · <span className="text-warn font-semibold">{updates} updates</span> · <span className="text-muted">{(rows ?? []).filter((r) => (r.data as ImportData).mode === 'unchanged' && !r.errors).length} unchanged</span> · <span className="text-bad font-semibold">{(rows ?? []).filter((r) => r.errors).length} with errors</span> · {imported} imported</span>
            <span className="flex-1" />
            {importable > 0 && !((job.cost_flagged_rows ?? 0) > 0 && !job.cost_confirmed_at) && <RunButton className="btn btn-primary btn-sm" action={importValidRows.bind(null, job.id)} confirm={`Save ${creates} new products (drafts) and ${updates} updates?`}>Confirm and import {importable}</RunButton>}
            {submittable > 0 && <RunButton className="btn btn-dark btn-sm" action={submitImported.bind(null, job.id)} confirm={`Submit ${submittable} products of this job for moderation?`}>Submit {submittable} for moderation</RunButton>}
          </div>
          {catChanges > 0 && <div className="px-6 pb-4" data-testid="category-change-notice"><Notice tone="amber"><b>{catChanges} product{catChanges === 1 ? '' : 's'} will move to another category</b> (highlighted below). Check before importing — leave the category cell blank to keep the current category.</Notice></div>}
          {(job.cost_flagged_rows ?? 0) > 0 && (
            <div className="px-6 pb-4" data-testid="cost-flag">
              {job.cost_confirmed_at
                ? <Notice tone="amber">{job.cost_flagged_rows} row{job.cost_flagged_rows === 1 ? '' : 's'} had prices equal to the supplier cost — confirmed on {fmtDate(job.cost_confirmed_at, true)}.</Notice>
                : <Notice tone="red"><b>{job.cost_flagged_rows} row{job.cost_flagged_rows === 1 ? '' : 's'}: price equals supplier cost, buyer price not applied.</b> The prices in these rows are the supplier&apos;s cost, so buyers would pay cost with no margin. Fix the sheet and upload it again, or confirm that these really are the buyer prices.
                    <div className="mt-2"><RunButton className="btn btn-ghost btn-sm" action={confirmCostPrices.bind(null, job.id)} confirm="Confirm that these prices are the buyer prices (no margin over supplier cost)?">I confirm these prices</RunButton></div></Notice>}
            </div>
          )}
          {failedSubmit > 0 && <div className="px-6 pb-4"><Notice tone="red">{failedSubmit} product{failedSubmit === 1 ? '' : 's'} could not be submitted for moderation — the reason is shown on each row. Fix it and press Submit again.</Notice></div>}
          {importable === 0 && imported === 0 && <div className="px-6 pb-4"><Notice tone="amber">Nothing to import: fix the errors in your file and upload it again (rows without changes are skipped).</Notice></div>}
          {extra.length > 0 && <div className="px-6 pb-4"><Notice tone="blue">{extra.length} file{extra.length === 1 ? '' : 's'} in the zip {extra.length === 1 ? 'is' : 'are'} not used by any row and will be ignored: {extra.slice(0, 20).join(', ')}{extra.length > 20 ? ' …' : ''}</Notice></div>}
          <Table head={['Row', 'SKU', 'Title', 'Supplier', 'Tiers', 'Action', 'Result']}>
            {(rows ?? []).map((r) => {
              const d = r.data as ImportData;
              const errs = (r.errors ?? []) as string[];
              const warns = (r.warnings ?? []) as string[];
              const m = MODE[d.mode ?? 'create'];
              return (
                <tr key={r.id} className={errs.length ? 'bg-[#FDF6F6]' : undefined} data-testid="import-row" data-row={r.row_no}>
                  <td className="td mono text-sm">{r.row_no}</td>
                  <td className="td mono text-xs">{d.sku || <span className="text-bad">—</span>}</td>
                  <td className="td text-sm">{d.title || <span className="text-muted">—</span>}<div className="text-xs text-muted">{d.category_path}</div></td>
                  <td className="td mono text-sm">{d.supplier_code}</td>
                  <td className="td text-xs mono">{d.tiers.map((t) => `${t.min_qty}+ ${money(t.unit_price_cents, d.currency ?? 'USD')}`).join(' · ')}</td>
                  <td className={cn('td text-sm font-semibold', m.tone)}>{errs.length ? '—' : m.label}
                    {!errs.length && d.diff?.some((x) => x.field === 'category') && <div><span className="inline-block mt-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#FFF3D6] text-[#8A5A00]" data-testid="category-change">Category change</span></div>}
                    {d.diff && d.diff.length > 0 && (
                      <details className="font-normal"><summary className="cursor-pointer text-xs text-blue">{d.diff.length} change{d.diff.length === 1 ? '' : 's'}</summary>
                        <ul className="text-xs text-navy mt-1 space-y-0.5">{d.diff.map((x) => <li key={x.field} data-field={x.field} className={x.field === 'category' ? 'bg-[#FFF3D6] rounded px-1 -mx-1' : undefined}><b>{x.field}</b>: <span className="text-muted line-through">{x.from}</span> → {x.to}</li>)}</ul>
                      </details>
                    )}
                  </td>
                  <td className="td text-sm">
                    {errs.length ? <ul className="text-bad text-xs list-disc pl-4" data-testid="row-errors">{errs.map((e) => <li key={e}>{e}</li>)}</ul>
                      : r.product_id ? <><Link href={`/distributor/products/${r.product_id}/edit`} className="text-ok font-semibold text-xs">✓ Saved · edit</Link>{pstatus(r) && <span className="ml-2"><StatusBadge {...productStatusView(pstatus(r), prod(r)?.listing_status)} /></span>}</>
                        : <span className="text-ok text-xs font-semibold">✓ Valid</span>}
                    {r.submit_error && <p className="text-bad text-xs mt-1" data-testid="submit-error">Not submitted: {r.submit_error}</p>}
                    {warns.length > 0 && <ul className="text-warn text-xs list-disc pl-4 mt-1" data-testid="row-warnings">{warns.map((w) => <li key={w}>{w}</li>)}</ul>}
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
