import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Notice, StatusBadge, Table, Stat } from '@/components/ui';
import { RunButton } from '@/components/admin/client';
import { fmtDate, humanize, productStatusView } from '@/lib/format';
import type { StagingBatch } from '@/lib/import/types';
import type { ImportDiff } from '@/lib/import/core';
import { commitImportRun, discardImportRun, submitImportRun } from '../actions';

export const metadata = { title: 'Import preview' };

const usd4 = (minor: number) => `US$ ${(minor / 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const TABLES: [keyof ImportDiff, string][] = [['suppliers', 'Suppliers'], ['products', 'Products'], ['supplier_products', 'Supplier ↔ product'], ['prices', 'Tiered prices'], ['images', 'Images']];

/** Steps 2–4: what the workbook will change, the review queue, supplier identity, then Commit. */
export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('products', 'edit', `/admin/import/${id}`);
  const sb = await createClient();
  const { data: run } = await sb.from('import_runs').select('*').eq('id', id).maybeSingle();
  if (!run) notFound();
  const batch = run.staging as StagingBatch;
  const diff = run.diff as ImportDiff;
  const report = run.report as Record<string, Record<string, number>> | null;
  const committed = run.status === 'committed';
  const byProduct = new Map<string, typeof batch.prices>();
  batch.prices.forEach((p) => byProduct.set(p.external_id, [...(byProduct.get(p.external_id) ?? []), p]));
  const reviewBy = new Map<string, number>();
  batch.review.forEach((r) => reviewBy.set(r.external_id, (reviewBy.get(r.external_id) ?? 0) + 1));
  const errors = batch.errors ?? [];
  const submitRes = ((run.submit_report as { results?: Record<string, string> } | null)?.results ?? {}) as Record<string, string>;
  const { data: liveStatus } = committed ? await sb.from('products').select('sku, status, listing_status').in('sku', batch.products.map((x) => x.external_id)) : { data: [] };
  const statusOf = new Map((liveStatus ?? []).map((x) => [x.sku as string, x.status as string]));
  const listingOf = new Map((liveStatus ?? []).map((x) => [x.sku as string, x.listing_status as string | null]));
  const drafts = [...statusOf.entries()].filter(([k, v]) => (v === 'draft' || v === 'rejected') && !['needs_quote', 'in_development'].includes(listingOf.get(k) ?? '')).length;
  const changes = diff.changes ?? [];
  const { data: sup } = await sb.from('suppliers').select('id, code, identity_status').eq('external_id', batch.supplier.external_id).maybeSingle();

  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/import" className="text-coral-text">← Bulk import</Link>} title={run.name}
        subtitle={`Supplier prices valid ${fmtDate(batch.valid_from)} → ${batch.valid_to ? fmtDate(batch.valid_to) : 'open'} · started ${fmtDate(run.created_at, true)}`}
        actions={<StatusBadge status={run.status} />} />

      {run.error && <div className="mb-4"><Notice tone="red">Last commit attempt failed: {run.error}</Notice></div>}
      {errors.length > 0 && (
        <Card title={`${errors.length} error${errors.length === 1 ? '' : 's'} — fix the workbook and upload again`} className="mb-6 border-red-300" >
          <div className="px-6 pb-2"><Notice tone="red">Nothing can be committed while the workbook has errors. Correct these rows, save as .xlsx and start a new import.</Notice></div>
          <Table head={['Sheet', 'Row', 'Column', 'Problem']}>
            {errors.slice(0, 300).map((e, i) => (
              <tr key={i} data-testid="import-error">
                <td className="td text-sm">{e.sheet}</td><td className="td mono text-sm">{e.row ?? '—'}</td>
                <td className="td text-sm">{e.column ?? '—'}</td><td className="td text-sm text-red-700">{e.message}</td>
              </tr>
            ))}
          </Table>
          {errors.length > 300 && <p className="px-6 pb-4 text-sm text-muted">…and {errors.length - 300} more.</p>}
        </Card>
      )}
      {committed && report && (
        <div className="mb-6"><Notice tone="green">
          Committed {fmtDate(run.committed_at, true)}: {report.products?.create ?? 0} new and {report.products?.update ?? 0} updated products, {report.prices?.create ?? 0} new prices
          ({report.prices?.update ?? 0} updated, {report.prices?.superseded ?? 0} superseded), {report.images?.create ?? 0} images, {report.review?.create ?? 0} review items.
          All new products are drafts. <Link href={`/admin/import/review?run=${id}`} className="underline font-semibold">Open the review queue</Link>.
        </Notice></div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Products" value={batch.products.length} hint={`${batch.products.filter((p) => p.listing_status === 'needs_quote').length} need a quote`} />
        <Stat label="Tiered prices" value={batch.prices.length} hint="MOQ × variant × incoterm" />
        <Stat label="Images" value={batch.images.length} hint={batch.unmatched_images.length ? `${batch.unmatched_images.length} unmatched in ZIP` : batch.missing_images.length ? `${batch.missing_images.length} missing` : 'all matched'} hintTone={batch.missing_images.length ? 'warn' : undefined} />
        <Stat label="Review items" value={batch.review.length} hint={Object.entries(diff.review.by_kind).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(' · ')} hintTone={batch.review.length ? 'warn' : undefined} />
      </div>

      <Card title={committed ? 'What the commit changed' : 'What will change'} className="mb-6">
        <Table head={['Table', 'Create', 'Update', 'Skip (unchanged)', 'Notes']}>
          {TABLES.map(([k, label]) => {
            const d = (committed && report ? report[k] : diff[k]) as { create?: number; update?: number; skip?: number; conflicts?: string[] } | undefined;
            return (
              <tr key={k}>
                <td className="td font-semibold">{label}</td>
                <td className="td mono">{d?.create ?? 0}</td><td className="td mono">{d?.update ?? 0}</td><td className="td mono">{d?.skip ?? 0}</td>
                <td className="td text-sm">{(diff[k] as { conflicts?: string[] }).conflicts?.slice(0, 3).map((c) => <div key={c} className="text-warn">{c}</div>)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {changes.length > 0 && (
        <Card title={`Field changes (${changes.length}${changes.length >= 500 ? '+' : ''})`} className="mb-6">
          {changes.some((c) => c.field === 'category') && <div className="px-6 pb-3"><Notice tone="amber"><b>{changes.filter((c) => c.field === 'category').length} product{changes.filter((c) => c.field === 'category').length === 1 ? '' : 's'} will move to another category</b> (highlighted). Check before committing — a blank category cell keeps the current category.</Notice></div>}
          <Table head={['Product Id', 'Field', 'From', 'To']}>
            {changes.map((c, i) => (
              <tr key={i} data-testid="field-change" data-field={c.field} className={c.field === 'category' ? 'bg-warn-bg' : undefined}>
                <td className="td mono text-sm">{c.external_id}</td><td className="td text-sm">{humanize(c.field)}</td>
                <td className="td text-sm text-muted break-all">{c.from ?? '—'}</td><td className="td text-sm font-semibold break-all">{c.to ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title={`Supplier ${batch.supplier.external_id}${sup ? ` · ${sup.code}` : ''}`} className="mb-6">
        <div className="px-6 pb-6 grid gap-3 text-sm">
          <div><b>{batch.supplier.legal_name}</b> · {[batch.supplier.city, batch.supplier.province, batch.supplier.country].filter(Boolean).join(', ')} · {batch.supplier.handle}</div>
          {batch.supplier.contacts.map((c) => <div key={c.name}>Contact: {c.name}{c.role ? `, ${c.role}` : ''} · {c.phone} · {c.email}</div>)}
          {batch.supplier.name_variants.length > 1 && (
            <Notice tone="amber">
              <b>{batch.supplier.name_variants.length} legal names in use — resolve before the first order ships.</b> Products can be imported as drafts now,
              but none can be published until you pick the canonical name{sup ? <> in <Link href={`/admin/suppliers?id=${sup.id}`} className="underline font-semibold">Admin → Suppliers → {sup.code}</Link></> : ' after the commit'}.
              <ul className="mt-2 list-disc pl-5">{batch.supplier.name_variants.map((v) => <li key={v.variant_name}>{v.variant_name}{v.variant_address ? ` — ${v.variant_address}` : ''} <span className="text-muted">({humanize(v.seen_in)})</span></li>)}</ul>
              {sup?.identity_status === 'ok' && <p className="mt-2 font-semibold text-ok">Resolved — canonical name chosen.</p>}
            </Notice>
          )}
        </div>
      </Card>

      {(batch.warnings.length > 0 || batch.unmatched_images.length > 0) && (
        <Card title="Warnings" className="mb-6">
          <ul className="px-6 pb-6 text-sm list-disc pl-10 space-y-1">
            {batch.warnings.map((w) => <li key={w}>{w}</li>)}
            {batch.unmatched_images.length > 0 && <li>Images in the ZIP not referenced by any product (not imported): {batch.unmatched_images.join(', ')}</li>}
          </ul>
        </Card>
      )}

      <Card title="Products in this workbook" className="mb-6" action={<span className="text-xs text-muted">Blank = not provided by the supplier (never zero)</span>}>
        {committed && can(s, 'products', 'edit') && (
          <div className="px-6 pb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">{statusOf.size - drafts} of {statusOf.size} products are in moderation or live.</span>
            {drafts > 0 && <RunButton className="btn btn-dark btn-sm" confirm={`Submit ${drafts} draft products of this import for moderation?`} action={submitImportRun.bind(null, id)}>Submit {drafts} for moderation</RunButton>}
          </div>
        )}
        <Table head={['Product Id', 'Model / name', 'Sheet', 'Status', 'Supplier prices (cost)', 'Review']}>
          {batch.products.map((p) => (
            <tr key={p.external_id}>
              <td className="td mono text-sm">{p.external_id}</td>
              <td className="td text-sm"><div className="font-semibold">{p.name ?? p.factory_model ?? '—'}</div>{p.name && <div className="text-muted">{p.factory_model}</div>}</td>
              <td className="td text-sm">{p.sheet}</td>
              <td className="td"><StatusBadge status={p.listing_status} />{statusOf.get(p.external_id) && <div className="mt-1"><StatusBadge {...productStatusView(statusOf.get(p.external_id), listingOf.get(p.external_id))} /></div>}
                {submitRes[p.external_id] && !['submitted', 'already'].includes(submitRes[p.external_id]) && <p className="text-bad text-xs mt-1" data-testid="submit-error">Not submitted: {submitRes[p.external_id]}</p>}</td>
              <td className="td mono text-xs">{(byProduct.get(p.external_id) ?? []).map((x, i) => <div key={i}>{x.incoterm} · MOQ {x.moq_tier_min}{x.variant_label ? ` · ${x.variant_label}` : ''} · {usd4(x.price_minor)}</div>)}
                {!byProduct.get(p.external_id)?.length && <span className="text-muted">no price</span>}</td>
              <td className="td text-sm">{reviewBy.get(p.external_id) ? <span className="text-warn font-semibold">{reviewBy.get(p.external_id)} item{reviewBy.get(p.external_id) === 1 ? '' : 's'}</span> : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {!committed && run.status === 'previewed' && can(s, 'products', 'edit') && (
        <div className="flex flex-wrap items-start gap-3 mb-10">
          {errors.length === 0 && <RunButton className="btn btn-primary" confirm={`Commit "${run.name}"? This writes ${diff.products.create} new / ${diff.products.update} updated products and ${diff.prices.create} new prices in one transaction. New products are drafts.`}
            action={commitImportRun.bind(null, id)}>Commit import</RunButton>}
          <RunButton className="btn btn-ghost" confirm="Discard this preview? Nothing has been written." action={discardImportRun.bind(null, id)}>Discard</RunButton>
        </div>
      )}
    </>
  );
}
