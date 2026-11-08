import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyProject } from '@/lib/turnkey/data';
import { CATEGORY_LABEL, fromLabel } from '@/lib/turnkey/format';
import { Breadcrumbs, JsonLd, SITE_URL } from '@/components/store/seo';
import { Eyebrow, TkImage, TkPill } from '@/components/store/turnkey/ui';
import { ProjectPackages } from './project-packages';
import { ViewSignal } from './view-signal';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const d = await getTurnkeyProject(slug);
  if (!d) return { title: 'Project not found', robots: { index: false } };
  const p = d.project;
  const title = p.seo_title ?? `${p.title} — turnkey ${p.status === 'live' ? 'packages' : 'project'} from China | Octopus B2B`;
  const description = p.seo_description ?? `${p.overview_md ?? p.short_reason ?? ''} ${fromLabel(p) ?? ''}`.trim().slice(0, 160);
  return { title: { absolute: title }, description, alternates: { canonical: `/turnkey/${p.project_id}` }, openGraph: { title, description, url: `/turnkey/${p.project_id}`, type: 'website' } };
}

/** design/TurnkeyProject_*.dc.html — /turnkey/<project> (live = packages, register-interest = capacity picker). Fully server-rendered. */
export default function ProjectPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-[420px] bg-ink" aria-hidden />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { slug } = await params;
  const [d, { settings, company }] = await Promise.all([getTurnkeyProject(slug), getSiteContent()]);
  if (!d || settings['turnkey.enabled'] === false) notFound();
  const { project: p, packages, sources } = d;
  const live = p.status === 'live';
  const threshold = Number(settings['turnkey.interest_threshold'] ?? 10) || 10;
  return (
    <>
      <ViewSignal projectId={p.project_id} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.overview_md ?? p.short_reason ?? undefined, url: `${SITE_URL}/turnkey/${p.project_id}`,
        brand: { '@type': 'Brand', name: 'Octopus B2B' },
        ...(p.starting_budget_usd ? { offers: { '@type': 'AggregateOffer', priceCurrency: 'USD', lowPrice: p.starting_budget_usd, availability: live ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' } } : {}),
      }} />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-3">
        <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Turnkey Projects', href: '/turnkey' }, { name: 'Atlas', href: '/turnkey/atlas' }, { name: p.title }]} />
      </div>
      <section className="bg-ink text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-9 grid gap-8 lg:grid-cols-[1.25fr_1fr] items-center">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {live ? <TkPill className="bg-ok-bg text-ok">Live · ready to quote</TkPill> : <TkPill className="bg-warn-bg text-warn">Register interest · packaging now</TkPill>}
              <TkPill className="bg-white/10 text-on-ink border border-white/15">{CATEGORY_LABEL[p.category]}</TkPill>
              <TkPill className="bg-white/10 text-on-ink border border-white/15">Quote in 24 h</TkPill>
            </div>
            <h1 className="!text-white font-display font-extrabold text-[32px] sm:text-[42px] leading-tight">{p.title}</h1>
            {p.overview_md && <p className="text-on-ink text-[16px] max-w-2xl">{p.overview_md}</p>}
            {p.highlights.length > 0 && <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-on-ink">{p.highlights.map((h) => <li key={h}>✓ {h}</li>)}</ul>}
          </div>
          <TkImage p={p} label={`${p.title} layout render`} priority className={`h-[200px] sm:h-[220px] rounded-[14px] ${p.hero_image_path ? '' : 'opacity-80'}`} />
        </div>
      </section>

      <ProjectPackages project={p} packages={packages} live={live} threshold={threshold} whatsapp={company?.whatsapp ?? null} />

      {sources.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pb-12 lg:pr-[420px]">
          <Eyebrow>Where it&apos;s sourced from</Eyebrow>
          <h2 className="font-display font-bold text-[22px] text-ink mt-1 mb-4">Your consolidated-shipment hubs</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {sources.map((s) => (
              <div key={s.sort_order} className="bg-white border border-line rounded-[14px] p-5">
                <TkPill className="bg-tint text-coral-text">{s.region_label}</TkPill>
                <div className="font-semibold text-ink mt-3">{s.title}</div>
                {s.description && <p className="text-[13.5px] text-muted mt-1">{s.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

