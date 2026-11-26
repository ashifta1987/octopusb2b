import type { Metadata } from 'next';
import { money } from '@/lib/format';
import { getSiteContent } from '@/lib/content';
import { getServices } from '@/components/store/data';
import { copy } from '@/components/store/home/shared';
import { ServicePage } from '@/components/site/service-page';
import { ON_REQUEST } from '@/components/site/ui';
import { VERIFIED_FAQ } from '@/components/site/home';
import { siteImage, shareImage } from '@/lib/site-images';

const TITLE = 'Product sourcing: verified factories, quotes in 24 hours';
const DESC = 'Send a photo, a link or a specification. We find verified factories in China, collect quotes within 24 hours and manage the order, so you deal with one team.';

export function generateMetadata(): Metadata {
  const og = shareImage('share-sourcing');
  return {
    title: TITLE,
    description: DESC,
    alternates: { canonical: '/sourcing' },
    openGraph: { title: TITLE, description: DESC, url: '/sourcing', type: 'website', images: [og] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [og.url] },
  };
}

/** Product sourcing — design page 02. The request form itself stays at /request/sourcing. */
export default async function SourcingPage() {
  // cached reads only (site content + service prices), so the page is part of the static shell
  const [{ blocks }, services] = await Promise.all([getSiteContent(), getServices()]);
  // real fees from the services table; a service that is not set up shows "On request"; 0 = free to submit (as on the request form)
  const fee = (code: string) => {
    const s = services[code];
    if (!s) return ON_REQUEST;
    return s.priceCents > 0 ? `${money(s.priceCents, s.currency)} per request` : 'Free to submit';
  };
  const rfq = services.rfq?.priceCents ? money(services.rfq.priceCents, services.rfq.currency) : null;
  const verified = copy(blocks, 'home3.faq.2', VERIFIED_FAQ)[1] ?? '';
  return (
    <ServicePage testId="sourcing-page" d={{
      key: 'sourcing',
      crumb: 'Product sourcing',
      title: 'Tell us the product. We find the factory.',
      lead: 'Send a photo, a link or a specification. We search for verified factories, collect quotes and manage the order, so you deal with one team instead of many suppliers.',
      primary: { href: '/login?next=%2Frequest%2Fsourcing', label: 'Log in to request quotes' },
      note: rfq ? `Request fee: ${rfq} per request. Quotes within 24 hours.` : 'Quotes within 24 hours.',
      hero: siteImage('sourcing-hero'),
      facts: [['Request fee', fee('rfq')], ['Quotes', 'Within 24 hours'], ['Payment', 'Wallet, held in escrow'], ['Best for', 'Finding a new factory']],
      who: [
        ['New importers', 'You are starting out and are not sure where to find a reliable factory for a product you have seen online.'],
        ['Store owners', 'You already sell a product and need a cheaper or better source, with quotes you can compare.'],
        ['Growing brands', 'You are adding new products and want checked factories and a quality inspection every time.'],
      ],
      howSub: 'Four clear steps from idea to approved order.',
      steps: [
        ['Describe the product', 'Send photos, a link, specifications and the quantity you have in mind.'],
        ['We find factories', 'We search for and shortlist verified factories that make this kind of product.'],
        ['Compare quotes', 'Within 24 hours you see price, minimum order quantity and lead time side by side.'],
        ['Approve and pay', 'Approve one quote and pay from your US dollar wallet. Your money stays in escrow.'],
      ],
      learnTitle: 'What good sourcing looks like',
      learnSub: 'Pictures and short notes to help you ask for the right thing.',
      learn: [
        { ...siteImage('sourcing-samples'), caption: 'Samples let you check material and finish before a large order.' },
        { ...siteImage('sourcing-audit'), caption: 'We visit and check the factory itself, not just its brochure.' },
        { ...siteImage('sourcing-quote'), caption: 'Compare quotes on price, minimum quantity and lead time together.' },
      ],
      costs: {
        sub: 'Fees for the services around a sourcing order. Each one is charged when you send the request.',
        rows: [
          ['Request for quotes', fee('rfq'), '/request/sourcing'],
          ['Sample request', fee('sample'), '/request/sample'],
          ['QC inspection', fee('qc'), '/request/qc'],
          ['Factory audit', fee('factory_audit'), '/request/factory-audit'],
          ['Certification', fee('certification'), '/request/certification'],
        ],
        note: 'The product price, shipping and duties are in your quote, which you approve before you pay.',
        testId: 'sourcing-costs',
      },
      included: ['Factory search and verification', 'Quotes within 24 hours', 'One account manager for all your questions', 'Optional samples and QC inspection', 'Escrow protection on your payment'],
      good: [
        ['What is an MOQ?', 'The minimum order quantity a factory will produce at once. If it is too high for you, see MOQ pools.'],
        ['What is an HS code?', 'A standard number that classifies your product for customs duty and import rules. You can search by it.'],
        ['What should I send?', 'The clearer the photos, size, material and target quantity, the better and faster the quotes.'],
      ],
      team: siteImage('home-team'),
      faq: [
        ['How are factories verified?', verified],
        [rfq ? `What does the ${rfq} request fee cover?` : 'What does the request fee cover?', '[CONFIRM WHAT THE REQUEST FEE COVERS]'],
        ['Can I order samples first?', 'Yes. Samples are available as an extra service. [CONFIRM SAMPLE FEES]'],
        ['Can you inspect the goods before they ship?', 'Yes. Book a QC inspection: our inspectors check the goods at the factory, with photos and video, before anything ships.'],
        ['How do I pay?', 'Top up your US dollar wallet by bank transfer. Your money is held in escrow until QC and shipping are done. Card payments are not accepted.'],
      ],
      cta: 'Ready to find your factory?',
    }} />
  );
}
