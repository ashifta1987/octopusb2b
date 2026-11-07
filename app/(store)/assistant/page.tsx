import type { Metadata } from 'next';
import { ExplainerPage } from '@/components/store/explainer';

export const metadata: Metadata = {
  title: 'Octo assistant — answers about your orders, any time',
  description: 'Octo answers questions about your orders, quotes, shipping and wallet at any hour, and hands you to a person on our team when it matters.',
  alternates: { canonical: '/assistant' },
};

/** ADDON-36 H4 — public explainer for the account assistant. */
export default function AssistantExplainer() {
  return (
    <ExplainerPage e={{
      name: 'Octo assistant',
      h1: 'Octo answers your questions at any hour',
      intro: 'Ask about an order, a quote, a shipment or your wallet. Octo reads your own account data and replies straight away. Anything sensitive goes to a person on our team.',
      next: '/account/assistant',
      points: [
        ['Knows your account', 'Order status, quotes waiting for you, tracking numbers and wallet balance, without searching.'],
        ['A person when it matters', 'Refunds, disputes, QC failures and pricing questions go to your account manager.'],
        ['Office hours in China', 'Our team picks up handovers Monday to Friday, 09:00–18:00 China time. Outside those hours your question waits in the queue for the next morning.'],
        ['Private by design', 'Octo only sees your organisation’s data. Supplier identities stay hidden behind supplier codes.'],
        ['Full history', 'Every conversation is saved in your account so you can pick up where you left off.'],
      ],
    }} />
  );
}
