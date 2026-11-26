import type { Metadata } from 'next';
import { getSiteContent, block } from '@/lib/content';
import { ServicePage } from '@/components/site/service-page';
import { ON_REQUEST } from '@/components/site/ui';
import { PAYMENT_LINE } from '@/components/ds';
import { BRAND_START_HREF, brandMethods, fmtInt } from '@/components/store/make-my-brand/content';
import { siteImage, shareImage } from '@/lib/site-images';

const TITLE = 'Make My Brand: your brand on proven products';
const DESC = 'Choose a product that already sells well, add your logo, colours and packaging, and we produce, check and stock it for you. You see a studio preview before you commit.';

export function generateMetadata(): Metadata {
  const og = shareImage('share-brand');
  return {
    title: TITLE,
    description: DESC,
    alternates: { canonical: '/make-my-brand' },
    openGraph: { title: TITLE, description: DESC, url: '/make-my-brand', type: 'website', images: [og] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [og.url] },
  };
}

/** Make My Brand — design page 03. The brand project form stays at /request/brand (BRAND_START_HREF). */
export default async function MakeMyBrandPage() {
  // cached data only (site content), so no Suspense: the hero is in the static shell and paints first
  const { blocks, settings } = await getSiteContent();
  // current site answers (content blocks mmb.faq.*) — the same text the old page showed
  const moq = block(blocks, 'mmb.faq.moq', 'It depends on the product and the branding method. Your account manager confirms the minimum quantity in your quote before you pay anything.');
  const time = block(blocks, 'mmb.faq.time', 'The product’s normal production time plus the extra time for your branding method and sample approval. Your quote shows the delivery date.');
  const artwork = block(blocks, 'mmb.faq.artwork', 'You do. Your logo and artwork files are kept private and are shared only with the factory making your order.');
  const sample = block(blocks, 'mmb.faq.sample', 'Yes. Nothing is produced until you approve the artwork proof and a physical branded sample.');
  const pay = block(blocks, 'mmb.faq.pay', `${PAYMENT_LINE} You pay a deposit to start production and the balance before your goods ship.`);
  // branding methods with their minimum quantity and extra time from site_settings brand.methods (unknown = on request)
  const methods = brandMethods(settings);
  return (
    <ServicePage testId="mmb-page" d={{
      key: 'brand', brand: 'brand',
      crumb: 'Make My Brand',
      title: 'Your brand on proven products.',
      lead: 'Choose a product that already sells well, add your logo, colours and packaging, and we produce, check and stock it for you. You see a studio preview before you commit.',
      primary: { href: `/login?next=${encodeURIComponent(BRAND_START_HREF)}`, label: 'Log in to start a brand project', testId: 'mmb-start' },
      note: 'Studio previews are illustrative until you approve the final artwork.',
      hero: siteImage('brand-hero'),
      facts: [['Preview', 'Studio preview first'], ['Artwork', 'You approve it'], ['Storage', 'Foshan, China'], ['Shipping', 'Worldwide']],
      who: [
        ['First-time brand owners', 'You want your own name on a product without designing it from scratch.'],
        ['Online sellers', 'You sell generic products and want a brand that customers remember and trust.'],
        ['Retailers and distributors', 'You need a private label range with consistent packaging.'],
      ],
      howSub: 'From choosing a product to branded goods in stock.',
      steps: [
        ['Pick a product', 'Choose a proven product from the catalogue, or ask us to source one.'],
        ['Send your brand', 'Upload your logo and colours, and tell us what packaging you want.'],
        ['See the studio preview', 'We show how your brand looks on the product. It is illustrative, not final artwork.'],
        ['Approve and produce', 'Approve the artwork. We produce, inspect and store your goods in our warehouse.'],
      ],
      learnTitle: 'Why branding changes what customers see',
      learnSub: 'A few examples of the difference a label, a box and a clean look make.',
      learn: [
        { ...siteImage('brand-logo-closeup'), caption: 'Same product, different trust. Branding is what customers remember.' },
        { ...siteImage('brand-packaging'), caption: 'Packaging is part of the product experience.' },
        { ...siteImage('brand-studio'), caption: 'Your account manager helps you choose colours, finishes and packaging.' },
      ],
      costs: {
        title: 'Branding methods',
        sub: 'What is possible depends on the product. Your quote confirms the method, the minimum quantity, the time and the price before you pay.',
        rows: methods.map((m) => [m.name, `${m.moq ? `From ${fmtInt(m.moq)} units` : ON_REQUEST}${m.days ? ` · ${m.days.replace(/^\+\s*/, '')} extra` : ''}`] as [string, string]),
        note: 'Minimum quantity and typical extra time per method. "On request" means your account manager confirms it for your product.',
        testId: 'mmb-methods',
      },
      included: ['Help choosing a product', 'A studio preview of your brand on the product', 'Artwork and packaging guidance', 'Production with factory QC', 'Storage in our warehouse and worldwide shipping'],
      good: [
        ['What is private label?', 'A product made by an existing factory and sold under your brand name.'],
        ['Why is the preview not final?', 'The preview shows the idea. You check and approve the final artwork before production.'],
        ['Minimum quantities', `Branded production usually has a factory minimum. ${moq}`],
      ],
      faq: [
        // accepted files = the brand request upload (components/store/brand-request.tsx: .svg,.ai,.eps,.pdf,.png)
        ['Can I use my own packaging design?', 'Yes. Send your files as SVG, AI, EPS, PDF or PNG.'],
        ['Who approves the artwork?', 'You do. Production starts only after you approve it.'],
        ['Can I see a sample first?', sample],
        ['How long does a brand project take?', time],
        ['Who owns the artwork files?', artwork],
        ['Where are branded goods stored?', 'In our warehouse in Foshan, China, ready to ship worldwide.'],
        ['How do I pay?', pay],
      ],
      cta: 'Put your brand on a product that sells',
    }} />
  );
}
