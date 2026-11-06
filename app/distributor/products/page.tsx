import Link from 'next/link';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Money } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { supplierScope } from '@/lib/distributor/supplier-scope';
import { RunButton } from '@/components/backoffice/action-form';
import { transitionProduct } from './actions';
import { productStatusView, fmtDate } from '@/lib/format';

const STATUSES = ['draft', 'submitted', 'in_review', 'live', 'rejected', 'paused', 'archived'];

export default async function DistributorProducts({ searchParams }: { searchParams: Promise<{ status?: string; supplier?: string; category?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const s = (await getSession())!;
  const sb = await createClient();
  // ?supplier=<code>: resolved against the suppliers this user can see (RLS) — an unassigned code is a 404
  const { suppliers, selected } = await supplierScope(s, sp.supplier);
  const supParam = selected?.code;
  const ids = selected ? [selected.id] : suppliers.map((x) => x.id);
  const allIds = suppliers.map((x) => x.id);
  // per-supplier counts (dropdown) and the categories in use, for every assigned supplier, not archived
  const facets: { supplier_id: string; category_id: string | null }[] = [];
  for (let from = 0; allIds.length; from += 1000) {
    const { data } = await sb.from('products').select('supplier_id, category_id').in('supplier_id', allIds).neq('status', 'archived').range(from, from + 999);
    facets.push(...((data ?? []) as typeof facets));
    if ((data ?? []).length < 1000) break;
  }
  const countBy = new Map<string, number>();
  facets.forEach((f) => countBy.set(f.supplier_id, (countBy.get(f.supplier_id) ?? 0) + 1));
  const catIds = [...new Set(facets.filter((f) => ids.includes(f.supplier_id) && f.category_id).map((f) => f.category_id as string))];
  const { data: catRows } = catIds.length ? await sb.from('categories').select('id, name').in('id', catIds).order('name') : { data: [] as { id: string; name: string }[] };
  const category = sp.category && /^[0-9a-f-]{36}$/i.test(sp.category) ? sp.category : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const size = 50;
  type Row = { id: string; external_id: string | null; title: string; status: string; listing_status: string | null; moq: number; unit: string; min_price_cents: number | null; currency: string; image_url: string | null; updated_at: string; rejection_reason: string | null; suppliers: { code: string } | null; categories: { name: string } | null };
  let rows: Row[] = [];
  let total = 0;
  if (ids.length) {
    let q = sb.from('products')
      .select('id, external_id, title, status, listing_status, moq, unit, min_price_cents, currency, image_url, updated_at, rejection_reason, suppliers!products_supplier_id_fkey(code), categories(name)', { count: 'exact' })
      .in('supplier_id', ids).order('updated_at', { ascending: false }).range((page - 1) * size, page * size - 1);
    if (sp.status && STATUSES.includes(sp.status)) q = q.eq('status', sp.status);
    else q = q.neq('status', 'archived');
    if (category) q = q.eq('category_id', category);
    if (sp.q) { const t = sp.q.replace(/[%,()]/g, ' ').trim(); q = q.or(`title.ilike.%${t}%,external_id.ilike.%${t}%`); }
    const { data, count } = await q;
    rows = ((data ?? []) as unknown as (Row & { suppliers: Row['suppliers'] | Row['suppliers'][]; categories: Row['categories'] | Row['categories'][] })[])
      .map((r) => ({ ...r, suppliers: one(r.suppliers), categories: one(r.categories) }));
    total = count ?? 0;
  }
  const canApprove = can(s, 'products', 'approve');
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { supplier: supParam, status: sp.status, category, q: sp.q, ...o };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title={selected ? `Products · ${selected.code} · ${selected.legal_name}` : 'Products'}
        subtitle={selected ? 'Only this supplier\'s products. Drafts autosave; submit them for moderation when ready.' : 'Products of the suppliers assigned to you. Drafts autosave; submit them for moderation when ready.'}
        eyebrow={selected ? (
          <Link href={qs({ supplier: undefined, page: undefined })} data-testid="clear-supplier"
            className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-white px-3 py-1 text-[13px] font-semibold hover:border-navy">
            <span aria-hidden>×</span> All suppliers
          </Link>
        ) : undefined}
        actions={<>
          <a href={`/distributor/products/import/export${supParam ? `?supplier=${encodeURIComponent(supParam)}` : ''}`} className="btn btn-ghost" data-testid="download-mine">Download my products</a>
          <Link href={`/distributor/products/import${supParam ? `?supplier=${encodeURIComponent(supParam)}` : ''}`} className="btn btn-ghost">Bulk upload</Link>
          <Link href={`/distributor/products/new${selected ? `?supplier=${selected.id}` : ''}`} className="btn btn-primary">+ Create product</Link>
        </>} />

      <form className="card p-4 mb-4 flex flex-wrap gap-3 items-end" role="search">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="f-q" className="label">Search title</label>
          <input id="f-q" name="q" defaultValue={sp.q} className="input" placeholder="e.g. hex bolts" />
        </div>
        <div>
          <label htmlFor="f-sup" className="label">Supplier</label>
          <select id="f-sup" name="supplier" defaultValue={supParam ?? ''} className="input" data-testid="supplier-filter">
            <option value="">All suppliers ({facets.length})</option>
            {suppliers.map((x) => <option key={x.id} value={x.code}>{x.code} · {x.legal_name} ({countBy.get(x.id) ?? 0})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-st" className="label">Status</label>
          <select id="f-st" name="status" defaultValue={sp.status ?? ''} className="input">
            <option value="">All (except archived)</option>
            {STATUSES.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-cat" className="label">Category</label>
          <select id="f-cat" name="category" defaultValue={category ?? ''} className="input">
            <option value="">All categories</option>
            {(catRows ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button className="btn btn-dark">Filter</button>
        <Link href={supParam ? `/distributor/products?supplier=${encodeURIComponent(supParam)}` : '/distributor/products'} className="btn btn-ghost">Reset</Link>
      </form>

      <Card>
        <Table head={['Product', 'Product Id', 'Supplier', 'Category', 'From', 'MOQ', 'Status', 'Updated', '']}
          empty={<EmptyState title={ids.length ? 'No products match' : 'No suppliers assigned'} body={ids.length ? 'Try a different filter or create a product.' : 'Ask an Admin to assign suppliers to you.'}
            action={ids.length ? <Link href="/distributor/products/new" className="btn btn-primary btn-sm">Create product</Link> : undefined} />}>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="td">
                <div className="flex items-center gap-3">
                  {p.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image_url} alt="" className="w-11 h-11 rounded-md object-cover border border-line" />
                    : <div className="ph w-11 h-11 rounded-md" aria-hidden>img</div>}
                  <div>
                    <Link href={`/distributor/products/${p.id}/edit`} className="font-semibold hover:underline">{p.title}</Link>
                    {p.status === 'rejected' && p.rejection_reason && <div className="text-xs text-bad">Rejected: {p.rejection_reason}</div>}
                  </div>
                </div>
              </td>
              <td className="td mono text-xs">{p.external_id ?? '—'}</td>
              <td className="td mono text-sm">{p.suppliers?.code}</td>
              <td className="td text-sm">{p.categories?.name ?? <span className="text-warn">None</span>}</td>
              <td className="td"><Money cents={p.min_price_cents} currency={p.currency} /></td>
              <td className="td text-sm">{p.moq} {p.unit}</td>
              <td className="td"><StatusBadge {...productStatusView(p.status, p.listing_status)} /></td>
              <td className="td text-sm text-muted">{fmtDate(p.updated_at)}</td>
              <td className="td">
                <div className="flex flex-wrap gap-2 justify-end">
                  <Link href={`/distributor/products/${p.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                  {['draft', 'rejected'].includes(p.status) && <RunButton className="btn btn-primary btn-sm" action={transitionProduct.bind(null, p.id, 'submitted', undefined)}>Submit</RunButton>}
                  {p.status === 'live' && <RunButton action={transitionProduct.bind(null, p.id, 'paused', undefined)} confirm="Pause this listing? Buyers will no longer see it.">Pause</RunButton>}
                  {p.status === 'paused' && canApprove && <RunButton action={transitionProduct.bind(null, p.id, 'live', undefined)}>Resume</RunButton>}
                  {['draft', 'live', 'paused'].includes(p.status) && <RunButton className="btn btn-ghost btn-sm text-bad" action={transitionProduct.bind(null, p.id, 'archived', undefined)} confirm="Archive this product? This cannot be undone from here.">Archive</RunButton>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
        {total > 0 && (
          <div className="flex justify-between items-center px-6 py-4 border-t border-line text-sm">
            <span className="text-muted" data-testid="product-count">{total} product{total === 1 ? '' : 's'}{selected ? ` · ${selected.code}` : ''} · page {page} of {Math.max(1, Math.ceil(total / size))}</span>
            <span className="flex gap-2">
              {page > 1 && <Link className="btn btn-ghost btn-sm" href={qs({ page: String(page - 1) })}>Previous</Link>}
              {page * size < total && <Link className="btn btn-ghost btn-sm" href={qs({ page: String(page + 1) })}>Next</Link>}
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
