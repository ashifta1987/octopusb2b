'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Pencil } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, OctopusDataGrid, type GridColumn } from '@octopus/ui';
import { hsProposalPill, hsSourceLabel, hsTypePill, validHeading } from '../../_catalogue/core';
import { Note, NoPermission, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../_catalogue/kit';

export type HsType = { id: string; name: string; type_key: string; heading: string | null; confirmed: boolean; source: string; confidence: number | null; reason: string | null; total: number; suggested: number };
export type HsProposal = { product_id: string; sku: string | null; title: string | null; heading: string | null; type_name: string | null; source: string | null; confidence: number | null; status: string; note: string | null };
type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type HsActions = {
  confirm: (typeId: string) => Promise<R>;
  change: (typeId: string, heading: string) => Promise<R>;
  preview: (typeId: string, heading: string) => Promise<{ sku: string; title: string; current_code: string | null }[]>;
  backfillPreview: () => Promise<R>;
  backfillApply: () => Promise<R>;
};
export type HsScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  types: HsType[] | null;
  proposals: HsProposal[];
  counts: { confirmed: number; suggested: number; missing: number };
  canEdit: boolean;
  isAdmin: boolean;
  actions: HsActions;
  initialChange?: string | null;
  fixture?: boolean;
};
const CRUMBS = [{ label: 'Catalogue', href: '/office/products' }, { label: 'HS codes' }];

/**
 * ODS T9 · Catalogue › HS codes. Product types grid (heading, source, products, status) with Confirm and a Change drawer
 * (preview → apply), and the backfill preview / apply. All today's actions (products:approve; apply = Admin).
 */
export function HsCodesScreen({ state, types, proposals, counts, canEdit, isAdmin, actions, initialChange, fixture }: HsScreenProps) {
  const router = useRouter();
  const done = () => !fixture && router.refresh();
  const q = useRun(done);
  const c = useConfirm();
  const [change, setChange] = useState<string | null>(initialChange ?? null);
  if (state === 'forbidden') return <NoPermission crumbs={CRUMBS} title="HS codes" what="HS codes (Products approve)" />;
  const cols: GridColumn<HsType>[] = [
    { id: 'name', header: 'Product type', width: 260, accessor: (t) => t.name, cell: (t) => <span className="flex min-w-0 flex-col" data-testid="hs-type"><b className="truncate">{t.name}</b>{t.reason ? <span className="truncate text-ods-small text-ods-slate" title={t.reason}>{t.reason}</span> : null}</span> },
    { id: 'heading', header: 'Heading', width: 100, accessor: (t) => t.heading ?? '', cell: (t) => (t.heading ? <b className="font-mono">{t.heading}</b> : <span className="font-semibold text-ods-danger">none</span>) },
    { id: 'source', header: 'Source', width: 130, accessor: (t) => hsSourceLabel(t) },
    { id: 'products', header: 'Products', width: 150, accessor: (t) => t.total, cell: (t) => <span className="tabular-nums">{t.total}{t.suggested ? <span className="text-ods-warning"> ({t.suggested} suggested)</span> : null}</span> },
    { id: 'status', header: 'Status', width: 130, accessor: (t) => (t.confirmed ? 2 : t.heading ? 1 : 0), cell: (t) => <PillView p={hsTypePill(t)} /> },
    {
      id: 'act',
      header: 'Actions',
      width: 200,
      sortable: false,
      accessor: () => '',
      cell: (t) =>
        canEdit ? (
          <span className="flex gap-1">
            {!t.confirmed && t.heading ? <Button size="sm" iconStart={CheckCircle2} onClick={() => c.open({ title: `Confirm ${t.heading}`, text: `Confirm heading ${t.heading} for "${t.name}"? ${t.suggested} suggested product(s) become confirmed.`, confirmLabel: 'Confirm', onYes: () => q.run(() => actions.confirm(t.id)) })}>Confirm</Button> : null}
            <Button size="sm" variant="secondary" iconStart={Pencil} onClick={() => setChange(t.id)}>Change</Button>
          </span>
        ) : null,
    },
  ];
  const propCols: GridColumn<HsProposal>[] = [
    { id: 'product', header: 'Product', width: 260, accessor: (p) => p.title ?? '', cell: (p) => <span className="flex min-w-0 flex-col" data-testid="hs-proposal"><span className="font-mono text-ods-small">{p.sku}</span><span className="truncate">{p.title}</span></span> },
    { id: 'heading', header: 'Would receive', width: 120, accessor: (p) => p.heading ?? '', cell: (p) => <b className="font-mono">{p.heading ?? '—'}</b> },
    { id: 'type', header: 'Type', width: 200, accessor: (p) => p.type_name ?? '', cell: (p) => <span>{p.type_name ?? '—'}{p.source === 'ai' && p.confidence != null ? <span className="text-ods-slate"> · AI {Math.round(Number(p.confidence) * 100)}%</span> : null}</span> },
    { id: 'status', header: 'Status', width: 110, accessor: (p) => p.status, cell: (p) => <PillView p={hsProposalPill(p.status)} /> },
    { id: 'note', header: 'Note', width: 220, accessor: (p) => p.note ?? '', cell: (p) => <span className="truncate text-ods-small text-ods-slate">{p.note ?? ''}</span> },
  ];
  const type = (types ?? []).find((t) => t.id === change) ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="hs-codes-page">
      <PageHead crumbs={CRUMBS} title="HS codes" subtitle="4-digit HS headings detected from each product (rules first, then the AI classifier). Confirm a product type to confirm all its products; change a heading to update them all. Codes from the sheet or typed by a person are never changed." />
      <KpiStrip
        data-testid="hs-kpis"
        label="HS code figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Confirmed', value: String(counts.confirmed) },
          { label: 'Suggested', value: String(counts.suggested), hint: 'filled by a rule or the AI — check and confirm' },
          { label: 'Missing', value: String(counts.missing), hint: 'needs manual entry' },
          { label: 'Product types', value: String(types?.length ?? '—') },
        ]}
      />
      <RunMsg msg={q.msg} testId="hs-msg" />
      <OctopusDataGrid<HsType>
        label="Product types"
        data-testid="hs-grid"
        rows={types ?? []}
        columns={cols}
        getRowId={(t) => t.id}
        loading={state === 'loading'}
        error={types === null && state === 'ok' ? 'We couldn’t load the product types. Try again.' : undefined}
        onRetry={() => router.refresh()}
        emptyTitle="No product types yet"
        emptyDescription="Types appear as products are classified."
        headingLevel={2}
        searchPlaceholder="Search product type or heading"
        pagination
        densityToggle
      />
      <Card
        title="Backfill existing products"
        headingLevel={2}
        description="Preview first — nothing changes until an Admin applies it."
        actions={
          <span className="flex flex-wrap gap-2">
            {canEdit ? <Button size="sm" variant="secondary" loading={q.pending} onClick={() => c.open({ title: proposals.length ? 'Refresh preview' : 'Build preview', text: 'Classify every product without an HS code (rules first, then AI for the rest)? Results are a preview only.', confirmLabel: proposals.length ? 'Refresh preview' : 'Build preview', onYes: () => q.run(() => actions.backfillPreview()) })}>{proposals.length ? 'Refresh preview' : 'Build preview'}</Button> : null}
            {isAdmin && proposals.length ? <Button size="sm" loading={q.pending} onClick={() => c.open({ title: 'Apply the HS backfill', text: `Apply the previewed HS codes to ${proposals.length} products?`, confirmLabel: `Apply to ${proposals.length} products`, onYes: () => q.run(() => actions.backfillApply()) })}>Apply to {proposals.length} products</Button> : null}
          </span>
        }
      >
        {proposals.length ? (
          <OctopusDataGrid<HsProposal> label="Backfill preview" data-testid="hs-proposals" rows={proposals} columns={propCols} getRowId={(p) => p.product_id} headingLevel={3} searchPlaceholder="Search product" pagination />
        ) : <Note tone="info">No preview yet. Build one to see what every product without an HS code would receive.</Note>}
      </Card>
      {type ? <ChangeDrawer key={type.id} t={type} actions={actions} onClose={() => setChange(null)} onDone={done} /> : null}
      {c.node}
    </div>
  );
}

