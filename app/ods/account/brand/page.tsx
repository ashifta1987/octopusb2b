import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '../_services/ui';
import { requireAccount } from '../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { BRAND_METHOD, BRAND_PACK } from '@/lib/brand-projects';
import { COUNTRY_NAMES } from '@/lib/format';
import { BRAND_TABS, pickTab } from '../_services/logic';
import { BrandView, type BrandProject, type BrandState } from './_components/brand-view';

export const metadata: Metadata = { title: 'Make My Brand' };

type Row = {
  id: string; ref: string; product_id: string | null; product_link: string | null; quantity: number | null; method: string | null; packaging: string | null;
  logo_paths: string[] | null; stock_destination: string | null; bulk_country: string | null; status: string; created_at: string;
};

/**
 * ODS /account/brand. Same reads as today's app/account/brand/page.tsx: brand_projects (the company's own, customer columns
 * only), products (title, slug) and 10-minute signed links to the private brand-logos bucket.
 */
export default function BrandPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <PageWrap>
      <Suspense fallback={<BrandView state={{ kind: 'loading' }} tab="proofs" tabParam={null} />}>
      <Brand searchParams={searchParams} />
      </Suspense>
    </PageWrap>
  );
}

async function load(orgId: string): Promise<BrandState> {
  const sb = await createClient();
  const { data, error } = await sb.from('brand_projects')
    .select('id, ref, product_id, product_link, quantity, method, packaging, logo_paths, stock_destination, bulk_country, status, created_at')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) return { kind: 'error' };
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => r.product_id).filter(Boolean) as string[];
  const { data: prods } = ids.length ? await sb.from('products').select('id, title, slug').in('id', ids) : { data: [] };
  const byId = new Map(((prods ?? []) as { id: string; title: string; slug: string | null }[]).map((p) => [p.id, p]));
  const paths = rows.flatMap((r) => r.logo_paths ?? []);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await sb.storage.from('brand-logos').createSignedUrls(paths, 600);
    (urls ?? []).forEach((u) => { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl); });
  }
  const projects: BrandProject[] = rows.map((r) => {
    const p = r.product_id ? byId.get(r.product_id) : null;
    return {
      id: r.id, ref: r.ref, status: r.status, createdAt: r.created_at,
      product: p ? { title: p.title, href: p.slug ? `/p/${p.slug}` : null } : null, productLink: r.product_link,
      quantity: r.quantity ? Number(r.quantity) : null,
      branding: [BRAND_METHOD[r.method ?? ''], BRAND_PACK[r.packaging ?? '']].filter(Boolean).join(' · '),
      destination: r.stock_destination === 'bulk' ? `Bulk to ${COUNTRY_NAMES[r.bulk_country ?? ''] ?? r.bulk_country ?? '—'}` : 'Octopus warehouse, order by order',
      logos: (r.logo_paths ?? []).map((path) => ({ path, name: path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, ''), url: signed.get(path) ?? null })),
    };
  });
  return { kind: 'ready', projects };
}

async function Brand({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireAccount('/account/brand');
  const sp = await searchParams;
  return <BrandView state={await load(s.org!.id)} tab={pickTab(sp.tab, BRAND_TABS)} />;
}
