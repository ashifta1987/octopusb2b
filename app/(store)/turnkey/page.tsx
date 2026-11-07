import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { getOpenProjectCard } from '@/lib/turnkey/live';
import { usd, waLink } from '@/lib/turnkey/format';
import { Breadcrumbs } from '@/components/store/seo';
import { Eyebrow, LiveModuleCard, StarterStrip, SIX_STEPS } from '@/components/store/turnkey/ui';

export const metadata: Metadata = {
  title: { absolute: 'Turnkey Projects — open a business, one container | Octopus B2B' },
  description: 'Twenty-five complete businesses specified by Octopus B2B and sourced from the right Chinese factory hub: layout, equipment, QC, consolidation and one shipment.',
  alternates: { canonical: '/turnkey' },
};

/** design/TurnkeyHub.dc.html — /turnkey (ADDON-31). */
export default function TurnkeyHubPage() {
  return (
    <Suspense fallback={<div className="h-[600px] bg-navy" aria-hidden />}>
      <Hub />
    </Suspense>
  );
}

async function Hub() {
  const [{ projects, packages, hubs }, { settings, company }, open] = await Promise.all([getTurnkeyCatalogue(), getSiteContent(), getOpenProjectCard()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const live = projects.filter((p) => p.status === 'live');
  const interest = projects.filter((p) => p.status === 'register-interest');
  const wa = waLink(company?.whatsapp, 'Hello Octopus B2B, I would like to talk about a Turnkey Project.');
  return (
    <>
      <section className="bg-navy text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10 sm:py-14 grid gap-8 lg:grid-cols-[1.1fr_1fr] items-center">
          <div className="space-y-5">
            <span className="inline-block mono text-[10.5px] uppercase tracking-[.08em] px-2.5 py-1 rounded-full border border-white/20 bg-white/5 text-[#C9D0E8]">
              Turnkey projects · {live.length} live · {interest.length} coming
            </span>
            <h1 className="!text-white font-display font-extrabold text-[36px] sm:text-[52px] leading-[1.05]">Open a business,<br />one container.</h1>
            <p className="text-[16px] sm:text-[17px] text-[#C9D0E8] max-w-xl">
              {projects.length === 25 ? 'Twenty-five' : projects.length} complete businesses, specified by us and sourced from the right Chinese factory hub. Layout, equipment, QC, consolidation
              and one shipment to your door — with the quote in your inbox within 24 hours.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#live" className="btn btn-primary">Browse live packages</a>
              <Link href="/turnkey/atlas" className="btn border border-white/40 text-white hover:bg-white/10 hover:text-white">See the Atlas →</Link>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#A9B2D0]">
              <li>✓ Offices in China</li><li>✓ Inspection before shipping</li><li>✓ Door-to-door delivery</li>
            </ul>
          </div>
          <div className="space-y-3">
            {open && (
              <div className="rounded-[14px] border border-white/15 bg-white/5 p-5" data-testid="open-project">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-[.08em] text-[#A9B2D0]">Open project · {open.reference}</div>
                    <div className="font-display font-bold text-[17px] mt-1">{open.project}{open.tier ? ` · ${open.tier} package` : ''} · {open.country}</div>
                  </div>
                  <span className="self-start mono text-[10.5px] uppercase px-2 py-1 rounded-full bg-[#DBEAFE] text-[#1E40AF]">{open.stage}</span>
                </div>
                <dl className="grid grid-cols-3 gap-3 mt-4 text-[14px]">
                  <div><dt className="mono text-[10px] uppercase text-[#A9B2D0]">Package from</dt><dd className="font-semibold">{usd(open.budget) ?? '—'}</dd></div>
                  <div><dt className="mono text-[10px] uppercase text-[#A9B2D0]">Timeline</dt><dd className="font-semibold">{open.lead_days ? `~${open.lead_days} days` : '—'}</dd></div>
                  <div><dt className="mono text-[10px] uppercase text-[#A9B2D0]">Payback</dt><dd className="font-semibold">{open.payback ?? '—'}</dd></div>
                </dl>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <a href="#live" className="rounded-[14px] bg-white text-navy p-4 hover:text-blue">
                <div className="mono text-[10.5px] uppercase tracking-[.08em] text-muted">Live modules</div>
                <div className="text-[13.5px] mt-3">{live.map((p) => p.title.replace(/ (fit-out|kiosk|network)$/i, '')).join(' · ') || '—'}</div>
              </a>
              <Link href="/turnkey/atlas" className="rounded-[14px] bg-white text-navy p-4 hover:text-blue">
                <div className="mono text-[10.5px] uppercase tracking-[.08em] text-muted">Register interest</div>
                <div className="text-[13.5px] mt-3">Open demand signal across {hubs.length} hubs</div>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-4"><Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Turnkey Projects' }]} /></div>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10">
        <div className="flex flex-wrap justify-between items-end gap-3 mb-5">
          <div>
            <Eyebrow>Where to start</Eyebrow>
            <h2 className="font-display font-bold text-[24px] sm:text-[28px] text-navy mt-1">Start with these five</h2>
            <p className="text-muted text-[15px] mt-1">High ticket, steady demand in the Gulf and Africa, and the buyer isn&apos;t an expert — exactly what we&apos;re built for.</p>
          </div>
          <Link href="/turnkey/atlas" className="text-blue font-semibold text-[14px]">See all {projects.length} →</Link>
        </div>
        <StarterStrip projects={projects} />
      </section>

      {live.length > 0 && (
        <section id="live" className="bg-surface border-y border-line scroll-mt-24">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10">
            <Eyebrow>Live now</Eyebrow>
            <h2 className="font-display font-bold text-[24px] sm:text-[28px] text-navy mt-1">{live.length === 4 ? 'Four' : live.length} packages you can quote today</h2>
            <p className="text-muted text-[15px] mt-1 max-w-2xl">Each live module has three tiers — Starter, Standard and Pro — with the equipment list, budget, monthly revenue range and payback period published up front.</p>
            <div className="grid gap-4 lg:grid-cols-2 mt-6">
              {live.map((p) => <LiveModuleCard key={p.project_id} p={p} packages={packages} />)}
            </div>
          </div>
        </section>
      )}

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10">
        <Eyebrow>How a turnkey order moves</Eyebrow>
        <h2 className="font-display font-bold text-[24px] sm:text-[28px] text-navy mt-1">Six steps, one container, one shipment.</h2>
        <ol className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mt-6">
          {SIX_STEPS.map(([t, d], i) => (
            <li key={t} className="bg-white border border-line rounded-[12px] p-4">
              <div className="mono text-[11px] text-blue font-semibold">{String(i + 1).padStart(2, '0')}</div>
              <div className="font-semibold text-navy mt-1">{t}</div>
              <p className="text-[13px] text-muted mt-1">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pb-10">
        <Eyebrow>Why turnkey from Octopus</Eyebrow>
        <h2 className="font-display font-bold text-[24px] sm:text-[28px] text-navy mt-1">We handle China. You open on time.</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-6">
          {[
            ['Offices in China', 'Our team walks the factory for you — specification, sampling and follow-up in person.'],
            ['Pre-shipment QC', 'Mandatory inspection on every turnkey order. AQL 2.5, photos and video.'],
            ['CE · FCC · RoHS', 'Certifications validated per line item. Electrical ratings and marks on file.'],
            ['Global shipping', 'Door-to-door to 220+ countries. We book, pay, track and clear for you.'],
          ].map(([t, d]) => (
            <div key={t} className="bg-white border border-line rounded-[14px] p-5">
              <div className="font-semibold text-navy">{t}</div>
              <p className="text-[13.5px] text-muted mt-1.5">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 flex flex-wrap gap-5 items-center justify-between">
          <div>
            <h2 className="!text-white font-display font-bold text-[20px]">Not ready for a quote? Chat with Octo.</h2>
            <p className="text-[#C9D0E8] text-[14px] max-w-xl">Our AI assistant can walk you through packages, hubs and rough budgets. A human sourcing lead takes over the moment it matters.</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">WhatsApp {company?.whatsapp}</a>}
            {typeof settings['contact.wechat'] === 'string' && settings['contact.wechat'] && <span className="btn border border-white/30 text-white">WeChat {String(settings['contact.wechat'])}</span>}
            <Link href="/account/assistant" className="btn border border-white/30 text-white hover:bg-white/10 hover:text-white">Open the assistant →</Link>
          </div>
        </div>
      </section>
    </>
  );
}

