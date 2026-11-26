import { ServicePage } from './service-page';
import { h2Class } from './ui';
import { siteImage } from '@/lib/site-images';
import { LaunchNotifyForm } from '@/components/store/launch-notify-form';

/** Dropshipping — design page 05 (Coming soon). The launch list form is the existing LaunchNotifyForm (migration 203). */
export function DropshipComingSoon() {
  const notify = (
    <section id="notify" className="px-4 sm:px-6 pb-[72px] scroll-mt-4" aria-labelledby="notify-h" data-testid="dropship-notify">
      <div className="max-w-[720px] mx-auto bg-white border border-line rounded-[18px] p-8">
        <h3 id="notify-h" className={`${h2Class} text-[24px]!`}>Notify me when it launches</h3>
        <p className="mt-2 mb-5 text-[16px] text-muted">One email at launch. Nothing else.</p>
        <LaunchNotifyForm feature="dropship" source="request-page" buttonClass="inline-flex items-center justify-center min-h-12 px-6 rounded-[10px] bg-coral text-white font-semibold hover:bg-coral-text disabled:opacity-60" />
      </div>
    </section>
  );
  return (
    <ServicePage testId="dropship-coming-soon" afterIncluded={notify} d={{
      key: 'dropship',
      crumb: 'Dropshipping',
      soon: true,
      title: 'You sell. We ship to your customer.',
      lead: 'Connect your store and we fulfil each order from our China warehouse, so you never hold stock. This service is not live yet. Join the launch list and we will email you the day it opens.',
      primary: { href: '#notify', label: 'Join the launch list' },
      note: 'Not available yet. Launch email only.',
      hero: siteImage('dropship-hero'),
      facts: [['Status', 'Coming soon'], ['Stores', 'Shopify, WooCommerce (planned)'], ['Stock to buy', 'None'], ['Launch', 'Email list']],
      who: [
        ['Online store owners', 'You want to list products without buying stock first.'],
        ['Social sellers', 'You sell through Instagram or messaging and need someone to ship each order.'],
        ['Brand testers', 'You want to test demand before ordering in bulk.'],
      ],
      howSub: 'Planned process. Details may change before launch.',
      steps: [
        ['Connect your store', 'Shopify and WooCommerce connections are planned for launch.'],
        ['Choose products', 'Pick products from the catalogue, or from your own branded range.'],
        ['A customer orders', 'The order reaches us automatically from your store.'],
        ['We pack and ship', 'We pack and send it directly to your customer, worldwide.'],
      ],
      learnTitle: 'What dropshipping is, and what to plan for',
      learnSub: 'Learn the model before launch so you can start with confidence.',
      learn: [
        { ...siteImage('dropship-pack'), caption: 'You take the order and set the price. We pick, pack and ship it.' },
        { ...siteImage('dropship-parcel'), caption: 'Your customer receives the parcel. Branded packaging is possible with Make My Brand.' },
        { src: '/images/design/25-dropshipping-education-image-3.webp', alt: 'A person comparing delivery times and costs on a screen.', caption: 'Shipping speed and cost affect your price, so plan for both.' },
      ],
      included: ['No stock to buy upfront', 'Orders packed and shipped from our warehouse', 'Connects with Shopify and WooCommerce (planned)', 'Pairs with Make My Brand and 3PL'],
      good: [
        ['What is dropshipping?', 'You sell the product. The supplier ships it directly to your customer, so you hold no stock.'],
        // the bracket allows "leave as coming soon" — the current site says Coming soon
        ['When does it launch?', 'Coming soon.'],
        ['Can I start sooner?', 'Yes. Our 3PL service already stores and ships your own stock.'],
      ],
      faq: [
        ['Is dropshipping available now?', 'Not yet. Join the launch list and we will email you the day it opens.'],
        ['Which stores will connect?', 'Shopify and WooCommerce are planned.'],
        ['Can I ship my own stock instead?', 'Yes, with our 3PL and logistics service.'],
      ],
      cta: 'Be first when dropshipping opens',
    }} />
  );
}
