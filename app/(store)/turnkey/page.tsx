import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent, block } from '@/lib/content';
import { getTurnkeyCatalogue, getTkServices } from '@/lib/turnkey/catalogue';
import { servicePrice, TK_PHASE_PHOTOS } from '@/lib/turnkey/format';
import { siteImage, shareImage } from '@/lib/site-images';
import { ServicePage } from '@/components/site/service-page';
import { btn, ON_REQUEST } from '@/components/site/ui';

const TITLE = 'Turnkey projects: your complete business, set up from China';
const DESC = 'Choose a ready-made project, such as a café, a gym, a laundry or a small factory. One Octopus team plans it, sources everything, checks quality, ships it and hands it over.';

export function generateMetadata(): Metadata {
  const og = shareImage('share-turnkey');
  return {
    title: { absolute: `${TITLE} | Octopus B2B` },
    description: DESC,
    alternates: { canonical: '/turnkey' },
    openGraph: { title: TITLE, description: DESC, url: '/turnkey', type: 'website', images: [og] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [og.url] },
  };
}

/** Turnkey projects overview — design page 07. The live catalogue (300 projects) is at /turnkey/catalogue. */
export default function TurnkeyOverviewPage() {
  return (
    <Suspense fallback={<div className="h-[600px]" aria-hidden />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const [{ projects }, services, { settings, blocks }] = await Promise.all([getTurnkeyCatalogue(), getTkServices(), getSiteContent()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const count = projects.length || 300;
  const visit = services.find((s) => s.code === 'visit_china');
  const visitPrice = visit ? servicePrice(visit) : ON_REQUEST;
  // starting fees from tk_services (the same list as /turnkey/services); missing ones say "On request"
  const fee = (code: string) => { const s = services.find((x) => x.code === code); return s ? servicePrice(s) : ON_REQUEST; };
  const name = (code: string, fb: string) => services.find((x) => x.code === code)?.name ?? fb;
  // owner FAQ (content block turnkey.faq, "question|answer;…"), shown after the design questions
  const ownerFaq = block(blocks, 'turnkey.faq', '').split(';').map((x) => x.split('|')).filter((x) => x[0]?.trim() && x[1]?.trim()).map(([q, a]) => [q!.trim(), a!.trim()] as [string, string]);
  const P = TK_PHASE_PHOTOS;

  const browse = (
    <section className="px-4 sm:px-6 pb-[72px]" aria-label="Browse the catalogue">
      <div className="max-w-[1200px] mx-auto bg-white border border-line rounded-[18px] p-8 flex flex-wrap items-center justify-between gap-5" data-testid="tk-browse">
        <div className="max-w-[640px]">
          <b className="block text-[22px] text-ink">Browse {count} projects</b>
          <p className="mt-1.5 mb-0 text-[16px] text-muted">Food and beverage, fitness, laundry, vending, healthcare, factories and more.</p>
        </div>
        <Link href="/turnkey/catalogue" className={btn.dark}>See all projects →</Link>
      </div>
    </section>
  );

  return (
    <ServicePage testId="tk-overview" beforeFaq={browse} d={{
      key: 'turnkey',
      crumb: 'Turnkey projects',
      title: 'Your complete business, set up from China.',
      lead: 'Choose a ready-made project, such as a café, a gym, a laundry or a small factory. One Octopus team plans it, sources everything, checks quality, ships it and hands it over. You deal only with Octopus.',
      primary: { href: '/login?next=%2Faccount%2Fturnkey%2Fnew', label: 'Log in to start a free enquiry', testId: 'tk-start-enquiry' },
      note: 'The enquiry is free. Each later phase starts after your payment is confirmed.',
      hero: siteImage('turnkey-hero'),
      facts: [['Projects', `${count} to choose from`], ['Enquiry', 'Free'], ['Layout drawings', '3 versions free'], ['China visit', visitPrice]],
      who: [
        ['First-time business owners', 'You want to open a café, gym, laundry or shop and need one team to organise the equipment and fit-out.'],
        ['Investors and franchisees', 'You want a repeatable setup you can copy in several locations.'],
        ['Existing owners expanding', 'You already run a business and need equipment sourced and checked in China.'],
      ],
      howSub: 'Eight phases. Each paid phase starts after your payment is confirmed. Only the enquiry is free.',
      steps: [
        ['Enquiry (free)', 'Choose a project from the catalogue or ask us for a new one.', P.enquiry],
        ['Consultation', 'We discuss your needs and agree the fee with you first.', P.consultation],
        ['Design', 'Layout drawings, with 3 versions free.', P.design],
        ['Sourcing', 'We collect factory quotes. You deal only with Octopus.', P.sourcing],
        ['Quote and deposit', 'You approve the quote and pay the deposit.', P.quote_deposit],
        ['Production and QC', 'Factory audits and inspections during production.', P.production_qc],
        ['Shipment', 'Booking, tracking and shipping documents.', P.shipment],
        ['Handover', 'Final documents, sign-off and an optional China visit.', P.handover],
      ],
      learnTitle: 'What a turnkey project looks like',
      learnSub: 'From a drawing to a business that is ready to open.',
      learn: [
        { src: '/images/design/31-turnkey-projects-overview-education-image-1.webp', alt: 'A designer showing layout drawings of a shop floor on a tablet to a client.', caption: 'Design: you see the layout before anything is made. Three versions are free.' },
        { src: '/images/design/32-turnkey-projects-overview-education-image-2.webp', alt: 'Inspectors with clipboards checking equipment on a factory floor.', caption: 'Production and QC: we audit factories and inspect the work.' },
        { ...siteImage('turnkey-container'), caption: 'Shipment: we book the container, track it and prepare the shipping documents.' },
        { src: '/images/design/33-turnkey-projects-overview-education-image-3.webp', alt: 'An owner and team standing in a finished business on opening day.', caption: 'Handover: documents, sign-off and your business ready to run.' },
      ],
      costs: {
        title: 'Starting fees',
        sub: 'Every paid service starts after your payment is confirmed. Fees are starting prices; the exact amount is agreed with you first.',
        rows: [
          ['Enquiry', 'Free'],
          [name('consultation', 'Consultation'), fee('consultation')],
          [name('layout_drawing', 'Layout drawing'), fee('layout_drawing')],
          [name('factory_audit', 'Factory audit'), fee('factory_audit')],
          [name('visit_china', 'Visit China'), fee('visit_china')],
        ],
        link: { href: '/turnkey/services', label: 'See every service and starting fee →' },
        testId: 'tk-fees',
      },
      included: ['A free enquiry and a project plan', 'Layout drawings, with 3 versions free', 'Factory sourcing: you deal only with Octopus', 'Factory audits and inspections', 'Shipment booking, tracking and documents', 'Handover, with an optional visit to China'],
      good: [
        ['What does turnkey mean?', 'The supplier delivers a complete, ready-to-use setup instead of separate parts you must assemble.'],
        ['Why are phases paid first?', 'Each paid phase starts only after your payment is confirmed. This keeps every step clear and protected. Only the enquiry is free.'],
        ['Can I visit China?', visit ? `Yes. Guided factory and sourcing trips: ${visitPrice.toLowerCase()}.${visit.rule_text ? ` ${visit.rule_text}` : ''}` : 'Yes. Guided factory and sourcing trips are available. Ask us for the price.'],
      ],
      faq: [
        ['Is the enquiry really free?', 'Yes. Only the enquiry is free. Every later phase starts after your payment is confirmed.'],
        ['Who do I deal with?', 'Only Octopus. We collect the factory quotes and manage production for you.'],
        ['Can you do a project that is not listed?', 'Yes. Ask us for a new project when you make your enquiry.'],
        ...ownerFaq,
      ],
      cta: 'Tell us the business you want to open',
    }} />
  );
}