/** Today's ChangeHeading: 4 digits → preview of affected products → apply. */
function ChangeDrawer({ t, actions, onClose, onDone }: { t: HsType; actions: HsActions; onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(t.heading ?? '');
  const [rows, setRows] = useState<{ sku: string; title: string; current_code: string | null }[] | null>(null);
  const [pending, start] = useTransition();
  const q = useRun(onDone);
  const valid = validHeading(h);
  return (
    <Drawer open onClose={onClose} width={460} data-testid="hs-change-drawer" title={`Change heading · ${t.name}`} description={`Current heading ${t.heading ?? 'none'} · ${t.total} products`}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!valid || pending} disabledReason={!valid ? 'The heading must be exactly 4 digits (e.g. 8414).' : undefined} loading={pending} onClick={() => start(async () => setRows(await actions.preview(t.id, h)))}>Preview</Button>
          {rows ? <Button loading={q.pending} disabled={q.msg?.ok} onClick={() => q.run(() => actions.change(t.id, h))} data-testid="hs-apply">Apply to {rows.length}</Button> : null}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <Field label="New 4-digit heading" hint="e.g. 8414"><Input className="w-28 font-mono" value={h} maxLength={4} inputMode="numeric" onChange={(e) => { setH(e.target.value.replace(/\D/g, '')); setRows(null); }} /></Field>
        {rows ? (
          <div className="rounded-ods-control border border-ods-line bg-ods-canvas p-2 text-ods-small" data-testid="hs-change-preview">
            <div className="mb-1 font-semibold">{rows.length} product{rows.length === 1 ? '' : 's'} will get {h} (sheet / manual codes are not touched)</div>
            <ul className="m-0 flex max-h-56 list-none flex-col gap-0.5 overflow-auto p-0" tabIndex={0} aria-label="Affected products">{rows.map((r) => <li key={r.sku}><span className="font-mono">{r.sku}</span> {r.current_code ?? '—'} → <b>{h}</b></li>)}</ul>
          </div>
        ) : null}
        <RunMsg msg={q.msg} />
      </div>
    </Drawer>
  );
}
