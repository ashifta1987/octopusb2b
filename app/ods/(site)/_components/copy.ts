import type { SiteSettings } from '@/lib/ods-site';

/* Copy shared by the home page and the info pages (plain English, sentence case — Part 2.6). No hard-coded numbers. */

export const HOW_IT_WORKS_STEPS = [
  { title: 'Create a free account', body: 'Continue with Google and tell us about your company. Verify it before your first payment.' },
  { title: 'Browse or ask', body: 'Open the shop, or tell our team what you need. Get prices and quotes.' },
  { title: 'Pay and we produce', body: 'Pay a deposit from your wallet. We check quality and send you the report.' },
  { title: 'We ship or store', body: 'Ship to your door, keep stock in our warehouse, or dropship to your customers.' },
];

export function homeFaq(s: SiteSettings) {
  return [
    { q: 'Who can join?', a: 'Companies only. You verify your company after sign-up; browsing and requests work right away, payments open after verification.' },
    { q: 'What does it cost to join?', a: `Nothing. You pay for what you order. ${s.feeText}` },
    { q: 'Can I order samples?', a: 'Yes. Most sourcing products have samples you can order from the product page.' },
    { q: 'What if a pool doesn’t fill?', a: 'Your deposit goes back to your wallet on the closing date. Nothing else is charged.' },
    { q: 'Can I keep my goods in China and ship later?', a: 'Yes. Use our Warehouse (3PL): we store, check and ship when you’re ready, in bulk or order by order.' },
    { q: 'Will my customers see your name?', a: 'No. With dropshipping and Make My Brand, your customers only see your brand.' },
  ];
}

export function shippingFaq(s: SiteSettings) {
  return [
    { q: 'When do I see the shipping cost?', a: 'Before you order. Product pages and quotes show the cost delivered to your country.' },
    { q: 'Are duties included?', a: 'Duties and taxes for your country are shown before you pay, so there are no surprises at the door.' },
    {
      q: 'Which countries do you deliver to?',
      a: s.deliveryCountries.length
        ? `${s.deliveryCountries.join(', ')}. More countries on request: ask our team.`
        : 'Delivery countries are being confirmed. Ask our team about your country.',
    },
    { q: 'Can I combine products in one shipment?', a: 'Yes. Keep goods in our warehouse and ship them together when you are ready.' },
    { q: 'How do I track my order?', a: 'Every shipment has tracking in My account › Orders. Dropship orders send tracking to your store.' },
  ];
}

export function helpGroups(s: SiteSettings) {
  return [
    {
      id: 'getting-started',
      title: 'Getting started',
      items: [
        homeFaq(s)[0],
        homeFaq(s)[1],
        { q: 'Why do I sign in with Google?', a: 'It is quick and safe: no new password. You can also sign in with your work email.' },
        { q: 'Where is my account after I sign in?', a: 'The shop opens in one tab. My account opens in its own tab from “My account ↗” in the shop.' },
      ],
    },
    {
      id: 'orders-payments',
      title: 'Orders and payments',
      items: [
        { q: 'How do I pay?', a: 'From your wallet. The ways to top it up are shown in My account › Wallet, and every payment is listed there.' },
        { q: 'When do I pay the balance?', a: 'After the quality check, when you have seen the report with photos.' },
        { q: 'Can I get an invoice?', a: 'Yes. Invoices and documents are in My account › Invoices.' },
      ],
    },
    { id: 'pools', title: 'MOQ pools', items: [homeFaq(s)[3], { q: 'Do other buyers see my name?', a: 'No. Buyers in a pool never see each other’s names or companies.' }] },
    { id: 'shipping', title: 'Shipping and duties', items: shippingFaq(s).slice(0, 3) },
    { id: 'brand-dropship', title: 'Dropshipping and branding', items: [homeFaq(s)[5], homeFaq(s)[4]] },
  ];
}
