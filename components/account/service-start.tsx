import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, serviceOn, type ServiceKey } from '@/lib/core/account';

const COPY: Record<Exclude<ServiceKey, 'sourcing'>, { title: string; lead: string; points: string[] }> = {
  dropship: {
    title: 'Dropshipping',
    lead: 'Connect your Shopify or WooCommerce store. Each order is paid from your wallet, packed in China and shipped to your customer under your store name.',
    points: ['Pick products from the Octopus catalogue', 'Orders come in from your store automatically', 'Express, Standard or Economy shipping; tracking goes back to your store'],
  },
  warehouse: {
    title: '3PL warehouse',
    lead: 'Send your stock to our warehouse. We receive and count it, store it, and pick, pack and ship each order you send us.',
    points: ['See stock, inbound and outbound in one place', 'Choose to keep or return extra units on arrival', 'Monthly storage and handling bill, paid from your wallet'],
  },
  brand: {
    title: 'Make My Brand',
    lead: 'Put your own brand on products from verified suppliers: logo, packaging and inserts, from quote and artwork to stock and shipping.',
    points: ['Only products Octopus lists directly (verified suppliers)', 'Approve artwork and samples before production', 'Branded stock is stored and shipped by our warehouse'],
  },
};

/** ADDON-41 — a service tab: Start card while the service is off, or a "being set up" card until its section ships. */
export function ServiceStart({ service }: { service: Exclude<ServiceKey, 'sourcing'> }) {
  return <Suspense fallback={<PageSkeleton cards={1} table={false} />}><ServiceStartContent service={service} /></Suspense>;
}

async function ServiceStartContent({ service }: { service: Exclude<ServiceKey, 'sourcing'> }) {
  const s = await requireCustomer(`/account/${service}`);
  const ctx = await getAccountContext(s.org!.id);
  const st = ctx.services[service];
  const c = COPY[service];
  const on = serviceOn(st);
  return (
    <div className="max-w-[860px]">
      <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-blue">{on ? 'Switched on' : 'Not switched on yet'}</div>
      <h1 className="text-[32px] font-extrabold leading-tight">{c.title}</h1>
      <section className="card p-6 mt-5" data-testid={on ? 'service-setting-up' : 'service-start'}>
        <p className="text-[16px]">{c.lead}</p>
        <ul className="mt-4 space-y-2">{c.points.map((p) => <li key={p} className="flex gap-2.5 text-[15px]"><span aria-hidden className="text-ok font-bold">✓</span>{p}</li>)}</ul>
        {on ? (
          <p className="mt-5 text-[15px] text-[#5A6475]">Your account manager is setting this up for your company{st.plan ? ` (plan: ${st.plan})` : ''}. You will see it here as soon as it is running.</p>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={`/account/support?topic=${service}`} className="btn btn-primary min-h-11">Start {c.title}</Link>
            <span className="text-[14px] text-[#5A6475]">{ctx.manager ? `${ctx.manager.name}, your account manager,` : 'Your account manager'} switches it on and explains the prices.</span>
          </div>
        )}
      </section>
    </div>
  );
}
