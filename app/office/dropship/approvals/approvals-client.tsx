'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsChip, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsTableCard, DsTextarea } from '@/components/dropship-ui';
import { SUBMISSION_KIND, SUBMISSION_STATUS, fmtDay, usd } from '@/lib/dropship-ds14-shared';
import type { ApprovalDetail, ApprovalsPage, ProductPayload } from '@/lib/dropship-ds14';
import { decideApprovalAction, saveRulesAction } from '../ds14-actions';

const TABS: [string, string, keyof ApprovalsPage['counts']][] = [['review', 'To review', 'review'], ['changes', 'Changes asked', 'changes'], ['approved', 'Approved', 'approved'], ['rejected', 'Rejected', 'rejected']];
const CHECKS: [string, string, keyof ApprovalDetail['auto'] | null][] = [
  ['images_clean', 'Images are clean (no watermark, logo or contact details)', 'images_present'],
  ['ids_unique', 'Model number and SKU are unique', 'ids_unique'],
  ['hs_ok', 'HS code is present and fits the description', 'hs_present'],
  ['size_ok', 'Weight and size look right', 'size_present'],
  ['flags_ok', 'Battery and liquid flags match the description', null],
  ['cost_ok', 'Cost and landed cost are filled in', null],
];

function Products({ list }: { list: ProductPayload[] }) {
  return (
    <div className="flex flex-col gap-3">
      {list.map((p, i) => (
        <div key={i} className="border border-line rounded-[10px] p-3 text-[14px]" data-testid="approval-product">
          <div className="font-semibold">{p.name} <span className="text-muted font-normal">· Model {p.supplier_sku}</span></div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 m-0 mt-2">
            <div><dt className="inline text-muted">Variants: </dt><dd className="inline m-0">{(p.variants ?? []).map((v) => `${v.option} (${usd(v.cost_cents)}, stock ${v.stock})`).join(', ') || '—'}</dd></div>
            <div><dt className="inline text-muted">Package: </dt><dd className="inline m-0">{p.package?.weight_g ?? '—'} g · {p.package?.length_cm ?? '—'} x {p.package?.width_cm ?? '—'} x {p.package?.height_cm ?? '—'} cm</dd></div>
            <div><dt className="inline text-muted">HS code: </dt><dd className="inline m-0">{p.customs?.hs_code || '—'} · origin {p.customs?.origin || '—'}</dd></div>
            <div><dt className="inline text-muted">Flags: </dt><dd className="inline m-0">battery {p.customs?.battery ? 'yes' : 'no'}, liquid {p.customs?.liquid ? 'yes' : 'no'}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-muted">Images: </dt><dd className="inline m-0 break-all">{(p.images ?? []).map((u, k) => <a key={k} className="text-coral-text underline mr-2" href={u} target="_blank" rel="noopener noreferrer">Image {k + 1}</a>)}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function ApprovalsClient({ tab, page, detail, canEdit }: { tab: string; page: ApprovalsPage; detail: ApprovalDetail | null; canEdit: boolean }) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [auto, setAuto] = useState(page.rules.price_auto_pct == null ? '' : String(page.rules.price_auto_pct));
  const [days, setDays] = useState(page.rules.ship_within_days == null ? '' : String(page.rules.ship_within_days));
  const [cum, setCum] = useState(page.rules.price_cum_30d_pct == null ? '' : String(page.rules.price_cum_30d_pct));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const needsChecklist = detail && (detail.kind === 'new_product' || detail.kind === 'bulk_upload');
  const decide = (action: 'approve' | 'changes' | 'reject') => start(async () => {
    if (!detail) return;
    const r = await decideApprovalAction(detail.id, action, note, checks);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: action === 'approve' ? (r.data.product_ids.length ? `Approved. ${r.data.product_ids.length} draft product${r.data.product_ids.length === 1 ? '' : 's'} created in the catalog manager.` : 'Approved.') : action === 'changes' ? 'Sent back to the supplier.' : 'Rejected.' });
    router.push(`/office/dropship/approvals?tab=${tab}`);
    router.refresh();
  });
  const saveRules = () => start(async () => {
    const r = await saveRulesAction(auto.trim() === '' ? null : Number(auto), days.trim() === '' ? null : Number(days), cum.trim() === '' ? null : Number(cum));
    setMsg(r.ok ? { ok: true, text: 'Rules saved.' } : { ok: false, text: r.message });
    if (r.ok) router.refresh();
  });
  const open = detail && detail.status === 'submitted';

  return (
    <div className="flex flex-col gap-5" data-testid="staff-approvals-page">
      <DsPageHeader title="Supplier approvals" subtitle="Review products and changes sent by suppliers before merchants see them." icon="check" />
      <div role="group" aria-label="Approval filters" className="flex flex-wrap gap-2">
        {TABS.map(([k, l, c]) => <DsChip key={k} pressed={tab === k} onClick={() => router.push(`/office/dropship/approvals?tab=${k}`)}>{l} ({page.counts[c]})</DsChip>)}
      </div>
      {page.rows.length === 0 ? (
        <DsEmptyState title="Nothing here" description="When a supplier sends a product or a change it appears under To review." icon="check" />
      ) : (
        <DsTableCard title="Supplier submissions" headers={['Item', 'Supplier', 'Type', 'Status', '']} minWidth={640}>
          {page.rows.map((r) => {
            const st = SUBMISSION_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
            return (
              <tr key={r.id} data-testid="approval-row">
                <td className="font-semibold">{r.summary}</td><td>{r.supplier_code}<div className="text-[12px] text-muted">{r.supplier_name}</div></td>
                <td>{SUBMISSION_KIND[r.kind] ?? r.kind}{r.row_count ? ` (${r.row_count})` : ''}</td><td><DsBadge tone={st.tone}>{st.label}</DsBadge></td>
                <td><Link className="text-coral-text font-semibold min-h-[44px] inline-flex items-center" href={`/office/dropship/approvals?tab=${tab}&id=${r.id}`} aria-label={`Review ${r.summary}`}>Review</Link></td>
              </tr>
            );
          })}
        </DsTableCard>
      )}
      {detail && (
        <DsCard title={`Review: ${detail.summary}`} subtitle={`${SUBMISSION_KIND[detail.kind]} from ${detail.supplier_code} · sent ${fmtDay(detail.created_at)}`} icon="file" testId="approval-detail">
          {detail.kind === 'price_change' && (
            <p className="m-0 text-[14px]">Cost change from <b>{usd(detail.payload.old_minor)}</b> to <b>{usd(detail.payload.new_minor)}</b> ({detail.payload.direction === 'decrease' ? '−' : '+'}{detail.payload.pct}%{detail.payload.cum_pct != null ? `; ${detail.payload.cum_pct}% over the last 30 days` : ''}). Approving applies it from today; prices already quoted to merchants and paid orders keep theirs, and merchants see the new landed cost only after your pricing rules run.</p>
          )}
          {detail.kind === 'stock_update' && <p className="m-0 text-[14px]">Stock changed from {detail.payload.from_qty ?? '—'} to {detail.payload.to_qty ?? '—'}. Stock updates are approved automatically.</p>}
          {needsChecklist && <Products list={detail.kind === 'bulk_upload' ? (detail.payload.products ?? []) : [detail.payload as ProductPayload]} />}
          {detail.review_note && <p className="text-[14px] mt-3 mb-0"><b>Note to supplier:</b> {detail.review_note}</p>}
          {detail.product_ids.length > 0 && (
            <p className="text-[14px] mt-3 mb-0">Draft products: {detail.product_ids.map((id, i) => <Link key={id} className="text-coral-text underline mr-2" href={`/office/dropship/${id}`}>Open draft {i + 1}</Link>)} Link each variant to its Sourcing supplier product, then publish with the checklist.</p>
          )}
          {open && canEdit && (
            <div className="mt-4 flex flex-col gap-3">
              {needsChecklist && (
                <fieldset className="border-0 p-0 m-0"><legend className="font-semibold text-[14px] mb-1">Checklist</legend>
                  {CHECKS.map(([k, l, a]) => (
                    <DsCheckbox key={k} label={<>{l}{a && <span className="ml-2 text-[12px] text-muted">{detail.auto[a] ? '(automatic check passed)' : '(automatic check found a problem)'}</span>}</>} checked={!!checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
                  ))}
                </fieldset>
              )}
              <DsTextarea label="Note to supplier" value={note} onChange={(e) => setNote(e.target.value)} rows={3} hint="Needed to ask for changes or to reject." />
              <div className="flex flex-wrap gap-2">
                <DsButton onClick={() => decide('approve')} loading={pending} icon="check" testId="approval-approve">Approve and add to catalog</DsButton>
                <DsButton variant="secondary" onClick={() => decide('changes')} loading={pending} >Ask for changes</DsButton>
                <DsButton variant="danger" onClick={() => decide('reject')} loading={pending}>Reject</DsButton>
              </div>
            </div>
          )}
          {open && !canEdit && <p className="text-[14px] text-muted mt-3 mb-0">You can read this item but not decide it.</p>}
        </DsCard>
      )}
      <DsCard title="Auto approval rules" subtitle="Stock updates and price decreases are always approved automatically. New products and anything touching customs data are always reviewed by staff. Prices already quoted to merchants never change." icon="gear" testId="approval-rules">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <DsInput label="Approve price increases up to (%)" inputMode="numeric" value={auto} onChange={(e) => setAuto(e.target.value)} hint="Staff are notified. Empty = every increase is reviewed." disabled={!canEdit} />
          <DsInput label="Review when increases in 30 days pass (%)" inputMode="numeric" value={cum} onChange={(e) => setCum(e.target.value)} hint="Empty = no 30-day limit." disabled={!canEdit} />
          <DsInput label="Suppliers ship within (days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} hint="Empty = no ship-by date is shown." disabled={!canEdit} />
          <div><DsButton variant="secondary" onClick={saveRules} loading={pending} disabled={!canEdit} disabledReason={!canEdit ? 'Editing needs Dropship division access' : undefined}>Save rules</DsButton></div>
        </div>
      </DsCard>
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Could not save'} testId="approvals-msg">{msg.text}</DsNotice>}
    </div>
  );
}
