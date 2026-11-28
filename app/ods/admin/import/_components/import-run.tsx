'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, Send, Trash2 } from 'lucide-react';
import { Button, Card, KpiStrip, OctopusDataGrid, type GridColumn } from '@octopus/ui';
import type { StagingBatch, StagedProduct, StagedPrice } from '@/lib/import/types';
import type { FieldChange, ImportDiff } from '@/lib/import/core';
import { human, importRunPill, productStatusPill, runActions, usd4 } from '../../_catalogue/core';
import { Note, NoPermission, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../_catalogue/kit';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type ImportRunActions = { commit: (runId: string) => Promise<R>; discard: (runId: string) => Promise<R>; submit: (runId: string) => Promise<R> };
export type ImportRunData = {
  id: string; name: string; status: string; created_at: string; committed_at: string | null; error: string | null;
  batch: StagingBatch; diff: ImportDiff; report: Record<string, Record<string, number>> | null;
  statusOf: Record<string, string>; listingOf: Record<string, string | null>; drafts: number; submitResults: Record<string, string>;
  supplier: { id: string; code: string; identity_status: string | null } | null;
};
export type ImportRunProps = { state: 'ok' | 'loading'; data: ImportRunData | null; canEdit: boolean; actions: ImportRunActions; fixture?: boolean };

const TABLES: [keyof ImportDiff, string][] = [['suppliers', 'Suppliers'], ['products', 'Products'], ['supplier_products', 'Supplier ↔ product'], ['prices', 'Tiered prices'], ['images', 'Images']];

/**
 * ODS T9 · Catalogue › Bulk import › run. What the workbook will change (or changed), blocking errors, field changes,
 * supplier identity, warnings and the products; Commit / Discard / Submit drafts for moderation = today's actions.
 */
export function ImportRunScreen({ state, data, canEdit, actions, fixture }: ImportRunProps) {
  const router = useRouter();
  const q = useRun(() => !fixture && router.refresh());
  const c = useConfirm();
  if (!data) {
    return state === 'loading' ? (
      <div className="flex flex-col gap-4" aria-busy="true"><h1 className="sr-only">Loading import</h1><KpiStrip label="Import figures" loading items={[{ label: 'Products', value: '—' }]} /></div>
    ) : <NoPermission crumbs={[{ label: 'Bulk import', href: '/admin/import' }]} title="Import not found" what="this import" />;
  }
  const { batch, diff, report } = data;
  const committed = data.status === 'committed';
  const errors = batch.errors ?? [];
  const pricesBy = new Map<string, StagedPrice[]>();
  batch.prices.forEach((p) => pricesBy.set(p.external_id, [...(pricesBy.get(p.external_id) ?? []), p]));
  const reviewBy = new Map<string, number>();
  batch.review.forEach((r) => reviewBy.set(r.external_id, (reviewBy.get(r.external_id) ?? 0) + 1));
  const changes = diff.changes ?? [];
  const can = runActions({ status: data.status, errors: errors.length, canEdit, drafts: data.drafts });
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  const productCols: GridColumn<StagedProduct>[] = [
    { id: 'id', header: 'Product Id', width: 170, accessor: (p) => p.external_id, cell: (p) => <span className="font-mono">{p.external_id}</span> },
    { id: 'name', header: 'Model / name', width: 220, accessor: (p) => p.name ?? p.factory_model ?? '', cell: (p) => <span className="truncate"><b>{p.name ?? p.factory_model ?? '—'}</b>{p.name && p.factory_model ? <span className="block text-ods-small text-ods-slate">{p.factory_model}</span> : null}</span> },
    { id: 'sheet', header: 'Sheet', width: 120, accessor: (p) => p.sheet },
    {
      id: 'status',
      header: 'Status',
      width: 200,
      sortable: false,
      accessor: (p) => p.listing_status,
      cell: (p) => (
        <span className="flex flex-col gap-0.5">
          <PillView p={{ label: human(p.listing_status), tone: p.listing_status === 'draft' ? 'neutral' : 'warning' }} />
          {data.statusOf[p.external_id] ? <PillView p={productStatusPill(data.statusOf[p.external_id], data.listingOf[p.external_id])} /> : null}
          {data.submitResults[p.external_id] && !['submitted', 'already'].includes(data.submitResults[p.external_id]) ? <span className="text-ods-small text-ods-danger" data-testid="submit-error">Not submitted: {data.submitResults[p.external_id]}</span> : null}
        </span>
      ),
    },
    { id: 'prices', header: 'Supplier prices (cost)', width: 260, sortable: false, accessor: (p) => (pricesBy.get(p.external_id) ?? []).length, cell: (p) => <span className="font-mono text-ods-small">{(pricesBy.get(p.external_id) ?? []).map((x, i) => <span key={i} className="block">{x.incoterm} · MOQ {x.moq_tier_min}{x.variant_label ? ` · ${x.variant_label}` : ''} · {usd4(x.price_minor)}</span>)}{!pricesBy.get(p.external_id)?.length ? <span className="text-ods-slate">no price</span> : null}</span> },
    { id: 'review', header: 'Review', width: 100, accessor: (p) => reviewBy.get(p.external_id) ?? 0, cell: (p) => (reviewBy.get(p.external_id) ? <span className="font-semibold text-ods-warning">{reviewBy.get(p.external_id)} item{reviewBy.get(p.external_id) === 1 ? '' : 's'}</span> : '—') },
  ];
  const changeCols: GridColumn<FieldChange & { i: number }>[] = [
    { id: 'id', header: 'Product Id', width: 170, accessor: (x) => x.external_id, cell: (x) => <span className="font-mono">{x.external_id}</span> },
    { id: 'field', header: 'Field', width: 140, accessor: (x) => x.field, cell: (x) => <span className={x.field === 'category' ? 'font-semibold text-ods-warning' : undefined}>{human(x.field)}</span> },
    { id: 'from', header: 'From', width: 240, accessor: (x) => x.from ?? '', cell: (x) => <span className="truncate text-ods-slate" title={x.from ?? undefined}>{x.from ?? '—'}</span> },
    { id: 'to', header: 'To', width: 240, accessor: (x) => x.to ?? '', cell: (x) => <span className="truncate font-semibold" title={x.to ?? undefined}>{x.to ?? '—'}</span> },
  ];
  const catMoves = changes.filter((x) => x.field === 'category').length;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="import-run-page">
      <PageHead
        crumbs={[{ label: 'Catalogue', href: '/office/products' }, { label: 'Bulk import', href: '/admin/import' }, { label: data.name }]}
        title={data.name}
        subtitle={<>Supplier prices valid {fmt(batch.valid_from)} → {batch.valid_to ? fmt(batch.valid_to) : 'open'} · started {fmt(data.created_at)} · <PillView p={importRunPill(data.status)} testId="run-status" /></>}
        actions={
          <>
            {can.commit ? <Button iconStart={CheckCircle2} loading={q.pending} onClick={() => c.open({ title: `Commit "${data.name}"`, text: `This writes ${diff.products.create} new / ${diff.products.update} updated products and ${diff.prices.create} new prices in one transaction. New products are drafts.`, confirmLabel: 'Commit import', onYes: () => q.run(() => actions.commit(data.id), 'Committed') })} data-testid="commit-import">Commit import</Button> : null}
            {can.discard ? <Button variant="secondary" iconStart={Trash2} onClick={() => c.open({ title: 'Discard this preview?', text: 'Nothing has been written.', confirmLabel: 'Discard', destructive: true, onYes: () => q.run(() => actions.discard(data.id), 'Preview discarded') })}>Discard</Button> : null}
            {can.submit ? <Button iconStart={Send} loading={q.pending} onClick={() => c.open({ title: 'Submit for moderation', text: `Submit ${data.drafts} draft products of this import for moderation?`, confirmLabel: `Submit ${data.drafts}`, onYes: () => q.run(() => actions.submit(data.id), 'Submitted for moderation') })}>Submit {data.drafts} for moderation</Button> : null}
          </>
        }
      />
      <RunMsg msg={q.msg} testId="run-msg" />
      {data.error ? <Note tone="danger" role="alert">Last commit attempt failed: {data.error}</Note> : null}
      {committed && report ? (
        <Note tone="success">
          Committed {fmt(data.committed_at)}: {report.products?.create ?? 0} new and {report.products?.update ?? 0} updated products, {report.prices?.create ?? 0} new prices ({report.prices?.update ?? 0} updated, {report.prices?.superseded ?? 0} superseded), {report.images?.create ?? 0} images, {report.review?.create ?? 0} review items. All new products are drafts. <a href={`/admin/import/review?run=${data.id}`} className="font-semibold underline">Open the review queue</a>.
        </Note>
      ) : null}
      <KpiStrip
        data-testid="run-kpis"
        label="Import figures"
        variant="strip"
        items={[
          { label: 'Products', value: String(batch.products.length), hint: `${batch.products.filter((p) => p.listing_status === 'needs_quote').length} need a quote` },
          { label: 'Tiered prices', value: String(batch.prices.length), hint: 'MOQ × variant × incoterm' },
          { label: 'Images', value: String(batch.images.length), hint: batch.unmatched_images.length ? `${batch.unmatched_images.length} unmatched in ZIP` : batch.missing_images.length ? `${batch.missing_images.length} missing` : 'all matched' },
          { label: 'Review items', value: String(batch.review.length), hint: Object.entries(diff.review.by_kind).map(([k, v]) => `${v} ${human(k).toLowerCase()}`).join(' · ') || '—' },
        ]}
      />
      {errors.length ? (
        <Card title={`${errors.length} error${errors.length === 1 ? '' : 's'} — fix the workbook and upload again`} headingLevel={2} data-testid="import-errors">
          <Note tone="danger">Nothing can be committed while the workbook has errors. Correct these rows, save as .xlsx and start a new import.</Note>
          <ul className="m-0 mt-2 flex max-h-72 list-none flex-col divide-y divide-ods-line overflow-y-auto p-0 text-ods-small" tabIndex={0} aria-label="Workbook errors">
            {errors.slice(0, 300).map((e, i) => <li key={i} className="py-1" data-testid="import-error"><span className="text-ods-slate">{e.sheet} · row {e.row ?? '—'} · {e.column ?? '—'}:</span> <span className="text-ods-danger">{e.message}</span></li>)}
          </ul>
          {errors.length > 300 ? <p className="m-0 mt-1 text-ods-small text-ods-slate">…and {errors.length - 300} more.</p> : null}
        </Card>
      ) : null}
      <Card title={committed ? 'What the commit changed' : 'What will change'} headingLevel={2}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Changes per table">
          <table className="w-full min-w-[560px] border-collapse text-ods-body">
            <thead><tr className="border-b border-ods-line text-ods-small text-ods-slate">{['Table', 'Create', 'Update', 'Skip (unchanged)', 'Notes'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {TABLES.map(([k, label]) => {
                const d = (committed && report ? report[k] : diff[k]) as { create?: number; update?: number; skip?: number } | undefined;
                return (
                  <tr key={k} className="border-b border-ods-line">
                    <th scope="row" className="px-2 py-1.5 text-start font-semibold">{label}</th>
                    <td className="px-2 py-1.5 tabular-nums">{d?.create ?? 0}</td>
                    <td className="px-2 py-1.5 tabular-nums">{d?.update ?? 0}</td>
                    <td className="px-2 py-1.5 tabular-nums">{d?.skip ?? 0}</td>
                    <td className="px-2 py-1.5 text-ods-small text-ods-warning">{(diff[k] as { conflicts?: string[] }).conflicts?.slice(0, 3).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {changes.length ? (
        <div className="flex flex-col gap-2">
          {catMoves ? <Note tone="warning"><b>{catMoves} product{catMoves === 1 ? '' : 's'} will move to another category.</b> Check before committing — a blank category cell keeps the current category.</Note> : null}
          <OctopusDataGrid<FieldChange & { i: number }> label={`Field changes (${changes.length}${changes.length >= 500 ? '+' : ''})`} data-testid="field-changes" rows={changes.map((x, i) => ({ ...x, i }))} columns={changeCols} getRowId={(x) => String(x.i)} headingLevel={2} searchPlaceholder="Search product or field" pagination />
        </div>
      ) : null}
      <Card title={`Supplier ${batch.supplier.external_id}${data.supplier ? ` · ${data.supplier.code}` : ''}`} headingLevel={2}>
        <div className="flex flex-col gap-2 text-ods-small">
          <div><b>{batch.supplier.legal_name}</b> · {[batch.supplier.city, batch.supplier.province, batch.supplier.country].filter(Boolean).join(', ')} · {batch.supplier.handle}</div>
          {batch.supplier.contacts.map((ct) => <div key={ct.name}>Contact: {ct.name}{ct.role ? `, ${ct.role}` : ''} · {ct.phone} · {ct.email}</div>)}
          {batch.supplier.name_variants.length > 1 ? (
            <Note tone="warning">
              <b>{batch.supplier.name_variants.length} legal names in use — resolve before the first order ships.</b> Products can be imported as drafts now, but none can be published until you pick the canonical name
              {data.supplier ? <> in <a href={`/admin/suppliers?id=${data.supplier.id}`} className="font-semibold underline">Suppliers › {data.supplier.code}</a></> : ' after the commit'}.
              <ul className="m-0 mt-1 list-disc ps-5">{batch.supplier.name_variants.map((v) => <li key={v.variant_name}>{v.variant_name}{v.variant_address ? ` — ${v.variant_address}` : ''} <span className="text-ods-slate">({human(v.seen_in)})</span></li>)}</ul>
              {data.supplier?.identity_status === 'ok' ? <p className="m-0 mt-1 font-semibold text-ods-success">Resolved — canonical name chosen.</p> : null}
            </Note>
          ) : null}
        </div>
      </Card>
      {batch.warnings.length || batch.unmatched_images.length ? (
        <Card title="Warnings" headingLevel={2}>
          <ul className="m-0 list-disc ps-5 text-ods-small">
            {batch.warnings.map((w) => <li key={w}>{w}</li>)}
            {batch.unmatched_images.length ? <li>Images in the ZIP not referenced by any product (not imported): {batch.unmatched_images.join(', ')}</li> : null}
          </ul>
        </Card>
      ) : null}
      <OctopusDataGrid<StagedProduct>
        label="Products in this workbook"
        data-testid="run-products-grid"
        rows={batch.products}
        columns={productCols}
        getRowId={(p) => p.external_id}
        headingLevel={2}
        emptyTitle="No products in this workbook"
        searchPlaceholder="Search Product Id or model"
        pagination
      />
      <p className="m-0 text-ods-small text-ods-slate">Blank = not provided by the supplier (never zero). {committed ? `${Object.keys(data.statusOf).length - data.drafts} of ${Object.keys(data.statusOf).length} products are in moderation or live.` : ''}</p>
      {c.node}
    </div>
  );
}
