'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsDialog, DsEmptyState, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsRadioCard, DsSelect, type DsBadgeTone,
} from '@/components/dropship-ui';
import { pct, storeMoney } from '@/lib/dropship-pricing';
import type { JobView, PushPageData } from '@/lib/dropship-ds6';
import { pushCancelAction, pushEnqueueAction, pushRetryAction } from '../ds6-actions';
import { fmtWhen, newRequestKey, problemShort } from '../ds6-ui';

const JOB: Record<JobView['status'], { tone: DsBadgeTone; label: (j: JobView) => string }> = {
  queued: { tone: 'info', label: () => 'Waiting to push' },
  running: { tone: 'info', label: () => 'Pushing now' },
  retry_wait: { tone: 'info', label: (j) => (j.error_code === 'THROTTLED' ? 'Shopify is busy · retrying automatically' : 'Retrying automatically') },
  done: { tone: 'ok', label: (j) => (j.kind === 'unlink' ? 'Unlinked' : `Pushed as ${j.publish_as === 'ACTIVE' ? 'active' : 'draft'}`) },
  failed: { tone: 'bad', label: () => 'Failed' },
  blocked: { tone: 'warn', label: (j) => problemShort(j.error_code ?? '') },
  cancelled: { tone: 'neutral', label: () => 'Cancelled' },
};

