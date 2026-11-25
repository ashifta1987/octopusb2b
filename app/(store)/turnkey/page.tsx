import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent, block } from '@/lib/content';
import { getTurnkeyCatalogue, getTkServices } from '@/lib/turnkey/catalogue';
import { TK_PHASES, fromPrice, servicePrice, tkImageUrl } from '@/lib/turnkey/format';
import { tkOutfit } from './tk-font';
import { CatalogueClient } from './catalogue-client';

export const metadata: Metadata = {
  title: { absolute: 'Turnkey Projects from China: consultation, sourcing, QC and shipping | Octopus B2B' },
  description: 'Start a complete business sourced in China: gym, laundry, vending, robotic cafe and more. Every service is paid before work starts and shown as a starting price.',
  alternates: { canonical: '/turnkey' },
};

/** Turnkey T1 — public Catalogue front page (docs/design/turnkey-v2, matched to the written description). */
export default function TurnkeyCataloguePage() {
  return (
    <Suspense fallback={<div className="h-[600px] bg-[#1A174A]" aria-hidden />}>
      <Catalogue />
    </Suspense>
  );
}

async function Catalogue() {
  const [{ projects }, services, { settings, blocks }] = await Promise.all([getTurnkeyCatalogue(), getTkServices(), getSiteContent()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const consult = services.find((s) => s.code === 'consultation');
  const visit = services.find((s) => s.code === 'visit_china');
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cards = projects.map((p) => ({ ...p, image: tkImageUrl(p.hero_image_path, sb) }));
  // owner content only; nothing is shown until it exists
  const faq = block(blocks, 'turnkey.faq', '').split(';').map((x) => x.split('|')).filter((x) => x[0]?.trim() && x[1]?.trim());
  const reports = block(blocks, 'turnkey.sample_reports', '').split(';').map((x) => x.split('|')).filter((x) => x[0]?.trim() && /^(https:\/\/|\/)/.test(x[1]?.trim() ?? ''));

  return (
    <div className={`${tkOutfit.variable} tk-theme`} data-testid="tk-catalogue">
      <section className="bg-[#1A174A] text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16 grid gap-8 lg:grid-cols-[1.2fr_1fr] items-center">
          <div className="space-y-5">
            <span className="inline-block text-[12px] uppercase tracking-[.08em] px-2.5 py-1 rounded-full border border-white/25 text-[#E8F0FD]">Turnkey projects · sourced and shipped from China</span>
            <h1 className="font-[family-name:var(--font-tk-outfit)] text-[34px] sm:text-[46px] font-bold leading-[1.08] m-0">Your complete business, set up from China.</h1>
            <p className="text-[17px] text-[#E8F0FD] max-w-[560px] m-0">Layout drawing, sourcing, quality control, factory inspection, shipping and handover. You deal only with us, and every service is paid before the work starts.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/contact?topic=turnkey-consultation" className="inline-flex items-center min-h-12 px-5 rounded-[10px] bg-[#2559B8] text-white font-semibold no-underline hover:bg-[#1F4C9E]" data-testid="tk-book-consultation">
                Book a consultation{consult ? ` (${fromPrice(consult.from_cents, consult.approx).toLowerCase()})` : ''}
              </Link>
              <a href="#projects" className="inline-flex items-center min-h-12 px-5 rounded-[10px] border border-white/40 text-white font-semibold no-underline hover:bg-white/10">See {projects.length} projects</a>
            </div>
          </div>
          {visit && (
            <Link href="/turnkey/services#visit_china" className="block rounded-[16px] bg-[#2559B8] p-6 no-underline text-white hover:bg-[#1F4C9E]" data-testid="tk-visit-banner">
              <div className="text-[13px] font-semibold uppercase tracking-[.08em] text-white">Visit China with us</div>
              <div className="font-[family-name:var(--font-tk-outfit)] text-[26px] font-bold mt-1">Guided factory and sourcing trips</div>
              <div className="mt-2 text-[15px]">{servicePrice(visit)}. {visit.rule_text}</div>
              <div className="mt-4 font-semibold">See the trip and extras →</div>
            </Link>
          )}
        </div>
      </section>

      <section id="projects" className="bg-[#F4F7FC] scroll-mt-20" aria-labelledby="tk-projects-h">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10">
          <h2 id="tk-projects-h" className="font-[family-name:var(--font-tk-outfit)] text-[28px] font-bold text-[#1A174A] m-0">Projects</h2>
          <p className="text-[15px] text-[#5A6080] mt-1 mb-5">Pick a project to see what it involves, or ask us for a new one.</p>
          <CatalogueClient projects={cards} />
        </div>
      </section>

      <section aria-labelledby="tk-how-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12">
        <h2 id="tk-how-h" className="font-[family-name:var(--font-tk-outfit)] text-[28px] font-bold text-[#1A174A] m-0">How it works</h2>
        <p className="text-[15px] text-[#5A6080] mt-1 mb-5">Eight phases. Each paid phase starts after your payment is confirmed; only the enquiry is free.</p>
        <ol className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="tk-phases">
          {TK_PHASES.map((ph) => (
            <li key={ph.n} className="rounded-[14px] border border-[#E1E6F2] bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex w-8 h-8 rounded-full bg-[#1A174A] text-white items-center justify-center font-bold" aria-hidden="true">{ph.n}</span>
                <span className="font-semibold text-[#1A174A]">{ph.name}</span>
                <span className={`ml-auto text-[11.5px] font-semibold px-2 py-0.5 rounded-full ${ph.paid ? 'bg-[#E8F0FD] text-[#1A174A]' : 'bg-[#E6F4EA] text-[#14532D]'}`}>{ph.paid ? 'Paid first' : 'Free'}</span>
              </div>
              <p className="text-[14px] text-[#3B4160] mt-2 mb-0">{ph.what}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 mb-0"><Link href="/turnkey/services" className="font-semibold text-[#2F6FE0] underline">See every service and starting fee</Link></p>
      </section>

      {reports.length > 0 && (
        <section aria-labelledby="tk-reports-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pb-12">
          <h2 id="tk-reports-h" className="font-[family-name:var(--font-tk-outfit)] text-[24px] font-bold text-[#1A174A] m-0">Sample reports</h2>
          <ul className="mt-3 flex flex-wrap gap-3 list-none p-0">
            {reports.map(([label, href]) => <li key={href}><a href={href!.trim()} className="inline-flex min-h-11 items-center px-4 rounded-[10px] border border-[#D3DAEC] text-[#1A174A] font-semibold no-underline hover:border-[#2F6FE0]">{label!.trim()}</a></li>)}
          </ul>
        </section>
      )}

      {faq.length > 0 && (
        <section aria-labelledby="tk-faq-h" className="max-w-[900px] mx-auto px-4 sm:px-8 pb-14">
          <h2 id="tk-faq-h" className="font-[family-name:var(--font-tk-outfit)] text-[24px] font-bold text-[#1A174A] m-0">Questions</h2>
          <div className="mt-3 flex flex-col gap-2">
            {faq.map(([q, a]) => (
              <details key={q} className="rounded-[12px] border border-[#E1E6F2] bg-white p-4">
                <summary className="font-semibold text-[#1A174A] cursor-pointer min-h-6">{q!.trim()}</summary>
                <p className="mt-2 mb-0 text-[15px] text-[#3B4160]">{a!.trim()}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
