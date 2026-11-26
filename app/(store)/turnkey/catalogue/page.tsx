import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent, block } from '@/lib/content';
import { getTurnkeyCatalogue, getTkServices } from '@/lib/turnkey/catalogue';
import { servicePrice, tkImageUrl } from '@/lib/turnkey/format';
import { h1Class, h2Class, eyebrowClass, btn, space, Crumb, BrandMark, SUPPORT_EMAIL } from '@/components/site/ui';
import { siteImage, shareImage } from '@/lib/site-images';
import { CatalogueClient } from '../catalogue-client';

const DESC = 'Pick a project to see what it involves, or ask us for a new one: cafés, gyms, laundries, vending, clinics, small factories and more. You deal only with Octopus, from first enquiry to handover.';

export async function generateMetadata(): Promise<Metadata> {
  const { projects } = await getTurnkeyCatalogue();
  const title = `Turnkey catalogue: ${projects.length || 'ready-made'} projects set up from China`;
  const og = shareImage('share-turnkey');
  return {
    title: { absolute: `${title} | Octopus B2B` },
    description: DESC,
    alternates: { canonical: '/turnkey/catalogue' },
    openGraph: { title, description: DESC, url: '/turnkey/catalogue', type: 'website', images: [og] },
    twitter: { card: 'summary_large_image', title, description: DESC, images: [og.url] },
  };
}

/** Turnkey catalogue — design page 08, on the live catalogue (turnkey_projects + site-media photos). */
export default function TurnkeyCataloguePage() {
  return (
    <Suspense fallback={<div className="h-[600px]" aria-hidden />}>
      <Catalogue />
    </Suspense>
  );
}

const PHASES: [string, string, boolean][] = [
  ['Enquiry', 'Choose a project or request a new one.', false],
  ['Consultation', 'The fee is agreed with you.', true],
  ['Design', 'Layout drawings, with 3 versions free.', true],
  ['Sourcing', 'Factory quotes are collected, and you deal only with Octopus.', true],
  ['Quote and deposit', 'Approve the quote and pay the deposit.', true],
  ['Production and QC', 'Factory audits and inspections.', true],
  ['Shipment', 'Booking, tracking and shipping documents.', true],
  ['Handover', 'Final documents, sign-off and an optional China visit.', true],
];

