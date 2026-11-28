'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Copy, PlayCircle, XCircle } from 'lucide-react';
import { Button, Drawer, KpiStrip, OctopusDataGrid, Tabs, formatDate, type GridColumn } from '@octopus/ui';
import { MODERATION_TABS, matchesModerationTab, moderationActions, moderationIssues, productPill, tierRanges, type ModerationTab } from '../../../admin/_catalogue/core';
import { KV, Note, NoPermission, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../../admin/_catalogue/kit';

export type QueueRow = { id: string; title: string; status: string; updated_at: string; image_url: string | null; moderation_hold: boolean; supplier_code: string | null; supplier_country: string | null };
export type ProductDetail = {
  id: string; external_id: string | null; title: string; description: string | null; status: string; moderation_hold: boolean; moderation_hold_reason: string | null;
  hs_code: string | null; hs_code_status: string | null; hs_code_source: string | null; hs_code_note: string | null; unit: string; moq: number | null; lead_time_days: number | null;
  incoterm: string | null; origin: string | null; weight_box: string; shippingFlags: string; flags: string; seo_title: string | null; seo_description: string | null; image_url: string | null; updated_at: string;
  supplier: { code: string; legal_name: string; country: string; verified: boolean } | null; category: string | null;
  tiers: { min_qty: number; unit_price_cents: number; currency: string }[]; lowestPlatform: { minor: number; currency: string } | null;
  specs: { name: string; value: string }[]; media: string[]; tags: string[]; certificates: string[];
  blocker: string | null; listingsOff: boolean;
};
type R = { ok: boolean; error?: string; message?: string };
export type ModerationActions = { moderate: (productId: string, to: 'in_review' | 'live' | 'rejected', reason: string) => Promise<R> };
export type ModerationScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  queue: QueueRow[] | null;
  queueError?: string | null;
  selected: ProductDetail | null;
  actions: ModerationActions;
  basePath?: string;
  extraParams?: Record<string, string>;
  fixture?: boolean;
};
const fmtMoney = (minor: number, cur: string) => `${({ USD: 'US$', CNY: 'CN¥' } as Record<string, string>)[cur] ?? cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CRUMBS = [{ label: 'Catalogue', href: '/office/products' }, { label: 'Product moderation' }];

/**
 * ODS T9 · Catalogue › Product moderation. Queue grid (submitted / in review, holds) + product record drawer with today's
 * checks (hold, publish blocker, supplier listings switch, Check list). Start review / Reject (reason) / Approve & publish
 * = today's moderateProduct (products:approve; transition_product enforces the rest).
 */
export function ModerationScreen({ state, queue, queueError, selected, actions, basePath = '/office/products', extraParams, fixture }: ModerationScreenProps) {
  const router = useRouter();
  const [nav, startNav] = useTransition();
  const [tab, setTab] = useState<ModerationTab>('all');
  const rows = useMemo(() => (queue ?? []).filter((q) => matchesModerationTab(q, tab)), [queue, tab]);
  const open = (id: string | null) => {
    const p = new URLSearchParams(extraParams);
    if (id) p.set('p', id);
    startNav(() => router.push(`${basePath}${p.toString() ? `?${p}` : ''}`, { scroll: false }));
  };

  if (state === 'forbidden') return <NoPermission crumbs={CRUMBS} title="Product moderation" what="the moderation queue (Products approve)" />;

  const columns: GridColumn<QueueRow>[] = [
    { id: 'title', header: 'Product', width: 300, accessor: (q) => q.title, cell: (q) => <button type="button" onClick={() => open(q.id)} className="truncate text-start font-semibold text-ods-navy hover:underline">{q.title}</button> },
    { id: 'supplier', header: 'Supplier', width: 120, accessor: (q) => q.supplier_code ?? '', cell: (q) => <span className="font-mono">{q.supplier_code ?? '—'}</span> },
    { id: 'country', header: 'Country', width: 90, accessor: (q) => q.supplier_country ?? '' },
    { id: 'status', header: 'Status', width: 120, accessor: (q) => (q.moderation_hold ? 'hold' : q.status), cell: (q) => <PillView p={productPill(q.status, q.moderation_hold)} /> },
    { id: 'updated', header: 'Waiting since', width: 140, accessor: (q) => q.updated_at, cell: (q) => formatDate(q.updated_at) },
  ];
  const counts = Object.fromEntries(MODERATION_TABS.map(([t]) => [t, (queue ?? []).filter((q) => matchesModerationTab(q, t)).length]));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="moderation-page">
      <PageHead crumbs={CRUMBS} title="Product moderation" subtitle="Check listings before they go live. Approve publishes to the storefront; reject sends the reason back to the distributor." />
      <KpiStrip
        data-testid="moderation-kpis"
        label="Moderation figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'In the queue', value: String(queue?.length ?? '—'), hint: 'oldest first (up to 100)' },
          { label: 'Submitted', value: String(counts.submitted ?? 0), hint: 'not started' },
          { label: 'In review', value: String(counts.in_review ?? 0) },
          { label: 'On hold', value: String(counts.hold ?? 0), hint: 'an Admin releases holds' },
        ]}
      />
      {queueError ? <Note tone="danger" role="alert">The moderation queue could not be loaded: {queueError}</Note> : null}
      <Tabs
        data-testid="moderation-tabs"
        label="Moderation status"
        value={tab}
        onChange={(t) => setTab(t as ModerationTab)}
        items={MODERATION_TABS.map(([t, label]) => ({
          id: t,
          label,
          count: queue ? counts[t] : undefined,
          panel: () =>
            t === tab ? (
              <div className="pt-3">
                <OctopusDataGrid<QueueRow>
                  label="Moderation queue"
                  data-testid="products-grid"
                  rows={rows}
                  columns={columns}
                  getRowId={(q) => q.id}
                  loading={state === 'loading' || nav}
                  error={queue === null && !queueError && state === 'ok' ? 'We couldn’t load the queue. Try again.' : undefined}
                  onRetry={() => router.refresh()}
                  emptyTitle="Queue is clear"
                  emptyDescription="Submitted products appear here."
                  headingLevel={2}
                  onOpenRow={(q) => open(q.id)}
                  onOpenInDrawer={(q) => open(q.id)}
                  rowActions={(q) => [{ id: 'open', label: 'Review', onSelect: () => open(q.id) }]}
                  searchPlaceholder="Search product or supplier"
                  pagination
                  densityToggle
                />
              </div>
            ) : null,
        }))}
      />
      {selected ? <ProductDrawer key={selected.id} p={selected} onClose={() => open(null)} actions={actions} onDone={() => !fixture && router.refresh()} /> : null}
    </div>
  );
}

function ProductDrawer({ p, onClose, actions, onDone }: { p: ProductDetail; onClose: () => void; actions: ModerationActions; onDone: () => void }) {
  const q = useRun(onDone);
  const c = useConfirm();
  const can = moderationActions(p);
  const issues = moderationIssues({ description: p.description, tiers: p.tiers.length, photos: p.media.length, hasImageUrl: !!p.image_url, hs_code: p.hs_code, hs_code_status: p.hs_code_status, category: p.category });
  const sorted = [...p.tiers].sort((a, b) => a.min_qty - b.min_qty);
  const ranges = tierRanges(sorted, p.unit);
  const lowest = sorted[sorted.length - 1];
  const images = p.media.length ? p.media : p.image_url ? [p.image_url] : [];
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="product-drawer"
      title={p.title}
      description={<span className="inline-flex flex-wrap items-center gap-2">{p.category ?? 'No category'} · updated {formatDate(p.updated_at)} <PillView p={productPill(p.status, p.moderation_hold)} /></span>}
      footer={
        <div className="flex flex-wrap gap-2">
          {can.approve ? (
            <Button iconStart={CheckCircle2} loading={q.pending} onClick={() => c.open({ title: 'Approve & publish', text: 'Publish this listing to the storefront?', confirmLabel: 'Approve & publish', onYes: () => q.run(() => actions.moderate(p.id, 'live', ''), 'Published') })} data-testid="approve-product">
              Approve &amp; publish
            </Button>
          ) : null}
          {can.startReview ? <Button variant="secondary" iconStart={PlayCircle} loading={q.pending} onClick={() => q.run(() => actions.moderate(p.id, 'in_review', ''), 'In review')}>Start review</Button> : null}
          <Button variant="secondary" iconStart={XCircle} className="text-ods-danger" onClick={() => c.open({ title: 'Reject listing', text: 'The reason is sent to the distributor.', confirmLabel: 'Reject', destructive: true, input: { label: 'Reason (required)', required: true }, onYes: (why) => q.run(() => actions.moderate(p.id, 'rejected', why), 'Rejected') })} data-testid="reject-product">
            Reject
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 font-mono text-ods-small text-ods-slate">{[p.supplier?.code, p.supplier?.legal_name, p.supplier?.country].filter(Boolean).join(' · ')}{p.supplier?.verified ? ' · verified' : ''}</p>
          {p.external_id ? <Button size="sm" variant="ghost" iconStart={Copy} onClick={() => void navigator.clipboard?.writeText(p.external_id ?? '')}>Copy Product Id</Button> : null}
        </div>
        {p.moderation_hold ? <Note tone="warning" testId="moderation-hold"><b>On hold:</b> {p.moderation_hold_reason ?? 'waiting for owner confirmation'}. It cannot be approved until an Admin releases the hold.</Note> : null}
        {p.blocker ? <Note tone="danger" testId="publish-blocker"><b>Cannot be approved yet:</b> {p.blocker}. You can review it now; approval works once this is resolved.</Note> : null}
        {p.listingsOff ? <Note tone="danger">This supplier’s “listings live” switch is off — approval will fail until it is turned on.</Note> : null}
        {issues.length ? <Note tone="warning"><b>Check:</b> {issues.join(' · ')}</Note> : null}
        {images.length ? (
          <div className="flex gap-2 overflow-x-auto" role="list" aria-label="Product photos">
            {images.slice(0, 6).map((u, i) => (
              <div role="listitem" key={u} className="size-24 shrink-0 overflow-hidden rounded-ods-control border border-ods-line bg-ods-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`${p.title} — photo ${i + 1}`} className="size-full object-cover" />
              </div>
            ))}
          </div>
        ) : <p className="m-0 text-ods-small text-ods-slate" data-testid="no-photo">No photo uploaded</p>}
        <section>
          <h3 className="m-0 mb-1 text-ods-label font-bold text-ods-navy">Price tiers{sorted[0] ? <span className="ms-2 font-normal text-ods-slate">entered in {sorted[0].currency}</span> : null}</h3>
          {sorted.length ? (
            <dl className="m-0">{sorted.map((t, i) => <KV key={t.min_qty} k={ranges[i]}>{fmtMoney(t.unit_price_cents, t.currency)}</KV>)}</dl>
          ) : <p className="m-0 text-ods-small text-ods-danger">No tiers</p>}
        </section>
        <dl className="m-0">
          <KV k="Product Id">{p.external_id ?? '—'}</KV>
          <KV k="MOQ">{p.moq ?? '—'} {p.unit}</KV>
          <KV k="Lead time">{p.lead_time_days ? `${p.lead_time_days} days` : '—'}</KV>
          <KV k="Incoterm">{p.incoterm ?? '—'}</KV>
          <KV k="Origin">{p.origin ?? '—'}</KV>
          <KV k="HS code"><span className="font-mono">{p.hs_code ?? '—'}</span>{p.hs_code_status ? ` · ${p.hs_code_status}` : ''}{p.hs_code_source ? ` · ${p.hs_code_source}` : ''}{p.hs_code_note ? ` · ${p.hs_code_note}` : ''}</KV>
          <KV k="Weight & box">{p.weight_box}</KV>
          <KV k="Shipping flags">{p.shippingFlags}</KV>
          <KV k="Flags">{p.flags || '—'}</KV>
        </dl>
        {p.tags.length || p.certificates.length ? (
          <div className="flex flex-wrap gap-1">
            {p.tags.map((t) => <PillView key={`t${t}`} p={{ label: t, tone: 'info' }} />)}
            {p.certificates.map((t) => <PillView key={`c${t}`} p={{ label: t, tone: 'success' }} />)}
          </div>
        ) : null}
        <section>
          <h3 className="m-0 mb-1 text-ods-label font-bold text-ods-navy">Description</h3>
          <p className="m-0 whitespace-pre-line text-ods-body">{p.description || <span className="text-ods-slate">—</span>}</p>
        </section>
        {p.specs.length ? (
          <section>
            <h3 className="m-0 mb-1 text-ods-label font-bold text-ods-navy">Specifications</h3>
            <dl className="m-0">{p.specs.map((s) => <KV key={s.name} k={s.name}>{s.value}</KV>)}</dl>
          </section>
        ) : null}
        <section className="rounded-ods-control bg-ods-canvas p-3 text-ods-small">
          <div className="text-ods-slate">Search preview</div>
          <div className="font-semibold text-ods-info">{p.seo_title || p.title}</div>
          <div className="text-ods-slate">{p.seo_description || '—'}</div>
          {lowest ? <div className="mt-1 text-ods-slate">From {fmtMoney(lowest.unit_price_cents, lowest.currency)} / {p.unit}{p.lowestPlatform ? ` · storefront ≈ ${fmtMoney(p.lowestPlatform.minor, p.lowestPlatform.currency)} (converted)` : ''}</div> : null}
        </section>
        <RunMsg msg={q.msg} testId="moderation-msg" />
      </div>
      {c.node}
    </Drawer>
  );
}
