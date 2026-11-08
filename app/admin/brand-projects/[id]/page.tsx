import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
import { Loading } from '@/components/admin/ui';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { BRAND_METHOD, BRAND_PACK, BRAND_STATUS_LABEL, BRAND_TONE, brandDestination, brandMoves, type BrandRow } from '@/lib/brand-projects';
import { BrandStatusControls } from '../status-controls';

export const metadata = { title: 'Brand project' };

/** Admin › Brand projects › MB-… (bug 2, 8 Nov 2026): the full request, logo files (10-minute signed links), status. */
async function BrandProject({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaffOrManager('/admin/brand-projects', ['customers', 'view']);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const [{ data }, { data: hist }] = await Promise.all([
    sb.rpc('admin_brand_projects', { p_id: id, p_status: null }),
    sb.rpc('brand_project_history', { p_id: id }),
  ]);
  const r = ((data ?? []) as BrandRow[])[0];
  if (!r) notFound(); // not a project, or another account manager's customer
  // private bucket (brand-logos): staff read through staff_sees_org(); links valid for 10 minutes, made with the staff session
  const signed = new Map<string, string>();
  if (r.logo_paths.length) {
    const { data: urls } = await sb.storage.from('brand-logos').createSignedUrls(r.logo_paths, 600);
    (urls ?? []).forEach((u) => { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl); });
  }
  const history = (hist ?? []) as { at: string; actor: string; from_status: string | null; to_status: string | null; reason: string | null }[];
  const row = (k: string, v: React.ReactNode) => <div><dt className="k">{k}</dt><dd className="mt-0.5">{v}</dd></div>;
  return (
    <>
      <PageHeader eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/admin/brand-projects">Brand projects</Link> / {r.ref}</nav>}
        title={<span className="flex items-center gap-3"><span className="mono">{r.ref}</span><StatusBadge status={r.status} label={BRAND_STATUS_LABEL[r.status] ?? r.status} tone={BRAND_TONE[r.status]} /></span>}
        subtitle={`Submitted ${fmtDate(r.created_at, true)}${r.status_changed_at ? ` · status changed ${fmtDate(r.status_changed_at, true)}` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Request">
            <dl className="p-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 text-[14.5px]">
              {row('Customer', <Link href={`/admin/customers/${r.org_id}`} className="font-semibold hover:underline">{r.company}</Link>)}
              {row('Account manager', r.manager_name ?? <span className="text-bad font-semibold" data-testid="unassigned">Unassigned — set it on the customer record</span>)}
              {row('Product', r.product_title ? <Link href={`/p/${r.product_slug}`} className="text-coral-text font-semibold" target="_blank">{r.product_title}</Link> : r.product_link ? <span className="break-all">{r.product_link}</span> : '—')}
              {row('Quantity', r.quantity ? `${r.quantity.toLocaleString('en-US')} units` : 'Not given')}
              {row('Branding', BRAND_METHOD[r.method ?? ''] ?? '—')}
              {row('Packaging', BRAND_PACK[r.packaging ?? ''] ?? '—')}
              {row('Colours', r.colours ?? '—')}
              {row('Stock goes to', brandDestination(r))}
              {row('Markets', r.markets.length ? r.markets.map((m) => COUNTRY_NAMES[m] ?? m).join(', ') : '—')}
              {row('Stores', r.stores.length ? r.stores.join(', ') : '—')}
              <div className="sm:col-span-2"><dt className="k">Note from the customer</dt><dd className="mt-0.5 whitespace-pre-line">{r.note ?? '—'}</dd></div>
            </dl>
          </Card>
          <Card title="Logo files (private)">
            <div className="p-6">
              {r.logo_paths.length === 0 ? <p className="text-sm text-muted">No logo uploaded.</p> : (
                <ul className="flex flex-wrap gap-2">
                  {r.logo_paths.map((path) => {
                    const name = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
                    const url = signed.get(path);
                    return <li key={path}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" data-testid="logo-link">{name}</a> : <span className="text-sm text-muted">{name} (file missing)</span>}</li>;
                  })}
                </ul>
              )}
              <p className="mt-2 text-[12px] text-muted">Download links work for 10 minutes. Reload the page for a new link.</p>
            </div>
          </Card>
          <Card title="History">
            <ul className="divide-y divide-line" data-testid="history">
              {history.map((h, i) => (
                <li key={i} className="px-6 py-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="font-semibold">{h.from_status ? `${BRAND_STATUS_LABEL[h.from_status] ?? h.from_status} → ${BRAND_STATUS_LABEL[h.to_status ?? ''] ?? h.to_status}` : 'Submitted by the customer'}</span><span className="text-muted whitespace-nowrap">{fmtDate(h.at, true)}</span></div>
                  <div className="text-muted">{h.actor}{h.reason ? <> · <span className="text-ink">Internal reason: {h.reason}</span></> : null}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="Status">
          <div className="p-6">
            {r.paid && <p className="mb-3 text-sm text-warn font-semibold">Payment received on this project.</p>}
            <BrandStatusControls id={r.id} moves={brandMoves(r, s.isAdmin)} paid={r.paid} isAdmin={s.isAdmin} />
            <p className="mt-4 text-[12.5px] text-muted">The customer sees the status and is told when a project is closed. Internal reasons stay in Admin.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Loading />}><BrandProject params={params} /></Suspense>;
}

