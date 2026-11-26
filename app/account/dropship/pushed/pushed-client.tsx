'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsDialog, DsEmptyState, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTableCard, type DsBadgeTone,
} from '@/components/dropship-ui';
import { storeMoney, STOCK_TEXT, STOCK_TONE } from '@/lib/dropship-pricing';
import type { PushedData } from '@/lib/dropship-ds6';
import { pushEnqueueAction, pushRetryAction, unlinkAction } from '../ds6-actions';
import { Ds6Chips, fmtWhen, newRequestKey } from '../ds6-ui';

const SYNC: Record<PushedData['rows'][number]['sync_state'], { tone: DsBadgeTone; label: string }> = {
  in_sync: { tone: 'ok', label: 'In sync' },
  price_updated: { tone: 'info', label: 'Cost up · price updated by rule' },
  out_of_stock: { tone: 'warn', label: 'Out of stock · set to draft' },
  needs_you: { tone: 'warn', label: 'Needs you: below minimum margin' },
  failed: { tone: 'bad', label: 'Sync failed' },
};

export function PushedClient({ data, showFailed }: { data: PushedData; showFailed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [storeStatus, setStoreStatus] = useState('all');
  const [sync, setSync] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [askUnlink, setAskUnlink] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; title: string; text?: string } | null>(null);
  const store = data.store;

  const rows = useMemo(() => data.rows.filter((r) =>
    (!q || `${r.title} ${r.model_no}`.toLowerCase().includes(q.toLowerCase()))
    && (storeStatus === 'all' || r.store_status === storeStatus)
    && (sync === 'all' || (sync === 'in_sync' ? r.sync_state === 'in_sync' : sync === 'needs_you' ? r.sync_state === 'needs_you' : r.stock_status === 'out'))), [data.rows, q, storeStatus, sync]);
  const chosen = data.rows.filter((r) => selected.has(r.product_id));
  const noStoreReason = !store ? 'Connect a store first.' : undefined;
  const counts = { import: data.import_count, pushed: data.rows.length, failed: data.failed.length };

  const repush = () => start(async () => {
    const ids = chosen.map((r) => r.product_id);
    const r = await pushEnqueueAction(ids, { publish_as: 'draft', collection: null, push_images: true, push_seo: true, keep_synced: true }, [], newRequestKey());
    setNotice(r.ok ? { tone: 'ok', title: 'Re-push queued', text: 'Products are updated in your store through their saved links (no duplicates).' } : { tone: 'bad', title: 'Nothing was queued', text: r.message });
    router.refresh();
  });
  const unlink = () => start(async () => {
    setAskUnlink(false);
    const r = await unlinkAction(chosen.map((x) => x.product_id), newRequestKey());
    setNotice(r.ok ? { tone: 'ok', title: 'Unlink queued', text: 'Stock is set to 0 at the Octopus location first; then sync stops.' } : { tone: 'bad', title: 'Not unlinked', text: r.message });
    setSelected(new Set());
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-5" data-testid="ds6-pushed">
      <DsPageHeader
        title="Pushed products"
        icon="refresh"
        subtitle="Everything in your store from Octopus, with its sync status."
        actions={
          <>
            <DsButton variant="secondary" icon="refresh" disabled disabledReason="Automatic stock and price sync starts with the sync engine; nothing syncs yet." testId="sync-all">Sync all now</DsButton>
            <DsButton variant="secondary" icon="upload" disabled={pending || chosen.length === 0 || !store} disabledReason={noStoreReason ?? (chosen.length === 0 ? 'Select products first.' : undefined)} onClick={repush} testId="repush-selected">Re-push selected</DsButton>
            <DsButton variant="secondary" icon="link" disabled={pending || chosen.length === 0} disabledReason={chosen.length === 0 ? 'Select products first.' : undefined} onClick={() => setAskUnlink(true)} testId="unlink-selected">Unlink selected</DsButton>
          </>
        }
      />
      <Ds6Chips current={showFailed ? 'failed' : 'pushed'} counts={counts} />
      {!store && (
        <DsNotice tone="info" title={data.store_needs_reconnect ? 'Shopify access needs renewing' : 'Connect a store first'} testId="pushed-connect-store"
          action={<DsLinkButton href="/account/dropship/stores" variant="secondary" icon="store">{data.store_needs_reconnect ? 'Reconnect' : 'Stores'}</DsLinkButton>}>
          {data.store_needs_reconnect ? 'Stock and price updates are paused. Paid orders keep shipping.' : 'Nothing has been pushed yet. Products appear here after you connect a store and push them from your import list.'}
        </DsNotice>
      )}
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="pushed-notice">{notice.text}</DsNotice>}

      {!showFailed && (
        <>
          <DsCard testId="pushed-filters">
            <div className="grid gap-3 sm:grid-cols-3">
              <DsInput id="pq" label="Search" placeholder="Title or model no." value={q} onChange={(e) => setQ(e.target.value)} />
              <DsSelect id="pss" label="Store status" value={storeStatus} onChange={(e) => setStoreStatus(e.target.value)}>
                <option value="all">All</option><option value="active">Active</option><option value="draft">Draft</option>
              </DsSelect>
              <DsSelect id="psy" label="Sync" value={sync} onChange={(e) => setSync(e.target.value)}>
                <option value="all">All</option><option value="in_sync">In sync</option><option value="needs_you">Needs you</option><option value="out">Out of stock</option>
              </DsSelect>
            </div>
          </DsCard>
          {data.rows.length === 0 ? (
            <DsCard testId="pushed-empty">
              <DsEmptyState title="Nothing pushed yet" description={store ? 'Push products from your import list; they appear here with their sync status.' : 'Connect a store, then push products from your import list.'}
                icon="upload" actionLabel="Go to import list" actionHref="/account/dropship/catalogue?list=1" actionIcon="list" />
            </DsCard>
          ) : (
            <DsTableCard testId="pushed-table" title="In your store" minWidth={820}
              headers={[
                <input key="all" type="checkbox" aria-label="Select all" className="w-4 h-4 accent-coral" checked={rows.length > 0 && rows.every((r) => selected.has(r.product_id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.product_id)) : new Set())} />,
                'Product', 'Store status', 'Stock', 'Price', 'Sync', 'Last sync']}>
              {rows.map((r) => (
                <tr key={r.product_id} data-testid={`pushed-row-${r.model_no}`}>
                  <td><input type="checkbox" className="w-4 h-4 accent-coral" aria-label={`Select ${r.title}`} checked={selected.has(r.product_id)}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.product_id)) n.delete(r.product_id); else n.add(r.product_id); return n; })} /></td>
                  <td><strong className="text-ink">{r.title}</strong><span className="block text-[12px] text-muted">{r.model_no}</span></td>
                  <td><DsBadge tone={r.store_status === 'active' ? 'ok' : 'neutral'}>{r.store_status === 'active' ? 'Active' : r.store_status === 'archived' ? 'Archived' : 'Draft'}</DsBadge></td>
                  <td><DsBadge tone={STOCK_TONE[r.stock_status]}>{STOCK_TEXT[r.stock_status]}</DsBadge></td>
                  <td>{r.price_min == null ? '—' : r.price_min === r.price_max ? storeMoney(r.price_min, r.currency) : `${storeMoney(r.price_min, r.currency)} – ${storeMoney(r.price_max, r.currency)}`}</td>
                  <td>{r.open_job ? <DsBadge tone="info">{r.open_job.kind === 'unlink' ? 'Unlinking…' : 'Updating…'}</DsBadge> : <DsBadge tone={SYNC[r.sync_state].tone}>{SYNC[r.sync_state].label}</DsBadge>}</td>
                  <td>{fmtWhen(r.last_synced_at)}</td>
                </tr>
              ))}
            </DsTableCard>
          )}
        </>
      )}

      <DsCard title={`Failed (${data.failed.length})`} icon="stop" testId="pushed-failed">
        {data.failed.length === 0 ? (
          <p className="m-0 text-[14px] text-muted">No failed pushes.</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-3">
            {data.failed.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`failed-${j.model_no}`}>
                <span className="min-w-0"><strong className="text-ink">{`${j.title} · ${j.model_no}`}</strong><span className="block text-[13px] text-muted">{j.error_message}</span></span>
                <span className="flex gap-2 flex-wrap">
                  {j.error_code === 'HANDLE_TAKEN' && <DsLinkButton href={`/account/dropship/import/${j.product_id}`} variant="secondary" icon="pencil">Change handle</DsLinkButton>}
                  {j.error_code === 'STORE_ACCESS_EXPIRED' && <DsLinkButton href="/account/dropship/stores" icon="link">Reconnect</DsLinkButton>}
                  <DsButton variant="secondary" icon="refresh" disabled={pending || !store} disabledReason={noStoreReason}
                    onClick={() => start(async () => { const r = await pushRetryAction([j.id], newRequestKey()); setNotice(r.ok ? { tone: 'ok', title: 'Queued again' } : { tone: 'bad', title: 'Not queued', text: r.message }); router.refresh(); })}>Retry</DsButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DsCard>

      {askUnlink && (
        <DsDialog title={`Unlink ${chosen.length} product${chosen.length === 1 ? '' : 's'}?`}
          description="They stay in your Shopify store but stop syncing stock and price, and leave the Octopus location. Stock is set to 0 there first."
          confirmLabel="Unlink" cancelLabel="Keep" onCancel={() => setAskUnlink(false)} onConfirm={unlink} testId="unlink-dialog" />
      )}
    </div>
  );
}
