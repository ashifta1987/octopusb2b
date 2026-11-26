import { Suspense } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import { ServicePage } from '@/components/site/service-page';
import { ON_REQUEST } from '@/components/site/ui';
import { siteImage, shareImage } from '@/lib/site-images';

const TITLE = '3PL and logistics in China: stored in China, delivered worldwide';
const DESC = 'Send your goods to our warehouse in Foshan, China. We receive and check them, pick and pack each order, dispatch it with Express, Standard or Economy shipping, and handle returns.';

export function generateMetadata(): Metadata {
  const og = shareImage('share-3pl');
  return {
    title: { absolute: `${TITLE} | Octopus B2B` },
    description: DESC,
    alternates: { canonical: '/3pl' },
    openGraph: { title: TITLE, description: DESC, url: '/3pl', type: 'website', images: [og] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [og.url] },
  };
}

type Rate = { receiving_per_carton_cents: number | null; storage_per_pallet_month_cents: number | null; pick_pack_first_cents: number | null; pick_pack_extra_cents: number | null; returns_per_item_cents: number | null };

/** 3PL and logistics — design page 06. The account application stays at /3pl/apply. */
export default function ThreePlPage() {
  return <Suspense fallback={<div className="h-[600px]" aria-hidden />}><Intro /></Suspense>;
}

async function Intro() {
  const sb = await createClient();
  // live standard rate plan (wh_rate_versions) fills [CONFIRM STORAGE AND HANDLING FEES] when it exists
  const { data } = await sb.from('wh_rate_versions').select('receiving_per_carton_cents, storage_per_pallet_month_cents, pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents').eq('status', 'active').eq('plan_code', 'standard').is('warehouse_code', null).maybeSingle();
  const r = (data ?? null) as Rate | null;
  const fee = (c: number | null | undefined) => (c == null ? null : money(Number(c), 'USD'));
  // every fee line is shown; a fee that is not in the live standard plan says "On request"
  const rateRows: [string, string][] = [
    ['Receiving, per carton', fee(r?.receiving_per_carton_cents) ?? ON_REQUEST], ['Storage, per pallet per month', fee(r?.storage_per_pallet_month_cents) ?? ON_REQUEST],
    ['Pick and pack, first item', fee(r?.pick_pack_first_cents) ?? ON_REQUEST], ['Each extra item', fee(r?.pick_pack_extra_cents) ?? ON_REQUEST], ['Returns, per item', fee(r?.returns_per_item_cents) ?? ON_REQUEST],
  ];
  const hasRates = rateRows.some(([, v]) => v !== ON_REQUEST);
  const fees = hasRates
    ? <span data-testid="wh-intro-rates">Prices in US dollars. One monthly invoice lists every charge.</span>
    : <span data-testid="wh-intro-rates-none">Your rate plan is agreed with you when we approve your account. One monthly invoice lists every charge, and each line opens to the orders and movements behind it.</span>;

  return (
    <ServicePage testId="wh-intro" d={{
      key: '3pl', brand: '3pl',
      crumb: '3PL and logistics',
      title: 'Stored in China. Delivered worldwide.',
      lead: 'Send your goods to our warehouse. We receive and check them, pick and pack each order, dispatch it with the shipping speed you choose, and handle returns.',
      primary: { href: '/3pl/apply', label: 'Get a 3PL quote', testId: 'wh-intro-apply' },
      note: 'Warehouse: Foshan, China.',
      hero: siteImage('3pl-hero'),
      facts: [['Warehouse', 'Foshan, China'], ['Shipping', 'Express, Standard, Economy'], ['Includes', 'Receive, pick, pack, dispatch'], ['Returns', 'Handled']],
      who: [
        ['Sellers with their own stock', 'You buy in China and need a place to keep and ship it.'],
        ['Branded product owners', 'Your Make My Brand goods can be stored and sent from the same place.'],
        ['Cross-border stores', 'You ship orders to customers in many countries.'],
      ],
      howSub: 'Four stages from arrival to delivery, with returns covered.',
      steps: [
        ['Receive', 'Goods arrive at our warehouse. We count, check and record them.', siteImage('3pl-receive')],
        ['Pick and pack', 'When an order comes in, we pick the items and pack them securely.', siteImage('3pl-pick')],
        ['Dispatch', 'We ship with Express, Standard or Economy. You choose by speed and cost.', siteImage('3pl-weigh')],
        ['Returns', 'Returned items come back to the warehouse to be checked and restocked.', siteImage('3pl-returns')],
      ],
      learnTitle: 'Choosing how your parcel travels',
      learnSub: 'The right shipping speed protects both your margin and your customer experience.',
      learn: [
        { src: '/images/design/29-3pl-and-logistics-education-image-3.webp', alt: 'A customer opening a delivered parcel at the front door.', caption: 'Reliable delivery is part of your brand.' },
        { src: '/images/design/28-3pl-and-logistics-education-image-2.webp', alt: 'Three parcels lined up with labels for fast, standard and economy delivery.', caption: 'Express is fastest. Economy costs least. Standard sits between.' },
        { src: '/images/services/logistics-vehicle-1536.webp', alt: 'Parcels being loaded into a delivery van.', caption: 'Every parcel leaves with tracking, delivered worldwide.' },
      ],
      included: ['Receiving and inspection', 'Storage in our China warehouse', 'Pick, pack and dispatch', 'Express, Standard and Economy shipping', 'Returns handling'],
      good: [
        ['What is 3PL?', 'Third-party logistics: a company stores and ships your goods for you.'],
        // current site copy ("Delivery days and rate in your quote") fills [CONFIRM TYPICAL DELIVERY TIMES]
        ['Which speed should I use?', 'Express for urgent or high value items, Economy for low cost and no rush, Standard in between. Delivery days and rate are in your quote.'],
        ['Is there a minimum?', 'No. There is no minimum order and no minimum stock size.'],
      ],
      costs: {
        sub: hasRates ? 'Our standard rate plan. Your own plan is agreed when we approve your account.' : undefined,
        rows: rateRows,
        note: fees,
        testId: 'wh-costs',
      },
      team: siteImage('home-team'),
      faq: [
        ['Where is the warehouse?', 'Foshan, China. We receive, store and dispatch from there.'],
        // current site answer fills [CONFIRM RESTRICTED COUNTRIES AND PRODUCTS]
        ['Can you ship to any country?', 'We ship worldwide. We confirm your destinations when we approve your account.'],
        ['How do I get a quote?', 'Apply for a 3PL account, or log in if you already have one. Your account manager confirms the costs.'],
      ],
      cta: 'Store and ship from one place',
    }} />
  );
}
