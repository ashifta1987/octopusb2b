import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Tabs } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { fmtDate, humanize, money, productStatusView } from '@/lib/format';
import { decideReview, setProductPricing } from '../actions';

export const metadata = { title: 'Import review' };

type Item = { id: string; external_id: string; kind: string; issue: string; evidence: string | null; status: string; decision_note: string | null; decided_at: string | null; run_id: string | null; product_id: string | null };
type Prod = { id: string; external_id: string; title: string; status: string; listing_status: string; markup_pct: number | null; sell_price_mode: string; min_price_cents: number | null; currency: string; moq: number;
  price_tiers: { min_qty: number; unit_price_cents: number }[]; product_costs: { supplier_cost_cents: number } | { supplier_cost_cents: number }[] | null };

const TAB_STATUS: Record<string, string[]> = { open: ['open'], held: ['held'], done: ['accepted_quote', 'accepted_dashboard', 'resolved'] };

/** Review queue (ADDON-27 §7): each flagged row with its evidence and a one-click decision; plus buyer pricing per product. */
export default async function ImportReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; run?: string }> }) {
  const s = await requireStaff('products', 'view', '/admin/import/review');
  const sp = await searchParams;
  const tab = sp.tab && TAB_STATUS[sp.tab] ? sp.tab : 'open';
  const sb = await createClient();
  let q = sb.from('import_review_items').select('*').order('external_id').order('created_at').limit(500);
  if (sp.run) q = q.eq('run_id', sp.run);
  const [{ data: all }, { data: markup }] = await Promise.all([q, sb.from('site_settings').select('value').eq('key', 'pricing.default_markup_pct').maybeSingle()]);
  const items = (all ?? []) as Item[];
  const shown = items.filter((i) => TAB_STATUS[tab].includes(i.status));
  const count = (t: string) => items.filter((i) => TAB_STATUS[t].includes(i.status)).length;
  const edit = can(s, 'products', 'edit');
  const defMarkup = Number(markup?.value ?? 25);

  const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];
  const { data: prods } = pids.length
    ? await sb.from('products').select('id, external_id, title, status, listing_status, markup_pct, sell_price_mode, min_price_cents, currency, moq, price_tiers(min_qty, unit_price_cents), product_costs(supplier_cost_cents)').in('id', pids).order('external_id')
    : { data: [] };
  const prodBy = new Map(((prods ?? []) as Prod[]).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/import" className="text-coral-text">← Bulk import</Link>} title="Import review queue"
        subtitle="A product cannot be published while it has open or held items here, or while its supplier's legal name is unresolved." />
      <Tabs base="/admin/import/review" param={sp.run ? `run=${encodeURIComponent(sp.run)}&tab` : 'tab'} active={tab} tabs={[{ key: 'open', label: 'Open', count: count('open') }, { key: 'held', label: 'Held', count: count('held') }, { key: 'done', label: 'Resolved', count: count('done') }]} />
      <Card className="mb-6">
        <Table head={['Product', 'Issue', 'Evidence', 'Decision']} empty={<EmptyState title={tab === 'open' ? 'Nothing waiting for a decision' : 'No items here'} />}>
          {shown.map((i) => {
            const p = i.product_id ? prodBy.get(i.product_id) : undefined;
            return (
              <tr key={i.id}>
                <td className="td text-sm align-top min-w-[180px]"><div className="mono">{i.external_id}</div>{p && <div className="text-muted">{p.title}</div>}<StatusBadge status={i.kind} /></td>
                <td className="td text-sm align-top max-w-[420px]">{i.issue}</td>
                <td className="td text-xs text-muted align-top">{i.evidence}</td>
                <td className="td align-top">
                  {i.status === 'open' || i.status === 'held' ? (edit && (
                    <div className="flex flex-wrap gap-2">
                      <RunButton className="btn btn-ghost btn-sm" prompt="Accept the supplier QUOTE figures. Optional note:" action={decideReview.bind(null, i.id, 'accepted_quote')}>Accept quote</RunButton>
                      <RunButton className="btn btn-ghost btn-sm" prompt="Accept the DASHBOARD / listing figures. Optional note:" action={decideReview.bind(null, i.id, 'accepted_dashboard')}>Accept dashboard</RunButton>
                      <RunButton className="btn btn-ghost btn-sm" prompt="Mark resolved (e.g. confirmed with the supplier). Note:" action={decideReview.bind(null, i.id, 'resolved')}>Resolved</RunButton>
                      {i.status === 'open' && <RunButton className="btn btn-ghost btn-sm" prompt="Hold — why?" action={decideReview.bind(null, i.id, 'held')}>Hold</RunButton>}
                    </div>
                  )) : (
                    <div className="text-sm"><StatusBadge status={i.status} />{i.decision_note && <div className="text-muted mt-1">{i.decision_note}</div>}<div className="text-xs text-muted">{fmtDate(i.decided_at, true)}</div>
                      {edit && <RunButton className="btn btn-ghost btn-sm mt-1" action={decideReview.bind(null, i.id, 'open')}>Reopen</RunButton>}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Buyer prices for these products" action={<span className="text-xs text-muted">Buyer price = supplier cost × (1 + markup). Default markup {defMarkup}% (Admin → Wallets &amp; payments → settings key pricing.default_markup_pct)</span>}>
        <div className="px-6 pb-3"><Notice tone="blue">Supplier costs are visible to staff only. Customers see the buyer price tiers.</Notice></div>
        <Table head={['Product', 'Status', 'Supplier cost (lowest)', 'Buyer price tiers', 'Pricing']} empty={<EmptyState title="No products" />}>
          {((prods ?? []) as Prod[]).map((p) => {
            const cost = Array.isArray(p.product_costs) ? p.product_costs[0] : p.product_costs;
            return (
              <tr key={p.id}>
                <td className="td text-sm"><div className="mono">{p.external_id}</div><div className="text-muted max-w-[260px] truncate">{p.title}</div></td>
                <td className="td"><StatusBadge {...productStatusView(p.status, p.listing_status)} /> <span className="text-xs text-muted">{humanize(p.listing_status)}</span></td>
                <td className="td mono text-sm">{cost ? money(cost.supplier_cost_cents, p.currency) : '—'}</td>
                <td className="td mono text-xs">{[...(p.price_tiers ?? [])].sort((a, b) => a.min_qty - b.min_qty).map((t) => <div key={t.min_qty}>{t.min_qty}+ · {money(t.unit_price_cents, p.currency)}</div>)}{!p.price_tiers?.length && <span className="text-muted">none</span>}</td>
                <td className="td">
                  {edit ? (
                    <ActionForm action={setProductPricing} className="flex flex-wrap items-end gap-2" submitLabel="Apply" submitClass="btn btn-ghost btn-sm">
                      <input type="hidden" name="product_id" value={p.id} />
                      <label className="text-xs"><span className="sr-only">Markup %</span>
                        <input name="markup" type="number" min={0} max={1000} step="0.5" className="input w-24 py-1" placeholder={`${defMarkup}%`} defaultValue={p.markup_pct ?? ''} aria-label={`Markup % for ${p.external_id}`} />
                      </label>
                      <select name="mode" className="input w-auto py-1" defaultValue={p.sell_price_mode} aria-label={`Pricing mode for ${p.external_id}`}>
                        <option value="markup">From cost</option><option value="manual">Manual</option>
                      </select>
                    </ActionForm>
                  ) : <span className="text-sm">{p.sell_price_mode === 'manual' ? 'Manual' : `${p.markup_pct ?? defMarkup}%`}</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
