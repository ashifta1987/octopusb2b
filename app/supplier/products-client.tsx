'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsChip, DsEmptyState, DsLinkButton, DsNotice, DsPageHeader, DsTableCard } from '@/components/dropship-ui';
import { PRODUCT_STATUS, SUBMISSION_KIND, SUBMISSION_STATUS } from '@/lib/dropship-ds14-shared';
import type { SupHome, SupProduct, SupProducts } from '@/lib/dropship-ds14';
import { priceAction, stockAction } from './actions';
import { SupplierFrame } from './frame';

type Tab = 'all' | 'live' | 'review' | 'draft';
const inTab = (s: string, t: Tab) => t === 'all' || (t === 'live' && s === 'live') || (t === 'review' && (s === 'submitted' || s === 'in_review')) || (t === 'draft' && s === 'draft');

function ProductRow({ p }: { p: SupProduct }) {
  const price = p.prices[0] ?? null;
  const [stock, setStock] = useState(p.stock_qty == null ? '' : String(p.stock_qty));
  const [cost, setCost] = useState(price ? (price.price_minor / 100).toFixed(2) : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const st = PRODUCT_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as const };
  const out = p.stock_qty === 0;
  const save = () => start(async () => {
    const done: string[] = [];
    if (stock !== '' && Number(stock) !== p.stock_qty) {
      const r = await stockAction(p.id, Number(stock));
      if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
      done.push('Stock saved');
    }
    if (price && cost !== '' && Math.round(Number(cost) * 100) !== price.price_minor) {
      const r = await priceAction(price.id, cost);
      if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
      done.push(r.data.status === 'auto_approved' ? 'Cost saved' : 'Cost change sent for review');
    }
    setMsg(done.length ? { ok: true, text: done.join('. ') } : { ok: false, text: 'Nothing changed.' });
  });
  return (
    <tr data-testid="supplier-product-row">
      <td><div className="font-semibold">{p.title}</div><div className="text-[12px] text-[#5B6478]">Model {p.model ?? '—'}</div></td>
      <td>{p.variants}</td>
      <td>
        {price ? (
          <span className="flex items-center gap-1">
            <span aria-hidden>{price.currency === 'USD' ? '$' : price.currency}</span>
            <input className="ds-input w-24" inputMode="decimal" aria-label={`Your cost for ${p.title}`} value={cost} onChange={(e) => setCost(e.target.value)} />
          </span>
        ) : <span className="text-[#5B6478]">No cost set</span>}
      </td>
      <td>
        <label className="flex items-center gap-1"><span className="sr-only">Stock for {p.title}</span>
          <input className="ds-input w-24" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Not tracked" />
        </label>
      </td>
      <td>
        <div className="flex flex-wrap gap-1.5">
          <DsBadge tone={out ? 'bad' : st.tone}>{out ? 'Out of stock' : st.label}</DsBadge>
          {p.in_dropship && <DsBadge tone="ok">Selling</DsBadge>}
        </div>
        {p.rejection_reason && <div className="text-[12px] text-[#8A5300] mt-1">{p.rejection_reason}</div>}
      </td>
      <td>
        <DsButton variant="secondary" loading={pending} onClick={save} aria-label={`Save changes for ${p.title}`}>Save</DsButton>
        {msg && <div role={msg.ok ? 'status' : 'alert'} className={`text-[12px] mt-1 ${msg.ok ? 'text-[#0B6A65]' : 'text-[#B42318]'}`}>{msg.text}</div>}
      </td>
    </tr>
  );
}

export function ProductsClient({ home, data }: { home: SupHome; data: SupProducts }) {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => data.products.filter((p) => inTab(p.status, tab) && (!q.trim() || `${p.title} ${p.model ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [data.products, tab, q]);
  const count = (t: Tab) => data.products.filter((p) => inTab(p.status, t)).length;
  return (
    <SupplierFrame testId="supplier-products-page">
      <DsPageHeader
        title="Your products"
        subtitle="Keep price and stock up to date. New products are reviewed before they go live."
        icon="package"
        actions={<><DsLinkButton href="/supplier/products/import" variant="secondary" icon="upload">Bulk upload</DsLinkButton><DsLinkButton href="/supplier/products/new" icon="plus">Add product</DsLinkButton></>}
      />
      <div className="grid sm:grid-cols-4 gap-3" data-testid="supplier-week">
        {[['Orders to ship', home.to_ship], ['Out of stock', home.out_of_stock], ['Waiting for review', home.in_review]].map(([l, v]) => (
          <DsCard key={String(l)}><div className="text-[13px] text-[#5B6478]">{l}</div><div className="text-[26px] font-bold">{v}</div></DsCard>
        ))}
        <DsCard><div className="text-[13px] text-[#5B6478]">Open orders</div><Link className="text-[#2A6FD1] font-semibold min-h-[44px] inline-flex items-center" href="/supplier/orders">Open orders</Link></DsCard>
      </div>
      {home.attention.length > 0 && (
        <DsNotice tone="warn" title="Needs your attention" testId="supplier-attention">
          <ul className="m-0 pl-4">{home.attention.map((t) => <li key={t}>{t}</li>)}</ul>
        </DsNotice>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {([['all', 'All'], ['live', 'Live'], ['review', 'In review'], ['draft', 'Drafts']] as [Tab, string][]).map(([k, l]) => (
          <DsChip key={k} pressed={tab === k} onClick={() => setTab(k)}>{l} ({count(k)})</DsChip>
        ))}
        <label className="ml-auto"><span className="sr-only">Search products</span>
          <input className="ds-input w-[240px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {rows.length === 0 ? (
        <DsEmptyState title="No products here" description="Products linked to your account appear here once Octopus has set them up. Add a product to send one for review." actionLabel="Add product" actionHref="/supplier/products/new" actionIcon="plus" />
      ) : (
        <DsTableCard title="Price and stock" subtitle={data.auto_price_pct != null ? `Cost changes up to ${data.auto_price_pct}% are applied at once. Larger changes go to review before merchants see them.` : 'Every cost change goes to review before merchants see it. Stock updates apply at once.'} headers={['Product', 'Variants', 'Your cost', 'Stock', 'Status', '']} minWidth={760}>
          {rows.map((p) => <ProductRow key={p.id} p={p} />)}
        </DsTableCard>
      )}
      {data.submissions.length > 0 && (
        <DsTableCard title="Sent to Octopus" subtitle="New products, bulk uploads and cost changes you sent for review." headers={['Item', 'Type', 'Status', 'Note from Octopus', '']} minWidth={640} testId="supplier-submissions">
          {data.submissions.map((s) => {
            const st = SUBMISSION_STATUS[s.status] ?? { label: s.status, tone: 'neutral' as const };
            return (
              <tr key={s.id}>
                <td className="font-semibold">{s.summary}</td><td>{SUBMISSION_KIND[s.kind] ?? s.kind}</td>
                <td><DsBadge tone={st.tone}>{st.label}</DsBadge></td><td>{s.review_note ?? '—'}</td>
                <td>{s.editable && s.kind === 'new_product' ? <Link className="text-[#2A6FD1] font-semibold min-h-[44px] inline-flex items-center" href={`/supplier/products/new?edit=${s.id}`}>Edit</Link> : null}</td>
              </tr>
            );
          })}
        </DsTableCard>
      )}
      <p className="text-[12px] text-[#5B6478] m-0">Merchants never see your name and you never see theirs.</p>
    </SupplierFrame>
  );
}
