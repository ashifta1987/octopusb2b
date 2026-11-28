'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Download, ListChecks, Upload } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, OctopusDataGrid, Select, Textarea, formatDate, type GridColumn } from '@octopus/ui';
import { suggestProductId } from '@/lib/import/product-id';
import { importRunPill, runCounts, validateImportUpload } from '../../_catalogue/core';
import { LinkButton, Note, NoPermission, PageHead, PillView } from '../../_catalogue/kit';

export type RunRow = { id: string; name: string; status: string; created_at: string; committed_at: string | null; diff: Record<string, { create?: number; update?: number; skip?: number; total?: number }> | null; report: Record<string, { create?: number; update?: number }> | null };
export type SupplierOpt = { id: string; code: string | null; legal_name: string | null; external_id: string | null };
type UploadRes = { ok: true; uploads: { kind: string; path: string; token: string }[] } | { ok: false; error: string };
type StageRes = { ok: true; runId: string } | { ok: false; error: string };
export type ImportListActions = {
  createUploads: (files: { name: string; size: number; kind: 'xlsx' | 'zip' }[]) => Promise<UploadRes>;
  stage: (input: { name: string; validFrom: string; xlsxPath: string; zipPath?: string | null }) => Promise<StageRes>;
  /** browser upload with the signed token (today: supabase.storage.from('imports').uploadToSignedUrl) */
  uploadFile: (path: string, token: string, file: File) => Promise<{ error: string | null }>;
};
export type ImportListProps = {
  state: 'ok' | 'loading' | 'forbidden';
  runs: RunRow[] | null;
  openReview: number;
  suppliers: SupplierOpt[];
  defaultValidFrom: string;
  actions: ImportListActions;
  initialUpload?: boolean;
  /** run links = runBase + id (fixtures point elsewhere; must be a string so server pages can pass it) */
  runBase?: string;
};
const CRUMBS = [{ label: 'Catalogue', href: '/office/products' }, { label: 'Bulk import' }];

/** ODS T9 · Catalogue › Bulk import: runs grid, template download + Product Id helper, New import drawer (today's two-step upload). */
export function ImportListScreen({ state, runs, openReview, suppliers, defaultValidFrom, actions, initialUpload, runBase = '/admin/import/' }: ImportListProps) {
  const runHref = (id: string) => `${runBase}${id}`;
  const router = useRouter();
  const [upload, setUpload] = useState(!!initialUpload);
  if (state === 'forbidden') return <NoPermission crumbs={CRUMBS} title="Bulk import" what="bulk import (Products edit)" />;
  const columns: GridColumn<RunRow>[] = [
    { id: 'name', header: 'Import', width: 260, accessor: (r) => r.name, cell: (r) => <a href={runHref(r.id)} className="truncate font-semibold text-ods-info underline">{r.name}</a> },
    { id: 'status', header: 'Status', width: 120, accessor: (r) => r.status, cell: (r) => <PillView p={importRunPill(r.status)} /> },
    { id: 'products', header: 'Products', width: 140, accessor: (r) => runCounts(r).products.create, cell: (r) => { const c = runCounts(r); return <span className="font-mono">{c.products.create} new · {c.products.update} upd</span>; } },
    { id: 'prices', header: 'Prices', width: 140, accessor: (r) => runCounts(r).prices.create, cell: (r) => { const c = runCounts(r); return <span className="font-mono">{c.prices.create} new · {c.prices.update} upd</span>; } },
    { id: 'images', header: 'Images', width: 90, numeric: true, accessor: (r) => runCounts(r).images },
    { id: 'review', header: 'Review items', width: 110, numeric: true, accessor: (r) => runCounts(r).review },
    { id: 'started', header: 'Started', width: 150, accessor: (r) => r.created_at, cell: (r) => formatDate(r.created_at) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="import-page">
      <PageHead
        crumbs={CRUMBS}
        title="Bulk import"
        subtitle="Load a supplier’s products, tiered prices and photos from one workbook. You see every change before it is written; new products arrive as drafts."
        actions={
          <>
            {openReview ? <LinkButton href="/admin/import/review" testId="open-review"><ListChecks aria-hidden className="size-4" /> Review queue ({openReview})</LinkButton> : null}
            <Button iconStart={Upload} onClick={() => setUpload(true)} data-testid="new-import">New import</Button>
          </>
        }
      />
      <KpiStrip
        label="Import figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Imports (last 30)', value: String(runs?.length ?? '—') },
          { label: 'Waiting to commit', value: String((runs ?? []).filter((r) => r.status === 'previewed').length), hint: 'previewed' },
          { label: 'Committed', value: String((runs ?? []).filter((r) => r.status === 'committed').length) },
          { label: 'Open review items', value: String(openReview), hint: 'open or held' },
        ]}
      />
      <OctopusDataGrid<RunRow>
        label="Import runs"
        data-testid="import-runs-grid"
        rows={runs ?? []}
        columns={columns}
        getRowId={(r) => r.id}
        loading={state === 'loading'}
        error={runs === null && state === 'ok' ? 'We couldn’t load the imports. Try again.' : undefined}
        onRetry={() => router.refresh()}
        emptyTitle="No imports yet"
        emptyDescription="Start a new import with a supplier workbook."
        headingLevel={2}
        onOpenRow={(r) => router.push(runHref(r.id))}
        searchPlaceholder="Search imports"
        pagination
      />
      <TemplateCard suppliers={suppliers} />
      {upload ? <UploadDrawer defaultValidFrom={defaultValidFrom} actions={actions} onClose={() => setUpload(false)} onStaged={(id) => router.push(runHref(id))} /> : null}
    </div>
  );
}

