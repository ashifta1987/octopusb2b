import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Stat, StatusBadge, EmptyState } from '@/components/ui';
import { getManagedSuppliers } from '@/components/backoffice/server-utils';
import { SupplierSwitch } from '@/components/backoffice/supplier-switch';
import { setSupplierSwitch } from './actions';

const SWITCHES = [
  { key: 'portal_login', label: 'Portal login' },
  { key: 'product_upload', label: 'Product upload' },
  { key: 'rfq_replies', label: 'RFQ replies' },
  { key: 'listings_live', label: 'Listings live' },
  { key: 'ai_tools', label: 'AI tools' },
] as const;

const STATUSES = ['draft', 'submitted', 'in_review', 'live', 'rejected', 'paused', 'archived'] as const;

export default async function DistributorHome() {
  const s = (await getSession())!;
  const sb = await createClient();
  const suppliers = await getManagedSuppliers(s);
  const ids = suppliers.map((x) => x.id);
  const [{ data: prods }, { count: openRfqs }, { data: portal }] = await Promise.all([
    ids.length ? sb.from('products').select('supplier_id, status').in('supplier_id', ids).is('archived_at', null) : Promise.resolve({ data: [] as { supplier_id: string; status: string }[] }),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'assigned', 'quoting', 'quoted']),
    sb.from('site_settings').select('value').eq('key', 'supplier_portal_enabled').maybeSingle(),
  ]);
  const counts = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const p of prods ?? []) {
    const m = counts.get(p.supplier_id) ?? {};
    m[p.status] = (m[p.status] ?? 0) + 1;
    counts.set(p.supplier_id, m);
    totals[p.status] = (totals[p.status] ?? 0) + 1;
  }
  const portalOpen = portal?.value === true || portal?.value === 'true';

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="The suppliers you manage. Create and upload their products, answer RFQs for them, and switch each supplier's access on or off."
        actions={<>
          <Link href="/distributor/products/import" className="btn btn-ghost">Bulk upload (Excel)</Link>
          <Link href="/distributor/products/new" className="btn btn-primary">Create product</Link>
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Assigned suppliers" value={suppliers.length} />
        <Stat label="Live products" value={totals.live ?? 0} />
        <Stat label="Awaiting moderation" value={(totals.submitted ?? 0) + (totals.in_review ?? 0)} hint={`${totals.draft ?? 0} drafts · ${totals.rejected ?? 0} rejected`} hintTone={(totals.rejected ?? 0) > 0 ? 'warn' : undefined} />
        <Stat label="Open RFQs" value={<Link href="/distributor/rfqs" className="hover:underline">{openRfqs ?? 0}</Link>} hint="Quote on behalf of your suppliers" />
      </div>

      <section className="rounded-[12px] border-2 border-dashed border-line-2 bg-white p-6 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Supplier self-service portal</h2>
          <p className="text-sm text-muted mt-1">
            {portalOpen
              ? 'Open: suppliers with “portal login” on can sign in and manage their own listings.'
              : 'Closed for launch: suppliers can’t sign in. Distributors create and upload all products and answer RFQs on their behalf.'}
          </p>
          <p className="text-xs text-muted mt-2">Only Admin can change this switch.</p>
        </div>
        <StatusBadge status={portalOpen ? 'open' : 'closed'} label={portalOpen ? 'OPEN' : 'CLOSED'} />
      </section>

      <Card title="Supplier access controls" action={<span className="text-sm text-muted">{suppliers.length} suppliers · changes save instantly and are logged</span>}>
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers assigned yet" body="Ask an Admin to assign suppliers to you in Admin › Staff & roles." />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Supplier</th>
                  <th className="th">Type · contact</th>
                  <th className="th">Products</th>
                  {SWITCHES.map((sw) => <th key={sw.key} className="th text-center">{sw.label}</th>)}
                  <th className="th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((sup) => {
                  const c = counts.get(sup.id) ?? {};
                  const total = Object.values(c).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={sup.id}>
                      <td className="td">
                        <div className="font-semibold">{sup.legal_name}</div>
                        <div className="mono text-xs text-muted">{sup.code} · {sup.country}{sup.city ? ` · ${sup.city}` : ''}</div>
                        {sup.verified && <span className="text-xs text-ok font-semibold">✓ Verified</span>}
                      </td>
                      <td className="td text-sm">
                        <div>{sup.supplier_type ?? '—'}</div>
                        <div className="text-xs text-muted">{sup.contact_name ?? ''} {sup.contact_email ? `· ${sup.contact_email}` : ''}</div>
                        <div className="text-xs text-muted">{sup.contact_phone ?? ''}</div>
                        {sup.main_categories && <div className="text-xs text-muted">{sup.main_categories}</div>}
                      </td>
                      <td className="td">
                        <div className="mono font-semibold">{total}</div>
                        <div className="text-xs text-muted leading-5">
                          {STATUSES.filter((st) => c[st]).map((st) => `${c[st]} ${st.replace('_', ' ')}`).join(' · ') || 'none'}
                        </div>
                      </td>
                      {SWITCHES.map((sw) => (
                        <td key={sw.key} className="td text-center">
                          <SupplierSwitch
                            initial={sup.supplier_switches?.[sw.key] ?? false}
                            label={`${sw.label} for ${sup.code}`}
                            onToggle={setSupplierSwitch.bind(null, sup.id, sw.key)}
                          />
                        </td>
                      ))}
                      <td className="td">
                        <div className="flex gap-2 justify-end">
                          <Link className="btn btn-ghost btn-sm" href={`/distributor/products/new?supplier=${sup.id}`}>+ Product</Link>
                          <Link className="btn btn-ghost btn-sm" href={`/distributor/products?supplier=${sup.id}`}>Products</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-6 py-4 border-t border-line text-sm text-muted grid gap-1 md:grid-cols-2">
          <div><b className="text-navy">Portal login</b> · supplier can sign in (only when the portal is open)</div>
          <div><b className="text-navy">Product upload</b> · products can be added or edited for this supplier</div>
          <div><b className="text-navy">RFQ replies</b> · quotes can be sent for this supplier</div>
          <div><b className="text-navy">Listings live</b> · supplier&apos;s products can go live to buyers</div>
          <div><b className="text-navy">AI tools</b> · photo enhance, poster maker and SEO fix for this supplier&apos;s products</div>
          <div className="text-xs">Buyers only ever see the supplier code and country — never the names or contacts above.</div>
        </div>
      </Card>
    </>
  );
}
