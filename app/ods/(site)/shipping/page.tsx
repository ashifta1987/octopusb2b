import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { Icon } from '@octopus/ui';
import { getSiteData } from '@/lib/ods-site';
import { Countries, Faq, FinalCta, Section, Steps } from '../_components/blocks';
import { shippingFaq } from '../_components/copy';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Shipping and duties',
  description: 'See the cost delivered to your country before you order: product, shipping and duties.',
  alternates: { canonical: '/shipping' },
};

/** /shipping — what is shown up front, where we deliver (settings), how shipping works, FAQ. */
export default async function ShippingPage() {
  const { settings } = await getSiteData();
  return (
    <>
      <PageHeader
        title="Shipping and duties"
        intro="See the cost delivered to your country before you order: product, shipping and duties."
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Shipping and duties' }]}
      />
      <Section id="up-front" title="What you see before you pay" intro="Every price in the shop and every quote shows the full cost to your door.">
        <ul className="grid gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
          {[
            ['Product price', 'By quantity, for the amount you choose.'],
            ['Shipping', 'To your country, by sea or air where both are offered.'],
            ['Duties and taxes', 'For your country, shown before you pay.'],
            ['Service fees', settings.feeText],
          ].map(([t, b]) => (
            <li key={t} className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
              <Icon icon={Check} className="text-ods-success" />
              <h3 className="mt-2 text-ods-body font-bold text-ods-navy">{t}</h3>
              <p className="mt-1 text-ods-table text-ods-slate">{b}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="countries" tone="surface" title="Where we deliver">
        <Countries countries={settings.deliveryCountries} />
      </Section>
      <Section id="how" title="How shipping works">
        <Steps
          steps={[
            { title: 'Quality check', body: 'We check your goods before they leave and send you the report.' },
            { title: 'Packing', body: 'Packed for the trip, with your branding if you use Make My Brand.' },
            { title: 'On the way', body: 'Tracking for every shipment in My account › Orders.' },
            { title: 'Delivered', body: 'To your door, or stored in our warehouse until you need it.' },
          ]}
        />
      </Section>
      <Section id="faq" tone="surface" title="Questions">
        <Faq items={shippingFaq(settings)} />
      </Section>
      <FinalCta />
    </>
  );
}
