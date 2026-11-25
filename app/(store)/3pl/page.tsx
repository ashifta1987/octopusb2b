import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import { isWarehouseOsEnabled } from '@/lib/warehouse';

export const metadata: Metadata = {
  title: { absolute: '3PL and fulfilment in China: receive, store, pack with proof, ship | Octopus B2B' },
  description: 'Send your stock to our warehouses in China. We receive and count it, store it, pack every order with photo and weight proof, and ship with tracked express carriers. No minimums.',
  alternates: { canonical: '/3pl' },
};

type Wh = { code: string; name: string; city: string; email: string | null; hours: string | null; is_default: boolean };
type Rate = { plan_code: string; warehouse_code: string | null; receiving_per_carton_cents: number | null; storage_per_pallet_month_cents: number | null; pick_pack_first_cents: number | null; pick_pack_extra_cents: number | null; returns_per_item_cents: number | null };

const NAV: [string, string][] = [['who', 'Who it is for'], ['family', 'Octopus family'], ['how', 'How it works'], ['services', 'Services'], ['proof', 'Proof'], ['connections', 'Connections'], ['faq', 'FAQ']];

/** Warehouse OS board 25 — public intro page (matched to the written design; the design's photos were not supplied). */
export default function ThreePlPage() {
  return <Suspense fallback={<div className="h-[600px] bg-[#1A174A]" aria-hidden />}><Intro /></Suspense>;
}