/** Today's TemplateCard, in ODS: GET /admin/import/template (route handler, not rewritten) + "Generate Product Ids". */
function TemplateCard({ suppliers }: { suppliers: SupplierOpt[] }) {
  const [supplier, setSupplier] = useState('');
  const [prefix, setPrefix] = useState('');
  const [models, setModels] = useState('');
  const [copied, setCopied] = useState(false);
  const ext = suppliers.find((s) => s.id === supplier)?.external_id ?? '';
  const ids = useMemo(() => {
    const seen = new Map<string, number>();
    return models.split('\n').map((m) => m.trim()).filter(Boolean).map((m) => {
      const base = suggestProductId(prefix || ext, m);
      if (!base) return { model: m, id: '' };
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { model: m, id: n > 1 ? `${base}-${n}` : base };
    });
  }, [models, prefix, ext]);
  return (
    <Card title="Download template" headingLevel={2} data-testid="template-card">
      <div className="grid gap-4 ods-desktop:grid-cols-2">
        <form method="get" action="/admin/import/template" className="flex flex-col gap-3">
          <Field label="Supplier to pre-fill">
            <Select name="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">— none (empty Supplier sheet) —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{[s.code, s.external_id, s.legal_name].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="kind" value="blank" variant="secondary" iconStart={Download}>Blank template</Button>
            <Button type="submit" name="kind" value="prefilled" iconStart={Download} disabled={!supplier} disabledReason={!supplier ? 'Choose a supplier first' : undefined}>Pre-filled with existing products</Button>
          </div>
          <p className="m-0 text-ods-small text-ods-slate">Save the workbook as .xlsx. Put image files in a separate .zip. Filenames must match the Image file column exactly, including case.</p>
        </form>
        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-ods-label font-bold text-ods-navy">Generate Product Ids</h3>
          <Field label="Supplier external id"><Input className="font-mono" placeholder={ext || 'CN-GD-BWJ-0010'} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
          <Field label="Factory models (one per line)"><Textarea className="font-mono" rows={4} value={models} onChange={(e) => setModels(e.target.value)} placeholder={'F8\nP10 Humidifier'} /></Field>
          {ids.length ? (
            <>
              <pre className="m-0 max-h-40 overflow-auto rounded-ods-control bg-ods-canvas p-2 font-mono text-ods-small" data-testid="generated-ids" tabIndex={0}>{ids.map((r) => r.id || `(needs supplier id) ${r.model}`).join('\n')}</pre>
              <div><Button variant="secondary" size="sm" iconStart={Copy} onClick={async () => { await navigator.clipboard.writeText(ids.map((r) => r.id).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy Product Ids'}</Button></div>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** Today's ImportUploadForm steps, unchanged: createImportUploads → upload each file to its signed URL → stageImportRun → open the run. */
function UploadDrawer({ defaultValidFrom, actions, onClose, onStaged }: { defaultValidFrom: string; actions: ImportListActions; onClose: () => void; onStaged: (id: string) => void }) {
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState(defaultValidFrom);
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () => {
    const bad = validateImportUpload({ name, validFrom, xlsx });
    setErr(bad);
    if (bad || !xlsx) return;
    start(async () => {
      const files = [{ name: xlsx.name, size: xlsx.size, kind: 'xlsx' as const }, ...(zip && zip.size ? [{ name: zip.name, size: zip.size, kind: 'zip' as const }] : [])];
      setStep('Preparing upload…');
      const up = await actions.createUploads(files);
      if (!up.ok) { setStep(null); return setErr(up.error); }
      for (const u of up.uploads) {
        const file = u.kind === 'xlsx' ? xlsx : zip!;
        setStep(`Uploading ${file.name}…`);
        const { error } = await actions.uploadFile(u.path, u.token, file);
        if (error) { setStep(null); return setErr(`Upload of ${file.name} failed: ${error}`); }
      }
      setStep('Reading the workbook and checking every row…');
      const r = await actions.stage({ name, validFrom, xlsxPath: up.uploads.find((u) => u.kind === 'xlsx')!.path, zipPath: up.uploads.find((u) => u.kind === 'zip')?.path ?? null });
      setStep(null);
      if (!r.ok) return setErr(r.error);
      onStaged(r.runId);
    });
  };
  return (
    <Drawer open onClose={onClose} width={460} data-testid="upload-drawer" title="New import" description="Nothing is written to the catalogue until you review the preview and press Commit. Every new product is a draft."
      footer={<div className="flex gap-2"><Button iconStart={Upload} onClick={go} loading={pending} loadingText="Working…" data-testid="upload-submit">Upload and preview</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>}>
      <div className="flex flex-col gap-3">
        <Field label="Import name" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Bowijie 2026-11 catalogue" /></Field>
        <div className="flex flex-col gap-1">
          <label htmlFor="im-xlsx" className="text-ods-label font-semibold text-ods-navy">Supplier workbook (.xlsx, max 50 MB) <span className="text-ods-danger">*</span></label>
          <input id="im-xlsx" type="file" required aria-describedby="im-xlsx-hint" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setXlsx(e.target.files?.[0] ?? null)} className="block w-full text-ods-small" />
          <p id="im-xlsx-hint" className="m-0 text-ods-small text-ods-slate">One “Supplier” sheet plus one sheet per category with “Product Id” in cell A1.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="im-zip" className="text-ods-label font-semibold text-ods-navy">Product photos (.zip, optional)</label>
          <input id="im-zip" type="file" aria-describedby="im-zip-hint" accept=".zip,application/zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} className="block w-full text-ods-small" />
          <p id="im-zip-hint" className="m-0 text-ods-small text-ods-slate">File names must match the “Image file” column.</p>
        </div>
        <Field label="Supplier prices valid from" required hint="Valid-to is set from the default validity in settings."><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        {step ? <Note tone="info" role="status">{step}</Note> : null}
        {err ? <Note tone="danger" role="alert">{err}</Note> : null}
      </div>
    </Drawer>
  );
}
