import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { fromLabel } from '@/lib/turnkey/format';
import { Breadcrumbs } from '@/components/store/seo';
import { Eyebrow, FOUR_TESTS } from '@/components/store/turnkey/ui';
import { AtlasMap, AtlasList, AtlasProvider } from './atlas-client';

export const metadata: Metadata = {
  title: { absolute: 'Project Atlas — 25 turnkey businesses, Chinese factory hubs | Octopus B2B' },
  description: 'Every Octopus B2B turnkey project with its starting budget, lead time and the Chinese factory hub it is sourced from. Filter by category or tap a hub.',
  alternates: { canonical: '/turnkey/atlas' },
};

/** design/TurnkeyAtlas.dc.html — /turnkey/atlas (ADDON-31). */
export default function AtlasPage() {
  return (
    <Suspense fallback={<div className="h-[600px] bg-navy" aria-hidden />}>
      <Atlas />
    </Suspense>
  );
}

async function Atlas() {
  const [{ projects, hubs }, { settings }] = await Promise.all([getTurnkeyCatalogue(), getSiteContent()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const live = projects.filter((p) => p.status === 'live').length;
  const picks = projects.filter((p) => p.is_starter_pick).sort((a, b) => (a.starter_rank ?? 9) - (b.starter_rank ?? 9));
  return (
    <AtlasProvider>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-3"><Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Turnkey Projects', href: '/turnkey' }, { name: 'Project Atlas' }]} /></div>
      <section className="bg-navy text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10 grid gap-8 lg:grid-cols-[1fr_1.15fr] items-center">
          <div className="space-y-5">
            <span className="inline-block mono text-[10.5px] uppercase tracking-[.08em] px-2.5 py-1 rounded-full bg-white/10 text-[#C9D0E8]">Project Atlas</span>
            <h1 className="!text-white font-display font-extrabold text-[34px] sm:text-[44px] leading-[1.08]">{projects.length} businesses.<br />{hubs.length} factory hubs.<br />One shipment.</h1>
            <p className="text-[#C9D0E8] text-[15px] max-w-lg">
              Tap a hub to see what it supplies, or jump straight to the project. {live} modules are live and quotable today. The other {projects.length - live} are open for register-interest — packages ship the moment demand is there.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#all" className="btn btn-primary">Browse all {projects.length} →</a>
              <Link href="/turnkey#live" className="btn border border-white/40 text-white hover:bg-white/10 hover:text-white">Live packages</Link>
            </div>
            <dl className="flex gap-8 text-[13px] text-[#A9B2D0]">
              <div><dt className="sr-only">Live</dt><dd><b className="text-white">{live}</b> Live</dd></div>
              <div><dt className="sr-only">Register-interest</dt><dd><b className="text-white">{projects.length - live}</b> Register-interest</dd></div>
              <div><dt className="sr-only">Hubs</dt><dd><b className="text-white">{hubs.length}</b> Hubs</dd></div>
            </dl>
          </div>
          <AtlasMap hubs={hubs} projects={projects} />
        </div>
      </section>

      {picks.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8">
          <Eyebrow>Where to start</Eyebrow>
          <h2 className="font-display font-bold text-[22px] text-navy mt-1 mb-4">Top 5 picks for your region</h2>
          <ul className="flex lg:grid lg:grid-cols-5 gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 lg:mx-0 lg:px-0 pb-1">
            {picks.map((p) => (
              <li key={p.project_id} className="snap-start shrink-0 w-[220px] lg:w-auto">
                <Link href={`/turnkey/${p.project_id}`} className="block h-full bg-white border border-line rounded-[12px] p-3.5 hover:border-blue">
                  <span className="mono text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">#{p.starter_rank}</span>
                  <div className="font-semibold text-navy text-[14px] mt-2">{p.title}</div>
                  <div className="mono text-[10.5px] uppercase text-muted mt-1">{[p.hub_label, fromLabel(p)].filter(Boolean).join(' · ')}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="all" className="bg-surface border-y border-line scroll-mt-24">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8">
          <AtlasList projects={projects} hubs={hubs} />
        </div>
      </section>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10">
        <Eyebrow>What makes a good turnkey project</Eyebrow>
        <h2 className="font-display font-bold text-[22px] sm:text-[26px] text-navy mt-1">Four tests every project on this page passes</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-5">
          {FOUR_TESTS.map(([t, d], i) => (
            <li key={t} className="bg-white border border-line rounded-[12px] p-4">
              <div className="font-display text-blue text-[20px] font-bold">{String(i + 1).padStart(2, '0')}</div>
              <div className="font-semibold text-navy mt-1">{t}</div>
              <p className="text-[13px] text-muted mt-1">{d}</p>
            </li>
          ))}
        </ol>
      </section>
    </AtlasProvider>
  );
}

