import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { PageSkeleton } from '@/components/shell/skeletons';
import { Pill, Icon, NewBadge } from '@/components/ds';

export const metadata = { title: 'Make My Brand' };

const METHOD: Record<string, string> = { pad: 'Pad or silk print', laser: 'Laser engraving', uv: 'UV print', box: 'Branded colour box', inserts: 'Inserts and manuals', unsure: 'Not sure yet' };
const PACK: Record<string, string> = { standard: 'Plain box with your label', colour_box: 'Branded colour box', gift_box: 'Premium gift box', unsure: 'Not sure yet' };
const STATUS: Record<string, [string, 'info' | 'needs' | 'ok' | 'neutral']> = {
  submitted: ['Submitted', 'info'], proof: ['Proof to approve', 'needs'], sample: ['Sample on the way', 'info'], quoted: ['Quote ready', 'needs'],
  production: ['In production', 'info'], stocked: ['In our warehouse', 'ok'], closed: ['Closed', 'neutral'],
};

export default function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return <Suspense fallback={<PageSkeleton cards={2} table={false} />}><BrandProjects searchParams={searchParams} /></Suspense>;
}

/** ADDON-44-F — My account › Make My Brand: the company's brand projects (MB-xxxx). Logo files open with 10-minute signed links. */
async function BrandProjects({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireCustomer('/account/brand');
  const sp = await searchParams;
  const sb = await createClient();
  const { data, error } = await sb.from('brand_projects').select('id, ref, product_id, product_link, quantity, method, packaging, logo_paths, stock_destination, bulk_country, status, created_at')
    .eq('org_id', s.org!.id).order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load your brand projects: ${error.message}`);
  const rows = data ?? [];
  const productIds = rows.map((r) => r.product_id).filter(Boolean) as string[];
  const { data: prods } = productIds.length ? await sb.from('products').select('id, title, slug').in('id', productIds) : { data: [] };
  const byId = new Map((prods ?? []).map((p) => [p.id as string, p]));
  // private bucket: links valid for 10 minutes only
  const signed = new Map<string, string>();
  const paths = rows.flatMap((r) => (r.logo_paths ?? []) as string[]);
  if (paths.length) {
    const { data: urls } = await sb.storage.from('brand-logos').createSignedUrls(paths, 600);
    (urls ?? []).forEach((u) => { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl); });
  }

  return (
    <div className="max-w-[980px]" data-testid="brand-projects">
      <div className="k !text-blue">Make My Brand</div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[30px] font-extrabold leading-[1.15] flex items-center gap-2">Brand projects <NewBadge /></h1>
        <Link href="/request/brand" className="btn btn-primary" data-testid="start-brand">Start a brand project</Link>
      </div>
      <p className="mt-1 text-[14.5px] text-body-2">Your logo on verified products. Your account manager sends a proof and a quote before you pay anything.</p>

      {rows.length === 0 ? (
        <div className="card p-8 mt-6 text-center" data-testid="brand-empty">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-soft text-blue"><Icon name="tag" /></span>
          <p className="mt-3 text-[16px] font-semibold">No brand projects yet</p>
          <p className="text-[14px] text-muted mt-1">Pick a verified product, upload your logo and tell us where the stock goes.</p>
          <Link href="/request/brand" className="btn btn-primary mt-4">Start a brand project</Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => {
            const p = r.product_id ? byId.get(r.product_id as string) : null;
            const [label, tone] = STATUS[r.status as string] ?? [r.status as string, 'neutral'];
            const on = sp.project === r.ref;
            const logos = (r.logo_paths ?? []) as string[];
            return (
              <li key={r.id as string} className={`card p-5 ${on ? 'border-navy shadow-[inset_0_0_0_1px_#11133C]' : ''}`} data-testid="brand-project" id={r.ref as string}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5"><span className="mono font-bold text-navy">{r.ref as string}</span><Pill tone={tone}>{label}</Pill></div>
                  <span className="text-[13px] text-muted">Sent {fmtDate(r.created_at as string)}</span>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[14px]">
                  <div><dt className="k">Product</dt><dd className="mt-0.5">{p ? <Link href={`/p/${p.slug}`} className="text-blue font-semibold">{p.title as string}</Link> : (r.product_link as string) ?? '—'}</dd></div>
                  <div><dt className="k">Quantity</dt><dd className="mt-0.5">{r.quantity ? `${Number(r.quantity).toLocaleString('en-US')} units` : 'Your account manager confirms the minimum'}</dd></div>
                  <div><dt className="k">Branding and packaging</dt><dd className="mt-0.5">{[METHOD[r.method as string], PACK[r.packaging as string]].filter(Boolean).join(' · ') || '—'}</dd></div>
                  <div><dt className="k">Stock goes to</dt><dd className="mt-0.5">{r.stock_destination === 'bulk' ? `Bulk to ${COUNTRY_NAMES[r.bulk_country as string] ?? r.bulk_country}` : 'Octopus warehouse, order by order'}</dd></div>
                </dl>
                {logos.length > 0 && (
                  <div className="mt-3">
                    <div className="k">Logo files (private)</div>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {logos.map((path) => {
                        const name = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
                        const url = signed.get(path);
                        return <li key={path}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" data-testid="logo-link"><Icon name="doc" size={16} />{name}</a> : <span className="text-[13px] text-muted">{name}</span>}</li>;
                      })}
                    </ul>
                    <p className="mt-1 text-[12px] text-muted">Download links work for 10 minutes. Reload the page for a new link.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
