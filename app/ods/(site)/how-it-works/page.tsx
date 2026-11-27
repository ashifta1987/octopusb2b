import type { Metadata } from 'next';
import { getSiteData } from '@/lib/ods-site';
import { Faq, FinalCta, Section, ServiceCards, Steps, TwoTabs } from '../_components/blocks';
import { ComparisonTable } from '../_components/comparison-table';
import { HOW_IT_WORKS_STEPS, homeFaq } from '../_components/copy';
import { GoogleCta } from '../_components/google-cta';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'From sign-up to delivery in four steps: one free account for sourcing, pools, dropshipping, warehousing, turnkey projects and branding.',
  alternates: { canonical: '/how-it-works' },
};

/** /how-it-works — info page with the Public_Home patterns (Part 3.1). */
export default async function HowItWorksPage() {
  const { settings } = await getSiteData();
  return (
    <>
      <PageHeader title="How it works" intro="From sign-up to delivery in four steps. One account for all six services." crumbs={[{ label: 'Home', href: '/' }, { label: 'How it works' }]}>
        <div className="mt-6">
          <GoogleCta />
        </div>
      </PageHeader>
      <Section id="steps" title="Four steps" intro="You can browse and send requests as soon as you sign in. We ask for your trade licence before your first payment.">
        <Steps steps={HOW_IT_WORKS_STEPS} />
      </Section>
      <Section id="services" tone="surface" title="Six ways to work with us" intro="Use one, or combine them.">
        <ServiceCards settings={settings} />
      </Section>
      <Section id="compare" title="Which one is right for you?" intro="You can change your mind later: everything sits in the same account.">
        <ComparisonTable settings={settings} />
      </Section>
      <Section id="two-tabs" tone="surface" title="After you sign in: two tabs, one login" intro="Shop in one tab and manage everything in the other.">
        <TwoTabs />
      </Section>
      <Section id="faq" title="Questions">
        <Faq items={homeFaq(settings)} />
      </Section>
      <FinalCta />
    </>
  );
}