export function PushClient({ data, ids }: { data: PushPageData; ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [publishAs, setPublishAs] = useState<'draft' | 'active'>('draft');
  const [collection, setCollection] = useState(data.items.find((i) => i.collection)?.collection ?? '');
  const [pushImages, setPushImages] = useState(true);
  const [pushSeo, setPushSeo] = useState(true);
  const [keepSynced, setKeepSynced] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; title: string; text?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ productId: string; title: string; text: string } | null>(null);
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const store = data.store;
  const paused = data.dropship_status !== 'on';
  const ready = data.items.filter((i) => i.ready);
  const latest = data.batches.find((b) => b.kind === 'push');
  const open = latest?.jobs.some((j) => ['queued', 'running', 'retry_wait'].includes(j.status));

  // while a push runs, refresh every 10 s (the queue is durable: you can leave this page)
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [open, router]);

  const disabledReason = paused ? 'Dropshipping is paused for your company, so nothing new can be pushed.'
    : !store ? 'Connect a store first.'
      : ids.length === 0 ? 'Choose products in your import list first.'
        : ready.length === 0 ? 'None of the selected products can be pushed yet (see below).' : undefined;

  function push(confirmIds: string[] = []) {
    setNotice(null);
    start(async () => {
      const r = await pushEnqueueAction(ids, { publish_as: publishAs, collection: collection.trim() || null, push_images: pushImages, push_seo: pushSeo, keep_synced: keepSynced }, confirmIds, requestKey);
      setRequestKey(newRequestKey());
      if (!r.ok) { setNotice({ tone: 'bad', title: 'Nothing was pushed', text: r.message }); return; }
      const d = r.data as { queued: number; already_queued: number; blocked: { message: string }[] };
      setNotice({ tone: d.blocked.length ? 'warn' : 'ok', title: `${d.queued} product${d.queued === 1 ? '' : 's'} queued`,
        text: [d.already_queued ? `${d.already_queued} already waiting.` : '', d.blocked.length ? `${d.blocked.length} not pushed: ${d.blocked.map((b) => b.message).join(' ')}` : 'You can leave this page; Pushed products shows the result.'].join(' ').trim() });
      router.refresh();
    });
  }

  const variants = data.items.reduce((a, i) => a + i.variants_included, 0);
  return (
    <div className="flex flex-col gap-5" data-testid="ds6-push">
      <DsPageHeader
        title="Push to Shopify"
        icon="upload"
        subtitle={store ? `${data.items.length} products, ${variants} variants to ${store.shop_domain}` : `${data.items.length} products, ${variants} variants selected`}
        actions={<DsLinkButton href="/account/dropship/catalogue?list=1" variant="secondary" icon="list">Back to import list</DsLinkButton>}
      />

      {!store && (
        <DsNotice tone="warn" title="Connect a store first" testId="push-connect-store"
          action={<DsLinkButton href="/account/dropship/stores" variant="secondary" icon="store">Stores</DsLinkButton>}>
          {data.store_needs_reconnect
            ? 'Shopify access needs renewing. Stock and price updates are paused. Paid orders keep shipping. Reconnect, then push again.'
            : 'Pushing needs a connected Shopify store. Store connection is the next release; nothing is pushed or queued until then. Your import list, edits and prices are saved.'}
        </DsNotice>
      )}
      {paused && <DsNotice tone="warn" title="Dropshipping is paused" testId="push-paused">Nothing new can be pushed. Products already in your store, orders in progress, your wallet and support keep working.</DsNotice>}
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="push-notice">{notice.text}</DsNotice>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DsCard title="Push settings" icon="gear" testId="push-settings">
          <div className="flex flex-col gap-3">
            <DsSelect id="ps" label="Store" disabled={!store} hint={store ? undefined : 'No store connected yet.'} value={store?.id ?? ''} onChange={() => {}}>
              {store ? <option value={store.id}>{`Shopify · ${store.shop_domain}`}</option> : <option value="">No store connected</option>}
            </DsSelect>
            <DsInput id="pcl" label="Collection" value={collection} maxLength={120} onChange={(e) => setCollection(e.target.value)} hint="Matched to a collection with this name in your store. Leave empty for no collection." />
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
              <legend className="ds-label">Status in your store</legend>
              <DsRadioCard name="pub" value="draft" checked={publishAs === 'draft'} onChange={() => setPublishAs('draft')} title="Draft" description="Review in Shopify first" badge={<DsBadge tone="ok">Recommended</DsBadge>} />
              <DsRadioCard name="pub" value="active" checked={publishAs === 'active'} onChange={() => setPublishAs('active')} title="Active" description="Visible right away" />
            </fieldset>
            <DsCheckbox label="Push all images" checked={pushImages} onChange={(e) => setPushImages(e.target.checked)} />
            <DsCheckbox label="Push SEO title and description" checked={pushSeo} onChange={(e) => setPushSeo(e.target.checked)} />
            <DsCheckbox label="Keep stock and price in sync" checked={keepSynced} onChange={(e) => setKeepSynced(e.target.checked)} />
            <p className="m-0 text-[13px] text-[#5B6478]">Products are created through Shopify&apos;s Admin API. You can edit them in Shopify afterwards.</p>
            <DsButton icon="upload" loading={pending} disabled={pending || Boolean(disabledReason)} disabledReason={disabledReason} onClick={() => push()} testId="push-start">
              {`Push ${ready.length} product${ready.length === 1 ? '' : 's'}`}
            </DsButton>
          </div>
        </DsCard>

        <DsCard title="Progress" icon="activity" testId="push-progress">
          {!latest ? (
            <DsEmptyState title="No push yet" description={store ? 'Start a push to see each product here.' : 'Progress shows here once a store is connected and you push.'} icon="upload" />
          ) : (
            <>
              <p className="mt-0 text-[13px] text-[#5B6478]">
                {`${latest.jobs.filter((j) => j.status === 'done').length} of ${latest.jobs.filter((j) => j.status !== 'blocked' && j.status !== 'cancelled').length} done · started ${fmtWhen(latest.created_at)}`}
                {open ? ' · you can leave this page' : ''}
              </p>
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {latest.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF0F4] pb-2" data-testid={`job-${j.model_no}`}>
                    <span className="min-w-0"><strong className="text-[#1A174A]">{j.title}</strong><span className="block text-[12px] text-[#5B6478]">{j.model_no}</span></span>
                    <span className="flex items-center gap-2 flex-wrap">
                      <DsBadge tone={JOB[j.status].tone}>{JOB[j.status].label(j)}</DsBadge>
                      {['queued', 'retry_wait'].includes(j.status) && (
                        <DsButton variant="link" onClick={() => start(async () => { await pushCancelAction([j.id]); router.refresh(); })}>Cancel</DsButton>
                      )}
                      {j.status === 'failed' && (
                        <DsButton variant="link" disabled={!store || paused} disabledReason={!store ? 'Connect a store first.' : undefined}
                          onClick={() => start(async () => { const r = await pushRetryAction([j.id], newRequestKey()); setNotice(r.ok ? { tone: 'ok', title: 'Queued again' } : { tone: 'bad', title: 'Not queued', text: r.message }); router.refresh(); })}>Retry</DsButton>
                      )}
                    </span>
                    {j.error_message && j.status !== 'done' && <span className="w-full text-[12px] text-[#5B6478]">{j.error_message}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </DsCard>
      </div>

      {data.items.some((i) => !i.ready || i.below.length > 0) && (
        <DsCard title={`Not pushed (${data.items.filter((i) => !i.ready || i.below.length > 0).length})`} icon="alert" testId="push-not-pushed">
          <ul className="list-none m-0 p-0 flex flex-col gap-3">
            {data.items.filter((i) => !i.ready || i.below.length > 0).map((i) => {
              const blocking = i.problems.find((p) => p.blocking);
              const low = i.below[0];
              const text = blocking ? blocking.message : low ? `Price ${storeMoney(low.price_minor, i.currency)} gives ${pct(low.profit_bp, 1)}, below your ${pct(i.min_profit_bp)} minimum.` : '';
              return (
                <li key={i.product_id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`not-pushed-${i.model_no}`}>
                  <span className="min-w-0"><strong className="text-[#1A174A]">{i.title}</strong><span className="block text-[13px] text-[#5B6478]">{text}</span></span>
                  <span className="flex gap-2 flex-wrap">
                    <DsLinkButton href={`/account/dropship/import/${i.product_id}`} variant="secondary" icon="pencil">{blocking?.code === 'TEXT_CHECK' ? 'Edit description' : 'Change price'}</DsLinkButton>
                    {!blocking && low && (
                      <DsButton variant="secondary" disabled={!store || paused || pending} disabledReason={!store ? 'Connect a store first.' : undefined}
                        onClick={() => setConfirm({ productId: i.product_id, title: `Push 1 product below your minimum?`, text: `${i.title} at ${storeMoney(low.price_minor, i.currency)} gives ${pct(low.profit_bp, 1)}. Your minimum is ${pct(i.min_profit_bp)}.` })}>Push anyway</DsButton>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </DsCard>
      )}

      <DsCard testId="push-when-done">
        <strong className="text-[#1A174A]">When it finishes</strong>
        <p className="mt-1 mb-3 text-[14px] text-[#1A174A]">We send a notification and an email (when app email is live). Pushed products appear in Pushed with their sync status.</p>
        <DsLinkButton href="/account/dropship/pushed" icon="arrow">Go to Pushed products</DsLinkButton>
      </DsCard>
      <p className="m-0 text-[12px] text-[#5B6478]">Need to change a price first? <Link href="/account/dropship/pricing" className="text-[#2A6FD1] underline">Pricing and sync</Link></p>

      {confirm && (
        <DsDialog title={confirm.title} description={confirm.text} confirmLabel="Push anyway" cancelLabel="Change price" confirmVariant="primary"
          onCancel={() => { const id = confirm.productId; setConfirm(null); router.push(`/account/dropship/import/${id}`); }}
          onConfirm={() => { const id = confirm.productId; setConfirm(null); push([id]); }} testId="below-min-dialog" />
      )}
    </div>
  );
}
