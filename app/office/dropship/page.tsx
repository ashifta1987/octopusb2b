import { Suspense } from 'react';
import Link from 'next/link';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { bulkArchiveDropshipProducts } from './actions';
import { DsIcon } from '@/components/dropship-ui';

export const metadata = { title: 'Dropshipping catalogue · Back office' };

type SP = { q?: string; status?: string; supplier?: string };

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_BADGE: Record<string, [string, string]> = {
  active: ['Active', 'bg-ok-bg text-ok'],
  draft: ['Draft', 'bg-warn-bg text-warn'],
  archived: ['Archived', 'bg-pearl text-muted'],
};

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<div className="card p-6 animate-pulse">Loading Dropshipping catalogue…</div>}>
      <StaffDropshipList searchParams={searchParams} />
    </Suspense>
  );
}

async function StaffDropshipList({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireDropshipStaff(false);
  const sp = await searchParams;
  const sb = await createClient();

  const [prodsRes, routesRes, supsRes] = await Promise.all([
    sb
      .from('dropship_products')
      .select(
        'id, octopus_sku, title, category, images, weight_g, unit_cost_cents, min_order_qty, stock_status, stock_qty, source_type, supplier_id, supplier_sku, status, is_test, updated_at',
      )
      .order('updated_at', { ascending: false }),
    sb
      .from('dropship_routes')
      .select('product_id, destination_country, shipping_method, landed_price_cents, is_active'),
    staff.canSeeCosts
      ? sb
        .from('suppliers')
        .select('id, code, legal_name, verified')
        .is('archived_at', null)
        .order('code')
      : Promise.resolve({ data: null }),
  ]);

  const sups = (supsRes.data ?? []) as {
    id: string;
    code: string;
    legal_name: string;
    verified: boolean;
  }[];
  const supById = new Map(sups.map((s) => [s.id, s]));

  const routesByProd = new Map<string, { countries: Set<string>; activeCount: number }>();
  for (const r of routesRes.data ?? []) {
    const pid = r.product_id as string;
    const cur = routesByProd.get(pid) ?? { countries: new Set<string>(), activeCount: 0 };
    if (r.is_active) {
      cur.countries.add(String(r.destination_country));
      cur.activeCount++;
    }
    routesByProd.set(pid, cur);
  }

  const q = (sp.q ?? '').trim().toLowerCase();
  const statusFilter = ['draft', 'active', 'archived'].includes(sp.status ?? '')
    ? sp.status!
    : '';
  const supplierFilter = staff.canSeeCosts && sp.supplier ? sp.supplier : '';

  const rows = (prodsRes.data ?? []).filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (supplierFilter && p.supplier_id !== supplierFilter) return false;
    if (q) {
      const match =
        String(p.title ?? '').toLowerCase().includes(q) ||
        String(p.octopus_sku ?? '').toLowerCase().includes(q) ||
        String(p.category ?? '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div data-testid="staff-dropship-list">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[26px] font-bold leading-tight flex items-center gap-3 flex-wrap text-[#1A174A]">
            <span
              data-page-icon=""
              aria-hidden="true"
              className="w-10 h-10 rounded-[10px] bg-[#E6EFFB] text-[#2A6FD1] inline-flex items-center justify-center shrink-0"
            >
              <DsIcon name="package" size={20} strokeWidth={2} />
            </span>
            <span>Dropship products</span>
          </h1>
          <p className="text-[14px] text-[#5B6478] mt-1.5 mb-0">
            /office/dropship · what merchants can buy, and what they must never see.
            {!staff.canEdit && (
              <span className="ml-2 ds-badge ds-badge-neutral">
                Read-only ({staff.isSupportOnly ? 'Support — cost & supplier hidden' : 'Finance'})
              </span>
            )}
          </p>
        </div>
        {staff.canEdit && (
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/office/dropship/import"
              className="ds-btn ds-btn-secondary"
              data-testid="csv-import-link"
            >
              <DsIcon name="upload" size={16} />
              Import products
            </Link>
            <Link
              href="/office/dropship/new"
              className="ds-btn ds-btn-primary"
              data-testid="add-product-link"
            >
              <DsIcon name="plus" size={16} />
              Add product
            </Link>
          </div>
        )}
      </div>

      <form
        action="/office/dropship"
        className="card p-4 mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end"
        data-testid="staff-dropship-filters"
      >
        <div>
          <label htmlFor="ds-q" className="k block mb-1.5">
            Search
          </label>
          <input
            id="ds-q"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Title, Octopus SKU or category"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="ds-status" className="k block mb-1.5">
            Status
          </label>
          <select id="ds-status" name="status" defaultValue={statusFilter} className="input">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        {staff.canSeeCosts && (
          <div>
            <label htmlFor="ds-sup" className="k block mb-1.5">
              Supplier
            </label>
            <select id="ds-sup" name="supplier" defaultValue={supplierFilter} className="input">
              <option value="">All suppliers</option>
              {sups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.legal_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-dark min-h-10">
            Filter
          </button>
          {(sp.q || statusFilter || supplierFilter) && (
            <Link href="/office/dropship" className="btn btn-ghost min-h-10">
              Clear
            </Link>
          )}
        </div>
      </form>

      <form action={bulkArchiveDropshipProducts} className="card mt-5 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <span className="text-[14px] font-semibold">
            {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </span>
          {staff.canEdit && rows.length > 0 && (
            <button
              type="submit"
              className="btn btn-ghost min-h-9 text-[13px]"
              data-testid="bulk-archive-btn"
            >
              Archive selected
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-[15px] text-muted">
            No Dropshipping products match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dropship products">
            <table className="ds-tbl min-w-[760px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {staff.canEdit && <th className="th w-10">Select</th>}
                  <th className="th">Octopus SKU</th>
                  <th className="th">Product</th>
                  <th className="th">Status</th>
                  <th className="th">Stock</th>
                  <th className="th">Active routes</th>
                  {staff.canSeeCosts && (
                    <>
                      <th className="th text-right">Unit cost</th>
                      <th className="th">Supplier (staff only)</th>
                    </>
                  )}
                  <th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const id = p.id as string;
                  const [stLabel, stTone] = STATUS_BADGE[String(p.status)] ?? [
                    String(p.status),
                    'bg-pearl text-muted',
                  ];
                  const rtInfo = routesByProd.get(id);
                  const countries = rtInfo ? [...rtInfo.countries].sort().join(', ') : 'None';
                  const sup = p.supplier_id ? supById.get(p.supplier_id as string) : null;
                  const imgs = Array.isArray(p.images) ? (p.images as string[]) : [];
                  return (
                    <tr
                      key={id}
                      className="border-b border-line last:border-0"
                      data-testid="staff-product-row"
                    >
                      {staff.canEdit && (
                        <td className="td">
                          <input
                            type="checkbox"
                            name="ids"
                            value={id}
                            aria-label={`Select ${p.title}`}
                            className="accent-ink w-4 h-4"
                          />
                        </td>
                      )}
                      <td className="td mono font-semibold whitespace-nowrap">
                        {p.octopus_sku as string}
                        {p.is_test && (
                          <span className="ml-1.5 pill bg-warn-bg text-warn">TEST</span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          {imgs[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imgs[0]}
                              alt={String(p.title)}
                              className="w-10 h-10 rounded object-cover bg-pearl shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-pearl border border-line flex items-center justify-center text-[11px] text-muted shrink-0">
                              No img
                            </div>
                          )}
                          <div>
                            <Link
                              href={`/office/dropship/${id}`}
                              className="font-bold hover:text-coral-text"
                            >
                              {p.title as string}
                            </Link>
                            <div className="text-[12px] text-muted">
                              {(p.category as string) || 'Uncategorised'} · {Number(p.weight_g)} g ·{' '}
                              {imgs.length} {imgs.length === 1 ? 'photo' : 'photos'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <span className={`pill ${stTone}`}>{stLabel}</span>
                      </td>
                      <td className="td whitespace-nowrap">
                        {String(p.stock_status).replace('_', ' ')}
                        {p.stock_qty != null ? ` (${Number(p.stock_qty)})` : ''}
                      </td>
                      <td className="td whitespace-nowrap">
                        {rtInfo?.activeCount ? `${rtInfo.activeCount} (${countries})` : '0 routes'}
                      </td>
                      {staff.canSeeCosts && (
                        <>
                          <td
                            className="td text-right tabular-nums font-semibold whitespace-nowrap"
                            data-testid="staff-unit-cost"
                          >
                            {usd(Number(p.unit_cost_cents ?? 0))}
                          </td>
                          <td className="td text-[12.5px]" data-testid="staff-supplier">
                            {sup ? (
                              <div>
                                <span className="mono font-semibold">{sup.code}</span> ·{' '}
                                {sup.legal_name}
                                {p.supplier_sku ? (
                                  <div className="text-muted mono">
                                    Mfr SKU: {p.supplier_sku as string}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-muted">Own warehouse</span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="td text-right whitespace-nowrap">
                        <Link
                          href={`/office/dropship/${id}`}
                          className="text-coral-text font-semibold hover:underline"
                        >
                          {staff.canEdit ? 'Edit' : 'View'} →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </form>
    </div>
  );
}
