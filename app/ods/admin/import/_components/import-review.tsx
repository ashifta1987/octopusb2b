'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, OctopusDataGrid, Select, Tabs, Input, formatDate, type GridColumn } from '@octopus/ui';
import { REVIEW_TABS, decisionsFor, human, productStatusPill, reviewPill, type ReviewTab } from '../../_catalogue/core';
import { Note, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../_catalogue/kit';

export type ReviewItem = { id: string; external_id: string; kind: string; issue: string; evidence: string | null; status: string; decision_note: string | null; decided_at: string | null; run_id: string | null; product_id: string | null };
export type ReviewProduct = { id: string; external_id: string; title: string; status: string; listing_status: string; markup_pct: number | null; sell_price_mode: string; currency: string; tiers: { min_qty: number; unit_price_cents: number }[]; cost_cents: number | null };
type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type ImportReviewActions = {
  decide: (itemId: string, status: 'accepted_quote' | 'accepted_dashboard' | 'resolved' | 'held' | 'open', note?: string) => Promise<R>;
  setPricing: (prev: R | null, fd: FormData) => Promise<R>;
};
export type ImportReviewProps = {
  state: 'ok' | 'loading';
  items: ReviewItem[] | null;
  products: ReviewProduct[];
  tab: ReviewTab;
  run: string | null;
  canEdit: boolean;
  defaultMarkup: number;
  actions: ImportReviewActions;
  basePath?: string;
  extraParams?: Record<string, string>;
  fixture?: boolean;
};
const money = (minor: number, cur: string) => `${({ USD: 'US$', CNY: 'CN¥' } as Record<string, string>)[cur] ?? cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * ODS T9 · Catalogue › Import review queue. Items per tab with today's one-click decisions (decideReview; Hold only on open
 * items; Reopen on decided ones), and the buyer prices per product (setProductPricing). Supplier costs are staff-only.
 */
export function ImportReviewScreen({ state, items, products, tab, run, canEdit, defaultMarkup, actions, basePath = '/admin/import/review', extraParams, fixture }: ImportReviewProps) {
  const router = useRouter();
  const q = useRun(() => !fixture && router.refresh());
  const c = useConfirm();
  const prodBy = new Map(products.map((p) => [p.id, p]));
  const shown = (items ?? []).filter((i) => REVIEW_TABS[tab].includes(i.status));
  const count = (t: ReviewTab) => (items ?? []).filter((i) => REVIEW_TABS[t].includes(i.status)).length;
  const href = (t: ReviewTab) => {
    const u = new URLSearchParams(extraParams);
    if (run) u.set('run', run);
    u.set('tab', t);
    return `${basePath}?${u}`;
  };
  const cols: GridColumn<ReviewItem>[] = [
    { id: 'product', header: 'Product', width: 220, accessor: (i) => i.external_id, cell: (i) => { const p = i.product_id ? prodBy.get(i.product_id) : undefined; return <span className="flex min-w-0 flex-col"><span className="font-mono">{i.external_id}</span>{p ? <span className="truncate text-ods-small text-ods-slate">{p.title}</span> : null}</span>; } },
    { id: 'kind', header: 'Kind', width: 120, accessor: (i) => i.kind, cell: (i) => <PillView p={{ label: human(i.kind), tone: 'info' }} /> },
    { id: 'issue', header: 'Issue', width: 300, accessor: (i) => i.issue, cell: (i) => <span className="truncate" title={i.issue}>{i.issue}</span> },
    { id: 'evidence', header: 'Evidence', width: 220, accessor: (i) => i.evidence ?? '', cell: (i) => <span className="truncate text-ods-small text-ods-slate" title={i.evidence ?? undefined}>{i.evidence ?? '—'}</span> },
    {
      id: 'decision',
      header: 'Decision',
      width: 340,
      sortable: false,
      accessor: (i) => i.status,
      cell: (i) =>
        i.status === 'open' || i.status === 'held' ? (
          canEdit ? (
            <span className="flex flex-wrap gap-1">
              {decisionsFor(i.status).map((d) => (
                <Button key={d.status} size="sm" variant="secondary" onClick={() => c.open({ title: `${d.label} · ${i.external_id}`, text: d.prompt, confirmLabel: d.label, input: { label: d.status === 'held' ? 'Why? (required)' : 'Note (optional)', required: d.status === 'held' }, onYes: (note) => q.run(() => actions.decide(i.id, d.status, note || undefined)) })}>
                  {d.label}
                </Button>
              ))}
            </span>
          ) : <PillView p={reviewPill(i.status)} />
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <PillView p={reviewPill(i.status)} />
            <span className="truncate text-ods-small text-ods-slate">{i.decision_note ? `${i.decision_note} · ` : ''}{i.decided_at ? formatDate(i.decided_at, { short: true }) : ''}</span>
            {canEdit ? <Button size="sm" variant="link" onClick={() => q.run(() => actions.decide(i.id, 'open'))}>Reopen</Button> : null}
          </span>
        ),
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="import-review-page">
      <PageHead
        crumbs={[{ label: 'Catalogue', href: '/office/products' }, { label: 'Bulk import', href: '/admin/import' }, { label: 'Review queue' }]}
        title="Import review queue"
        subtitle="A product cannot be published while it has open or held items here, or while its supplier’s legal name is unresolved."
      />
      {run ? <Note tone="info">Showing one import run. <a href={basePath} className="font-semibold underline">Show all runs</a></Note> : null}
      <RunMsg msg={q.msg} testId="review-msg" />
      <Tabs
        data-testid="review-tabs"
        label="Review status"
        value={tab}
        onChange={(t) => router.push(href(t as ReviewTab), { scroll: false })}
        items={(['open', 'held', 'done'] as ReviewTab[]).map((t) => ({
          id: t,
          label: t === 'open' ? 'Open' : t === 'held' ? 'Held' : 'Resolved',
          count: items ? count(t) : undefined,
          panel: () =>
            t === tab ? (
              <div className="pt-3">
                <OctopusDataGrid<ReviewItem>
                  label="Review items"
                  data-testid="review-grid"
                  rows={shown}
                  columns={cols}
                  getRowId={(i) => i.id}
                  loading={state === 'loading'}
                  error={items === null && state === 'ok' ? 'We couldn’t load the review items. Try again.' : undefined}
                  onRetry={() => router.refresh()}
                  emptyTitle={tab === 'open' ? 'Nothing waiting for a decision' : 'No items here'}
                  headingLevel={2}
                  searchPlaceholder="Search Product Id or issue"
                  pagination
                />
              </div>
            ) : null,
        }))}
      />
      <Card title="Buyer prices for these products" headingLevel={2} data-testid="review-pricing">
        <p className="m-0 mb-2 text-ods-small text-ods-slate">Buyer price = supplier cost × (1 + markup). Default markup {defaultMarkup}% (settings key pricing.default_markup_pct).</p>
        <Note tone="info">Supplier costs are visible to staff only. Customers see the buyer price tiers.</Note>
        {!products.length ? <p className="m-0 mt-2 text-ods-small text-ods-slate">No products.</p> : (
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-ods-line p-0">
            {products.map((p) => <PricingRow key={p.id} p={p} canEdit={canEdit} defaultMarkup={defaultMarkup} onSave={(fd) => q.run(() => actions.setPricing(null, fd), 'Pricing applied')} pending={q.pending} />)}
          </ul>
        )}
      </Card>
      {c.node}
    </div>
  );
}

function PricingRow({ p, canEdit, defaultMarkup, onSave, pending }: { p: ReviewProduct; canEdit: boolean; defaultMarkup: number; onSave: (fd: FormData) => void; pending: boolean }) {
  const [markup, setMarkup] = useState(p.markup_pct == null ? '' : String(p.markup_pct));
  const [mode, setMode] = useState(p.sell_price_mode);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 text-ods-body">
      <span className="min-w-[200px] flex-1"><span className="block font-mono">{p.external_id}</span><span className="block truncate text-ods-small text-ods-slate">{p.title}</span></span>
      <PillView p={productStatusPill(p.status, p.listing_status)} />
      <span className="text-ods-small"><span className="text-ods-slate">Cost </span><b className="tabular-nums">{p.cost_cents != null ? money(p.cost_cents, p.currency) : '—'}</b></span>
      <span className="text-ods-small tabular-nums">{[...p.tiers].sort((a, b) => a.min_qty - b.min_qty).map((t) => `${t.min_qty}+ · ${money(t.unit_price_cents, p.currency)}`).join('  ') || 'no tiers'}</span>
      {canEdit ? (
        <span className="flex items-center gap-2">
          <Input type="number" min={0} max={1000} step="0.5" className="w-24" placeholder={`${defaultMarkup}%`} value={markup} onChange={(e) => setMarkup(e.target.value)} aria-label={`Markup % for ${p.external_id}`} />
          <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label={`Pricing mode for ${p.external_id}`}><option value="markup">From cost</option><option value="manual">Manual</option></Select>
          <Button size="sm" variant="secondary" loading={pending} onClick={() => { const fd = new FormData(); fd.set('product_id', p.id); fd.set('markup', markup); fd.set('mode', mode); onSave(fd); }}>Apply</Button>
        </span>
      ) : <span className="text-ods-small">{p.sell_price_mode === 'manual' ? 'Manual' : `${p.markup_pct ?? defaultMarkup}%`}</span>}
    </li>
  );
}
