import type { Metadata } from 'next';
import { ExplainerPage } from '@/components/store/explainer';

export const metadata: Metadata = {
  title: 'API and integrations — connect your shop or ERP',
  description: 'The Octopus B2B REST API: products, RFQs, quotes, orders, shipments and wallet, with OAuth, webhooks, an OpenAPI spec and a Postman collection.',
  alternates: { canonical: '/developers' },
};

/** ADDON-36 H4 — public explainer for the customer API. */
export default function DevelopersExplainer() {
  return (
    <ExplainerPage e={{
      name: 'API and integrations',
      h1: 'Connect your shop or ERP to Octopus B2B',
      intro: 'Send orders automatically from your store, pull product data and get webhooks when quotes arrive or shipments move. Create API keys in your account.',
      next: '/account/developer',
      points: [
        ['REST API', 'Products, categories, RFQs, quotes, orders, service requests, shipments and wallet under /api/v1.'],
        ['Webhooks', 'Get notified when a quote arrives, an order changes status or a shipment is updated.'],
        ['OAuth and API keys', 'Use a key for your own systems or OAuth to connect an app on behalf of your team.'],
        ['Test keys first', 'Build against test keys; live keys unlock after your company is verified.'],
        ['Shop connectors', 'Shopify and WooCommerce orders can be sent here automatically, or upload a sheet.'],
      ],
      extra: (
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/api/v1/openapi.json" className="btn btn-ghost min-h-11">OpenAPI spec (JSON)</a>
          <a href="/api/v1/postman.json" className="btn btn-ghost min-h-11">Postman collection</a>
        </div>
      ),
    }} />
  );
}