async function Intro() {
  if (!(await isWarehouseOsEnabled())) redirect('/request/3pl');
  const sb = await createClient();
  const [whRes, rateRes] = await Promise.all([
    sb.from('warehouses').select('code, name, city, email, hours, is_default').eq('status', 'active').order('is_default', { ascending: false }).order('name'),
    sb.from('wh_rate_versions').select('plan_code, warehouse_code, receiving_per_carton_cents, storage_per_pallet_month_cents, pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents').eq('status', 'active').eq('plan_code', 'standard').is('warehouse_code', null).maybeSingle(),
  ]);
  const whs = (whRes.data ?? []) as Wh[];
  const main = whs.find((w) => w.is_default) ?? whs[0];
  const r = (rateRes.data ?? null) as Rate | null;
  const fee = (c: number | null | undefined) => (c == null ? null : money(Number(c), 'USD'));
  const rateLines = r ? ([
    ['Receiving, per carton', fee(r.receiving_per_carton_cents)], ['Storage, per pallet per month', fee(r.storage_per_pallet_month_cents)],
    ['Pick and pack, first item', fee(r.pick_pack_first_cents)], ['Each extra item', fee(r.pick_pack_extra_cents)], ['Returns, per item', fee(r.returns_per_item_cents)],
  ] as [string, string | null][]).filter(([, v]) => v) : [];
  const cities = whs.map((w) => w.city).join(', ');

  return (
    <div className="bg-white text-[#1A174A]" data-testid="wh-intro">
      <nav aria-label="On this page" className="sticky top-0 z-30 bg-white border-b border-[#E3E7EF]">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 flex items-center gap-4 overflow-x-auto">
          <span className="font-bold whitespace-nowrap py-3">Octopus 3PL</span>
          <ul className="flex gap-1 list-none m-0 p-0">
            {NAV.map(([id, label]) => <li key={id}><a href={`#${id}`} className="inline-flex min-h-11 items-center px-2 text-[14px] whitespace-nowrap text-[#1A174A] hover:text-[#2563C9]">{label}</a></li>)}
          </ul>
          <span className="ml-auto flex gap-2 py-2">
            <Link href="/login?next=%2Faccount%2Fwarehouse" className="inline-flex min-h-11 items-center px-3 rounded-[8px] border border-[#B7CCF3] text-[14px] font-semibold whitespace-nowrap">Sign in</Link>
            <Link href="/3pl/apply" className="inline-flex min-h-11 items-center px-3 rounded-[8px] bg-[#2563C9] text-white text-[14px] font-semibold whitespace-nowrap" data-testid="wh-intro-apply">Apply for an account</Link>
          </span>
        </div>
      </nav>

      <section className="bg-[#1A174A] text-white">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14 grid gap-8 lg:grid-cols-[1.2fr_1fr] items-center">
          <div className="space-y-5">
            <h1 className="text-[36px] sm:text-[46px] font-extrabold leading-[1.08] m-0">Your stock in China. Every order packed with proof.</h1>
            <p className="text-[17px] text-[#EEF3FD] m-0 max-w-[560px]">We receive and count your stock, store it, pack each order with photos, a scan log and a weight check, and ship it with tracked express carriers. No minimum order and no minimum stock.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/3pl/apply" className="inline-flex min-h-12 items-center px-5 rounded-[10px] bg-[#2563C9] text-white font-semibold no-underline hover:bg-[#1E50A8]">Apply for an account</Link>
              <a href="#how" className="inline-flex min-h-12 items-center px-5 rounded-[10px] border border-white/40 text-white font-semibold no-underline hover:bg-white/10">How it works</a>
            </div>
          </div>
          <div className="rounded-[16px] bg-white text-[#1A174A] p-5" aria-label="Example packing record">
            <div className="text-[12px] font-bold uppercase tracking-[.08em] text-[#2563C9]">Example packing record · demo order DEMO-1042</div>
            <dl className="mt-3 grid grid-cols-[150px_1fr] gap-y-1.5 text-[14px] m-0">
              <dt className="text-[#5B6478]">Contents</dt><dd className="m-0">Every item scanned into the box</dd>
              <dt className="text-[#5B6478]">Photos</dt><dd className="m-0">Contents, sealed box, on the scale</dd>
              <dt className="text-[#5B6478]">Weight check</dt><dd className="m-0">Expected 266 g · measured 270 g · inside tolerance</dd>
              <dt className="text-[#5B6478]">Label</dt><dd className="m-0">Scanned to confirm it belongs to the order</dd>
            </dl>
            <p className="mt-3 mb-0 text-[12.5px] text-[#5B6478]">An example to show what you get for every order.</p>
          </div>
        </div>
      </section>

      <section id="who" className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14 scroll-mt-16" aria-labelledby="who-h">
        <h2 id="who-h" className="text-[28px] font-bold m-0">Who it is for</h2>
        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0">
          {[['Online stores', 'Shopify, WooCommerce, TikTok Shop and more: we ship each order as it comes in.'], ['Brands made in China', 'Products made with Make My Brand go straight to our shelves.'], ['Dropshippers', 'Private dropship with or without your brand, packed under your store name.'], ['Wholesale buyers', 'Store a bulk order and send it out in parts, by parcel or pallet.']].map(([t, d]) => (
            <li key={t} className="rounded-[14px] border border-[#E3E7EF] p-5"><h3 className="m-0 text-[17px] font-semibold">{t}</h3><p className="mt-1 mb-0 text-[14.5px] text-[#3B4160]">{d}</p></li>
          ))}
        </ul>
      </section>

      <section id="family" className="bg-[#EEF3FD] scroll-mt-16" aria-labelledby="family-h">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14">
          <h2 id="family-h" className="text-[28px] font-bold m-0">The Octopus family</h2>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0">
            {[['Octopus B2B', 'Sourcing: stock notices and quality reports reach us before the goods.'], ['Make My Brand', 'Your name, logo and packaging on the products we receive.'], ['Octopus 3PL', 'We receive, store, pack with proof and ship.'], ['Octopus Dropship', 'Orders from your stores come in; tracking goes back.']].map(([t, d]) => (
              <li key={t} className="rounded-[14px] bg-white p-5"><h3 className="m-0 text-[17px] font-semibold">{t}</h3><p className="mt-1 mb-0 text-[14.5px] text-[#3B4160]">{d}</p></li>
            ))}
          </ul>
          <p className="mt-5 mb-0 text-[15px]"><strong>Private dropship, two routes:</strong> with your brand (made through Make My Brand, shipped in your branded box and slip) or without it (chosen from what Octopus B2B sources, shipped in a neutral box with your store name on the slip). Both share one portal, packing proof, tracking and one invoice.</p>
        </div>
      </section>

      <section id="how" className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14 scroll-mt-16" aria-labelledby="how-h">
        <h2 id="how-h" className="text-[28px] font-bold m-0">How it works</h2>
        <ol className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0">
          {[['Apply', 'We check your company and products and agree a rate plan.', 'Your portal account'], ['Send stock', 'Create a stock notice in the portal and book your delivery.', 'Arrival date and dock slot'], ['We receive', 'Every carton is counted against your notice; differences are photographed.', 'Counts, photos, putaway'], ['Orders come in', 'From your store, Octopus Dropship, a CSV upload or the API.', 'Every order in one list'], ['Pack with proof', 'Scan every item, weigh the parcel, scan the label.', 'Photos, scan log, weight check'], ['Ship and invoice', 'The best carrier chosen by rules; tracking back to your store; one monthly invoice.', 'Tracking and one invoice']].map(([t, d, see], i) => (
            <li key={t} className="rounded-[14px] border border-[#E3E7EF] p-5">
              <div className="flex items-center gap-2"><span className="inline-flex w-8 h-8 rounded-full bg-[#1A174A] text-white items-center justify-center font-bold" aria-hidden="true">{i + 1}</span><h3 className="m-0 text-[17px] font-semibold">{t}</h3></div>
              <p className="mt-2 mb-1 text-[14.5px] text-[#3B4160]">{d}</p>
              <p className="m-0 text-[13px] text-[#2563C9] font-semibold">You see: {see}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="services" className="bg-[#EEF3FD] scroll-mt-16" aria-labelledby="services-h">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14">
          <h2 id="services-h" className="text-[28px] font-bold m-0">Services</h2>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0">
            {[['Receiving', 'Counted against your stock notice, with photos of anything short, over or damaged.'], ['Storage', 'Rack, row and bin locations; lots and serial numbers recorded.'], ['Pick and pack', 'Scanned to the order, packed with proof.'], ['Packaging materials', 'Boxes, mailers, tape and marks, charged only when used.'], ['Shipping', 'Tracked express carriers, chosen by country, product type and weight, with a fallback.'], ['Returns', 'Inspected and photographed; you choose restock, discard or send back.']].map(([t, d]) => (
              <li key={t} className="rounded-[14px] bg-white p-5"><h3 className="m-0 text-[17px] font-semibold">{t}</h3><p className="mt-1 mb-0 text-[14.5px] text-[#3B4160]">{d}</p></li>
            ))}
          </ul>
        </div>
      </section>

      <section id="proof" className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14 scroll-mt-16" aria-labelledby="proof-h">
        <h2 id="proof-h" className="text-[28px] font-bold m-0">Packing proof for every order</h2>
        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0">
          {[['Three photos', 'Contents, sealed box and the box on the scale.'], ['Scan log', 'Every item and the label, with time and packer.'], ['Weight check', 'Measured against expected; a big difference needs a supervisor.'], ['Label match', 'The label is scanned to confirm it belongs to the order.']].map(([t, d]) => (
            <li key={t} className="rounded-[14px] border border-[#E3E7EF] p-5"><h3 className="m-0 text-[17px] font-semibold">{t}</h3><p className="mt-1 mb-0 text-[14.5px] text-[#3B4160]">{d}</p></li>
          ))}
        </ul>
      </section>

      <section id="connections" className="bg-[#EEF3FD] scroll-mt-16" aria-labelledby="connections-h">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14">
          <h2 id="connections-h" className="text-[28px] font-bold m-0">Connections</h2>
          <p className="mt-2 mb-0 text-[15px] max-w-[760px]">Orders in from Shopify, WooCommerce, a CSV upload, the API, Octopus Dropship, Octopus B2B and Make My Brand. Tracking goes back to your store.</p>
        </div>
      </section>

      <section className="max-w-[1240px] mx-auto px-4 sm:px-8 py-14" aria-labelledby="billing-h">
        <h2 id="billing-h" className="text-[28px] font-bold m-0">Billing</h2>
        {rateLines.length > 0 ? (
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 max-w-[760px] m-0" data-testid="wh-intro-rates">
            {rateLines.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-[#E3E7EF] py-2"><dt>{k}</dt><dd className="m-0 font-semibold">{v}</dd></div>)}
          </dl>
        ) : (
          <p className="mt-2 mb-0 text-[15px]" data-testid="wh-intro-rates-none">Your rate plan is agreed with you when we approve your account. One monthly invoice lists every charge, and each line opens to the orders and movements behind it.</p>
        )}
        <h3 className="mt-8 mb-2 text-[20px] font-bold">Three steps to your first order</h3>
        <ol className="m-0 pl-5 text-[15px] leading-[1.8]"><li>Apply for an account.</li><li>Send your stock with a stock notice.</li><li>Connect your store or upload orders.</li></ol>
      </section>

      <section id="faq" className="bg-[#EEF3FD] scroll-mt-16" aria-labelledby="faq-h">
        <div className="max-w-[900px] mx-auto px-4 sm:px-8 py-14">
          <h2 id="faq-h" className="text-[28px] font-bold m-0">Questions</h2>
          <div className="mt-4 flex flex-col gap-2">
            {[
              ['Where is the warehouse?', whs.length > 1 ? `We have warehouses in ${cities}, China. ${main ? `${main.name} is our main warehouse.` : ''}` : `${main ? `${main.city}, ${main.name === main.city ? 'Guangdong, ' : ''}China.` : 'China.'}`],
              ['Is there a minimum?', 'No. There is no minimum order and no minimum stock size.'],
              ['Which countries do you ship to?', 'Most countries, with tracked express carriers. We confirm your destinations when we approve your account.'],
            ].map(([q, a]) => (
              <details key={q} className="rounded-[12px] bg-white p-4"><summary className="font-semibold cursor-pointer">{q}</summary><p className="mt-2 mb-0 text-[15px]">{a}</p></details>
            ))}
          </div>
        </div>
      </section>

      {main && (
        <footer className="bg-[#1A174A] text-[#EEF3FD]" data-testid="wh-intro-footer">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-8 py-8 text-[14px] flex flex-wrap gap-x-8 gap-y-2">
            <span className="font-semibold text-white">Octopus 3PL · {main.name}, China</span>
            {main.email && <a href={`mailto:${main.email}`} className="text-white underline">{main.email}</a>}
            {main.hours && <span>{main.hours}</span>}
          </div>
        </footer>
      )}
    </div>
  );
}
