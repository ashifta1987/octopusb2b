import { Box, Layers, Package, Sparkles, Truck, Users, type LucideIcon } from 'lucide-react';
import type { SiteServiceSlug } from '@/lib/ods-site';

/**
 * The six services on the introduction site (Part 2.2 colours + icons, Part 4.1/4.2 copy). Pure module: copy only — any
 * number shown next to it comes from lib/ods-site.ts. Tailwind classes are literal so they are generated.
 */
export type SiteService = {
  slug: SiteServiceSlug;
  name: string;
  /** public URL (Turnkey stays at /turnkey, owner decision D4) */
  href: string;
  icon: LucideIcon;
  line: string;
  linkLabel: string;
  /** "Minimum order", or "Minimum" for the warehouse */
  minimumLabel: string;
  cls: { bar: string; text: string; tint: string; border: string; bg: string };
  steps: { title: string; body: string }[];
  examples: { title: string; lines: string[] }[];
  faq: { q: string; a: string }[];
};

export const SITE_SERVICES: readonly SiteService[] = [
  {
    slug: 'sourcing',
    name: 'Sourcing',
    href: '/services/sourcing',
    icon: Box,
    line: 'Buy straight from verified factories at factory prices.',
    linkLabel: 'Browse sourcing products',
    minimumLabel: 'Minimum order',
    cls: { bar: 'bg-ods-svc-sourcing', text: 'text-ods-svc-sourcing', tint: 'bg-ods-svc-sourcing-tint', border: 'border-ods-svc-sourcing', bg: 'bg-ods-svc-sourcing' },
    steps: [
      { title: 'Find a product or ask for one', body: 'Browse the shop, or send a quote request with photos, quantities and your target price.' },
      { title: 'Get a quote', body: 'Our team checks the factory and sends you prices by quantity, delivered to your country.' },
      { title: 'Pay the deposit', body: 'Pay from your wallet. Production starts when the factory confirms.' },
      { title: 'Quality check, then the balance', body: 'You get a QC report with photos before the balance is due. Then we ship.' },
    ],
    examples: [
      { title: 'Stainless steel water bottle', lines: ['Prices by quantity in the shop', 'Samples on request', 'Your logo with Make My Brand'] },
      { title: 'LED desk lamp', lines: ['Factory minimum shown on the product', 'Delivery to your country shown up front', 'QC report before the balance'] },
      { title: 'Cotton tote bag', lines: ['Request a quote for your own design', 'Mix with other products in one quote', 'Ship by sea or air'] },
    ],
    faq: [
      { q: 'Who are the factories?', a: 'Verified factories checked by our team. You deal with us, not with the factory: one contract, one invoice.' },
      { q: 'Can I order a sample first?', a: 'Yes. Most sourcing products have samples you can order from the product page.' },
      { q: 'What if the goods are not right?', a: 'You see the quality report with photos before you pay the balance, and you can ask for fixes.' },
    ],
  },
  {
    slug: 'pools',
    name: 'MOQ pools',
    href: '/services/pools',
    icon: Users,
    line: 'Too small for the factory minimum? Buy together with other buyers.',
    linkLabel: 'See open pools',
    minimumLabel: 'Minimum order',
    cls: { bar: 'bg-ods-svc-pools', text: 'text-ods-svc-pools', tint: 'bg-ods-svc-pools-tint', border: 'border-ods-svc-pools', bg: 'bg-ods-svc-pools' },
    steps: [
      { title: 'Pick a pool', body: 'Each pool shows the pool price, the price alone, how full it is and when it closes.' },
      { title: 'Choose your units', body: 'Reserve the units you need and pay a deposit that is held, not spent.' },
      { title: 'The pool fills', body: 'The factory produces the whole order. You pay the balance after the quality check.' },
      { title: 'Or it doesn’t', body: 'If the pool doesn’t fill by its closing date, your deposit goes back to your wallet automatically.' },
    ],
    examples: [
      { title: 'Foldable pet crate', lines: ['Pool price below the price alone', 'Progress and closing date on the pool', 'Join with a small quantity'] },
      { title: 'Silicone kitchen set', lines: ['Several buyers share one factory order', 'Deposit held until the pool fills', 'Balance after the quality check'] },
      { title: 'Phone stand', lines: ['Pool price set by quantity reached', 'Deposit back if it doesn’t fill', 'Ship to your country or store with us'] },
    ],
    faq: [
      { q: 'What if a pool doesn’t fill?', a: 'Your deposit goes back to your wallet on the closing date. Nothing else is charged.' },
      { q: 'Do other buyers see my name?', a: 'No. Buyers in a pool never see each other’s names or companies.' },
      { q: 'Can I leave a pool?', a: 'The rules for leaving are shown on each pool before you join.' },
    ],
  },
  {
    slug: 'dropship',
    name: 'Dropshipping',
    href: '/services/dropship',
    icon: Truck,
    line: 'Sell in your Shopify store without holding stock.',
    linkLabel: 'Start dropshipping',
    minimumLabel: 'Minimum order',
    cls: { bar: 'bg-ods-svc-dropship', text: 'text-ods-svc-dropship', tint: 'bg-ods-svc-dropship-tint', border: 'border-ods-svc-dropship', bg: 'bg-ods-svc-dropship' },
    steps: [
      { title: 'Connect your store', body: 'Link your Shopify store to your account in a few clicks.' },
      { title: 'Pick products', body: 'Add products to your import list, set your price and push them to your store.' },
      { title: 'Your customer orders', body: 'The order comes to us. We pay it from your wallet and pack it.' },
      { title: 'We ship to your customer', body: 'Tracking goes to your store. Your customer only sees your brand.' },
    ],
    examples: [
      { title: 'Pet grooming glove', lines: ['Your price and landed cost before you list', 'No minimum order', 'Ships under your brand'] },
      { title: 'Car phone holder', lines: ['Push to Shopify in one click', 'Paid per order from your wallet', 'Tracking sent to your store'] },
      { title: 'Yoga resistance bands', lines: ['Delivery time shown on the product', 'Duties shown up front', 'Branded inserts with Make My Brand'] },
    ],
    faq: [
      { q: 'Will my customers see your name?', a: 'No. Parcels and tracking show your brand only.' },
      { q: 'How do I pay?', a: 'Each order is paid from your wallet. Top up when you like; you see every charge.' },
      { q: 'Which stores work?', a: 'Shopify today. Other platforms are listed in the shop when they open.' },
    ],
  },
  {
    slug: 'warehouse',
    name: 'Warehouse (3PL)',
    href: '/services/warehouse',
    icon: Package,
    line: 'Keep stock in our China warehouse. We receive, check, pack and ship.',
    linkLabel: 'See warehouse services',
    minimumLabel: 'Minimum',
    cls: { bar: 'bg-ods-svc-3pl', text: 'text-ods-svc-3pl', tint: 'bg-ods-svc-3pl-tint', border: 'border-ods-svc-3pl', bg: 'bg-ods-svc-3pl' },
    steps: [
      { title: 'Send stock to us', body: 'From our factories or your own suppliers. We receive and count every carton.' },
      { title: 'We check and store it', body: 'You see your stock in My account, item by item.' },
      { title: 'Ask for a shipment', body: 'In bulk to your warehouse, or order by order to your customers.' },
    ],
    examples: [
      { title: 'Storage', lines: ['Monthly storage per pallet or shelf', 'Stock counted on arrival', 'See stock in My account'] },
      { title: 'Fulfilment', lines: ['Pick, pack and ship per order', 'Branded packing with Make My Brand', 'Tracking for every parcel'] },
      { title: 'Bulk shipments', lines: ['Combine products into one shipment', 'Sea or air', 'Duties shown before you ship'] },
    ],
    faq: [
      { q: 'Can I keep my goods in China and ship later?', a: 'Yes. We store, check and ship when you’re ready, in bulk or order by order.' },
      { q: 'Can I send goods from other suppliers?', a: 'Yes. Tell us what is coming and we receive it like any other stock.' },
      { q: 'How do I see my stock?', a: 'In My account › Warehouse: stock, inbound, outbound and fees.' },
    ],
  },
  {
    slug: 'turnkey',
    name: 'Turnkey projects',
    href: '/turnkey',
    icon: Layers,
    line: 'A whole product line done for you, from idea to delivered stock.',
    linkLabel: 'See projects',
    minimumLabel: 'Minimum order',
    cls: { bar: 'bg-ods-svc-turnkey', text: 'text-ods-svc-turnkey', tint: 'bg-ods-svc-turnkey-tint', border: 'border-ods-svc-turnkey', bg: 'bg-ods-svc-turnkey' },
    steps: [
      { title: 'Tell us the idea', body: 'Pick a ready project in the shop or describe your own range.' },
      { title: 'Agree the plan', body: 'We agree products, packaging, timeline and price with you, step by step.' },
      { title: 'We produce and check', body: 'You follow every step in My account and see quality reports.' },
      { title: 'Delivered stock', body: 'We ship to your country or keep it in our warehouse.' },
    ],
    examples: [
      { title: 'Coffee shop starter set', lines: ['Equipment, cups and packaging', 'Timeline agreed per project', 'One project page with every step'] },
      { title: 'Private-label skincare range', lines: ['Formulas, bottles and boxes', 'Your brand on everything', 'Quality checked before shipping'] },
      { title: 'Pet accessories line', lines: ['Several products, one project', 'Samples before production', 'Store with us or ship to you'] },
    ],
    faq: [
      { q: 'How long does a project take?', a: 'It depends on the products. The timeline is agreed with you before you pay anything.' },
      { q: 'Can I change the plan?', a: 'Yes, until production starts. Changes are confirmed in writing in My account.' },
      { q: 'Who owns the designs?', a: 'Your brand, logo and artwork stay yours.' },
    ],
  },
  {
    slug: 'brand',
    name: 'Make My Brand',
    href: '/services/brand',
    icon: Sparkles,
    line: 'Your logo, colour box, labels and inserts on what you buy.',
    linkLabel: 'See branding options',
    minimumLabel: 'Minimum order',
    cls: { bar: 'bg-ods-svc-brand', text: 'text-ods-svc-brand', tint: 'bg-ods-svc-brand-tint', border: 'border-ods-svc-brand', bg: 'bg-ods-svc-brand' },
    steps: [
      { title: 'Choose what to brand', body: 'Logo on the product, colour box, labels, inserts or bags.' },
      { title: 'Send your artwork', body: 'Upload your files. We prepare a proof for you to approve.' },
      { title: 'Approve the proof', body: 'Nothing is printed until you approve it in My account.' },
      { title: 'Branded with your order', body: 'Branding is produced with your order and checked with it.' },
    ],
    examples: [
      { title: 'Logo print', lines: ['On the product itself', 'Proof before production', 'Minimum shown on the option'] },
      { title: 'Colour box', lines: ['Your design, printed in full colour', 'Fits the product exactly', 'Checked with your order'] },
      { title: 'Labels and inserts', lines: ['Thank-you cards, manuals, stickers', 'For sourcing and dropshipping', 'Added to your order'] },
    ],
    faq: [
      { q: 'Can I brand dropshipping orders?', a: 'Yes. Branded inserts and packaging work with dropshipping too.' },
      { q: 'What files do you need?', a: 'Vector files (AI, PDF or SVG) work best. We tell you if anything is missing.' },
      { q: 'Will my customers see your name?', a: 'No. Your customers only see your brand.' },
    ],
  },
];

export const siteService = (slug: string) => SITE_SERVICES.find((s) => s.slug === slug);

/** Footer + help columns (public URLs only). */
export const FOOTER_COLUMNS = [
  { title: 'Services', links: SITE_SERVICES.map((s) => ({ label: s.name, href: s.href })) },
  {
    title: 'Help',
    links: [
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Shipping and duties', href: '/shipping' },
      { label: 'FAQ', href: '/help#faq' },
      { label: 'Contact us', href: '/help#contact' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About us', href: '/about' },
      { label: 'Become a supplier', href: '/suppliers' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Cookies', href: '/legal/cookies' },
      { label: 'Refunds', href: '/legal/refunds' },
    ],
  },
];
