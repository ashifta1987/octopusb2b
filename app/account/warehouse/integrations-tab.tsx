import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/ui';
import { INTEGRATION_STATE, STORE_PLATFORMS, type IntegrationState } from '@/lib/warehouse-w5';

/**
 * Warehouse OS · W5 portal Integrations tab (board 23). Every platform with its HONEST status: what works today (CSV upload,
 * the portal order form, links to the other Octopus services), and "Not available yet" for store connectors that are not built.
 * No connect buttons and no fake connection state. The Octopus API exists for Octopus B2B only; warehouse data is not in it yet.
 */
type ServiceStatus = 'off' | 'trial' | 'on' | 'paused';
const TONE = { info: 'blue', warn: 'amber', ok: 'green', bad: 'red', neutral: 'gray' } as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const serviceText = (s: ServiceStatus) => (s === 'on' ? 'Switched on for your company' : s === 'trial' ? 'On trial for your company' : s === 'paused' ? 'Paused for your company' : 'Not switched on for your company');

function Card({ name, state, children, action }: { name: string; state: IntegrationState; children: ReactNode; action?: ReactNode }) {
  const [label, tone] = INTEGRATION_STATE[state];
  const id = slug(name);
  return (
    <li className="rounded-[10px] border border-line p-4 flex flex-col gap-2 bg-white" data-testid={`wh-int-${id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[15.5px] font-semibold">{name}</h3>
        <span className="ml-auto" data-testid={`wh-int-state-${id}`}><StatusBadge status={state} label={label} tone={TONE[tone]} /></span>
      </div>
      <div className="text-[13.5px] text-black/80">{children}</div>
      {action && <div className="mt-auto pt-1">{action}</div>}
    </li>
  );
}

export function IntegrationsTab({ services }: { services: { dropship: ServiceStatus; brand: ServiceStatus; sourcing: ServiceStatus } }) {
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-integrations">
      <section className="card p-5" aria-labelledby="wh-int-now">
        <h2 id="wh-int-now" className="text-[18px] font-semibold m-0">Send us orders today</h2>
        <ul className="mt-3 mb-0 p-0 list-none grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card name="CSV upload" state="available"
            action={<Link href="/account/warehouse?tab=orders" className="btn btn-ghost btn-sm" data-testid="wh-int-csv-link">Upload orders</Link>}>
            Upload a CSV file of orders (one row per product; up to 200 orders a file). We check every row and show a preview before anything is created. Most store platforms can export orders as CSV.
          </Card>
          <Card name="Portal order form" state="available"
            action={<Link href="/account/warehouse?tab=orders" className="btn btn-ghost btn-sm">New order</Link>}>
            Type one order at a time in the Orders tab. We reserve your stock as soon as the order arrives.
          </Card>
        </ul>
      </section>

      <section className="card p-5" aria-labelledby="wh-int-octopus">
        <h2 id="wh-int-octopus" className="text-[18px] font-semibold m-0">Octopus services</h2>
        <ul className="mt-3 mb-0 p-0 list-none grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card name="Octopus Dropship" state="link"
            action={<Link href="/account/dropship" className="btn btn-ghost btn-sm">Open Dropshipping</Link>}>
            {serviceText(services.dropship)}. Dropship orders for products Octopus sources are packed in this warehouse automatically. Your own 3PL stock is not linked to Dropship stores yet.
          </Card>
          <Card name="Octopus B2B" state="link"
            action={<Link href="/account/sourcing" className="btn btn-ghost btn-sm">Open Sourcing</Link>}>
            {serviceText(services.sourcing)}. Buy from verified factories; to receive the goods into your 3PL stock, send a stock notice under Send stock or ask us in Support.
          </Card>
          <Card name="Make My Brand" state="link"
            action={<Link href="/account/brand" className="btn btn-ghost btn-sm">Open Make My Brand</Link>}>
            {serviceText(services.brand)}. Branded products and packaging made for you; to store them here, send a stock notice for the delivery.
          </Card>
        </ul>
      </section>

      <section className="card p-5" aria-labelledby="wh-int-later">
        <h2 id="wh-int-later" className="text-[18px] font-semibold m-0">Store connections and API</h2>
        <p className="mt-1 mb-0 text-[13.5px] text-black/75">These are not connected to the warehouse yet. We list them so you know where things stand; until then, export your orders as CSV and upload them.</p>
        <ul className="mt-3 mb-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STORE_PLATFORMS.map((p) => (
            <Card key={p} name={p} state="not_yet">No connection to {p} yet. Orders and tracking don’t sync automatically.</Card>
          ))}
          <Card name="API and webhooks" state="not_yet"
            action={<Link href="/account/developer" className="btn btn-ghost btn-sm">Open API &amp; integrations</Link>}>
            Your API keys and webhooks cover Octopus B2B (orders, quotes, wallet). Warehouse orders, stock and returns are not in the API yet.
          </Card>
        </ul>
      </section>
    </div>
  );
}