async function Catalogue() {
  const [{ projects }, services, { settings, blocks }] = await Promise.all([getTurnkeyCatalogue(), getTkServices(), getSiteContent()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const visit = services.find((s) => s.code === 'visit_china');
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cards = projects.map((p) => ({ ...p, image: tkImageUrl(p.hero_image_path, sb) }));
  const count = projects.length || 300;
  const visitImg = siteImage('turnkey-visit');
  const team = siteImage('home-team');
  // owner content only; nothing is shown until it exists
  const faq = block(blocks, 'turnkey.faq', '').split(';').map((x) => x.split('|')).filter((x) => x[0]?.trim() && x[1]?.trim());
  const reports = block(blocks, 'turnkey.sample_reports', '').split(';').map((x) => x.split('|')).filter((x) => x[0]?.trim() && /^(https:\/\/|\/)/.test(x[1]?.trim() ?? ''));

  return (
    <div data-testid="tk-catalogue">
      <Crumb label="Catalogue" trail={[{ name: 'Turnkey projects', href: '/turnkey' }]} />
      {/* intro + promo */}
      <section id="top" className="px-4 sm:px-6 pt-8 pb-6" aria-labelledby="tk-h1">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-10 items-center justify-between">
          <div className="flex-[1_1_520px] min-w-0 max-w-[680px]">
            <BrandMark brand="turnkey" className="mb-3" />
            <p className={`${eyebrowClass} m-0 text-coral-text`}>Turnkey projects</p>
            <h1 id="tk-h1" className={`${h1Class} mt-3`}>Your complete business, set up from China</h1>
            <p className="mt-4 mb-0 text-[18px] leading-[1.6] text-muted">Pick a project to see what it involves, or ask us for a new one. You deal only with Octopus, from first enquiry to handover.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#projects" className={btn.dark}>Browse {count} projects</a>
              <a href="#phases" className={btn.outline}>How it works</a>
            </div>
          </div>
          <Link href="/turnkey/services#visit_china" className="flex-[1_1_360px] min-w-0 max-w-[520px] bg-ink-card rounded-[24px] p-6 sm:p-8 flex gap-5 items-center text-white hover:bg-ink-2 hover:text-white" data-testid="tk-visit-banner">
            <span className="relative block w-[96px] sm:w-[120px] shrink-0 aspect-square rounded-[14px] overflow-hidden bg-tint">
              <Image src={visitImg.src} alt={visitImg.alt} fill sizes="120px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[12px] font-semibold tracking-[.12em] uppercase text-on-ink-link">Visit China with us</span>
              <span className="block mt-1 text-[24px] sm:text-[28px] font-extrabold leading-[1.15]">{visit ? servicePrice(visit) : 'Price on request'}</span>
              <span className="block mt-1.5 text-[14px] text-on-ink">Guided factory and sourcing trips.{visit?.rule_text ? ` ${visit.rule_text}` : ''}</span>
              <span className="block mt-2 text-[14px] font-semibold underline">See the trip and extras →</span>
            </span>
          </Link>
        </div>
      </section>

      {/* projects (live) */}
      <section id="projects" className="px-4 sm:px-6 pt-10 pb-16 scroll-mt-4" aria-labelledby="tk-projects-h">
        <div className="max-w-[1200px] mx-auto">
          <CatalogueClient projects={cards} />
        </div>
      </section>

      {/* phases */}
      <section id="phases" className={`bg-ink text-white px-4 sm:px-6 ${space.section} scroll-mt-4`} aria-labelledby="tk-how-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="tk-how-h" className={`${h2Class} !text-white`}>How it works: eight phases</h2>
          <p className="mt-3 mb-0 text-[18px] text-on-ink">Each paid phase starts after your payment is confirmed. Only the enquiry is free.</p>
          <ol className="mt-8 list-none p-0 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="tk-phases">
            {PHASES.map(([t, b, paid], i) => (
              <li key={t} className="bg-ink-card rounded-[18px] p-[22px]">
                <div className="flex items-center justify-between gap-2">
                  <span aria-hidden="true" className="w-9 h-9 rounded-full bg-coral text-white font-bold flex items-center justify-center">{i + 1}</span>
                  <span className={`px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold tracking-[.06em] uppercase ${paid ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>{paid ? 'Paid first' : 'Free'}</span>
                </div>
                <h3 className="mt-3.5 mb-0 text-[20px] font-extrabold !text-white">{t}</h3>
                <p className="mt-2 mb-0 text-[15px] leading-[1.55] text-on-ink">{b}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 mb-0"><Link href="/turnkey/services" className="inline-flex items-center min-h-11 font-semibold text-white underline hover:text-on-ink-link">See every service and starting fee →</Link></p>
        </div>
      </section>

      {/* team */}
      <section className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="tk-team-h" data-testid="tk-team">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="tk-team-h" className={h2Class}>Your team in China</h2>
          <div className="mt-7 flex flex-wrap gap-5">
            <div className="flex-[2_1_480px] min-w-0 relative aspect-[3/2] rounded-[18px] overflow-hidden bg-tint">
              <Image src={team.src} alt={team.alt} fill sizes="(min-width:1200px) 760px, 100vw" className="object-cover" data-testid="tk-team-photo" />
            </div>
            <ul className="flex-[1_1_300px] min-w-0 list-none m-0 p-0 flex flex-col gap-4">
              {[['Factory visits with you', 'We walk the floor beside you.'], ['Audits and inspections', 'Checked before goods ship.'], ['Reports you can check', 'Clear records for every step.']].map(([t, b]) => (
                <li key={t} className="bg-white border border-line rounded-[18px] p-6">
                  <h3 className="m-0 text-[18px] font-bold">{t}</h3>
                  <p className="mt-1 mb-0 text-[15px] text-muted">{b}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-5 mb-0 text-[15px] text-muted">
            China visit terms, privacy and passport uploads: see <Link href="/turnkey/terms" className="font-semibold underline text-ink hover:text-coral-text" data-testid="tk-terms-link">Terms</Link>. Support: <a href={`mailto:${SUPPORT_EMAIL}`} className="underline text-ink hover:text-coral-text">{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </section>

      {reports.length > 0 && (
        <section aria-labelledby="tk-reports-h" className="max-w-[1200px] mx-auto px-4 sm:px-6 pb-14">
          <h2 id="tk-reports-h" className="m-0 text-[24px] font-extrabold">Sample reports</h2>
          <ul className="mt-3 flex flex-wrap gap-3 list-none p-0">
            {reports.map(([label, href]) => <li key={href}><a href={href!.trim()} className="inline-flex min-h-11 items-center px-4 rounded-[10px] border-2 border-ink text-ink font-semibold hover:bg-ink hover:text-white">{label!.trim()}</a></li>)}
          </ul>
        </section>
      )}

      {faq.length > 0 && (
        <section aria-labelledby="tk-faq-h" className="max-w-[860px] mx-auto px-4 sm:px-6 pb-14">
          <h2 id="tk-faq-h" className="m-0 text-[24px] font-extrabold">Questions</h2>
          <div className="mt-3 flex flex-col gap-3">
            {faq.map(([q, a]) => (
              <details key={q} className="rounded-[14px] bg-white border border-line px-6 py-4">
                <summary className="font-semibold text-ink cursor-pointer min-h-11 flex items-center">{q!.trim()}</summary>
                <p className="mt-2 mb-0 text-[16px] text-muted">{a!.trim()}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* closing */}
      <section className={`bg-ink px-4 sm:px-6 ${space.section} text-center`} aria-labelledby="tk-new-h">
        <div className="max-w-[720px] mx-auto">
          <h2 id="tk-new-h" className={`${h2Class} !text-white`}>Don&apos;t see your project?</h2>
          <p className="mt-3 mb-0 text-[18px] text-on-ink">Send a free enquiry and we will scope it for you.</p>
          <p className="mt-6 mb-0"><Link href="/account/turnkey/new" className={btn.primary} data-testid="tk-new-enquiry">Start a free enquiry</Link></p>
        </div>
      </section>
    </div>
  );
}
