/** Staging fixture SAMPLE DATA for ODS T9 Website screens. Never used by the live pages. */
import type { ContentData } from '@/app/ods/admin/content/_lib/data';
import type { AdsData } from '@/app/ods/admin/ads/_lib/data';
import type { CurrencyData } from '@/app/ods/admin/currency/_lib/data';
import type { StaffNote, TermsVersion } from '@/app/ods/admin/_website/website-core';

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const sections = (prefix: string) => Array.from({ length: 15 }, (_, i) => ({ no: i + 1, title: ['Definitions', 'Quotes and orders', 'Prices and payment', 'Deposits', 'Production', 'Quality control', 'Shipping'][i] ?? `Section ${i + 1}`, body: i === 3 ? `${prefix} A deposit of {{deposit_pct}} % is due when the order is confirmed. The balance is due before shipping ({{balance_days}} days).` : `${prefix} Sample text for section ${i + 1}.` }));

export const SAMPLE_TERMS: TermsVersion[] = [
  { id: id(1), version: 'v1.4', status: 'draft', sections: sections('Draft:'), publish_at: null, published_at: null, created_at: '2026-11-20T09:00:00Z' },
  { id: id(2), version: 'v1.3', status: 'published', sections: sections('Live:'), publish_at: null, published_at: '2026-10-01T09:00:00Z', created_at: '2026-09-15T09:00:00Z' },
  { id: id(3), version: 'v1.2', status: 'superseded', sections: sections('Old:'), publish_at: null, published_at: '2026-06-01T09:00:00Z', created_at: '2026-05-20T09:00:00Z' },
];

export function sampleContent(tab: string): ContentData {
  switch (tab) {
    case 'pages': {
      const pages = [
        { id: id(11), slug: 'privacy', title: 'Privacy policy', body: 'We collect only what we need to run your account…', status: 'published', is_legal: true, published_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' },
        { id: id(12), slug: 'refunds', title: 'Refund policy', body: 'Refunds follow the order stage…', status: 'in_review', is_legal: true, published_at: null, updated_at: '2026-11-21T09:00:00Z' },
        { id: id(13), slug: 'about', title: 'About Octopus', body: 'Octopus sources, inspects and ships for growing brands.', status: 'published', is_legal: false, published_at: '2026-09-01T09:00:00Z', updated_at: '2026-11-02T09:00:00Z' },
      ];
      return {
        tab: 'pages',
        pages,
        page: pages[0],
        proposals: [{ id: id(21), snapshot: { title: 'Privacy policy', body: 'Updated retention periods (proposal).' }, created_by: id(91), created_at: '2026-11-24T10:00:00Z' }],
        history: [{ id: id(22), snapshot: { status: 'published', title: 'Privacy policy' }, created_by: id(92), created_at: '2026-10-01T09:00:00Z' }],
        who: { [id(91)]: 'Lina Chen', [id(92)]: 'Priya Shah' },
      };
    }
    case 'blocks':
      return { tab: 'blocks', blocks: [
        { key: 'home.hero.title', value: 'Source, inspect and ship — one team in China', status: 'published', updated_at: '2026-11-10T09:00:00Z' },
        { key: 'home.side.pools', value: 'Join a group buy|Lower MOQ, shared container', status: 'published', updated_at: '2026-11-02T09:00:00Z' },
        { key: 'footer.note', value: 'Prices exclude import duties and local taxes.', status: 'published', updated_at: '2026-10-20T09:00:00Z' },
      ] };
    case 'company':
      return {
        tab: 'company',
        company: { legal_name: 'Octopus Trading (Shenzhen) Co., Ltd.', brand: 'Octopus B2B', tagline: 'Your team in China', contact_person: 'Priya Shah', phone: '+86 755 0000 0000', whatsapp: '+86 138 0000 0000', email: 'hello@example.com', website: 'example.com', address: 'Futian District, Shenzhen, China', address_cn: '深圳市福田区', legal_name_cn: '示例贸易有限公司', registered_in: 'Shenzhen, China', governing_law: 'Hong Kong SAR' },
        branches: [{ id: id(31), name: 'Shenzhen HQ', city: 'Shenzhen', country: 'China', address: 'Futian District', phone: '+86 755 0000 0000', email: 'sz@example.com', sort: 1, active: true, is_hq: true, tone: 'blue', specialities: ['Electronics', 'Home'] }],
        countries: [['CN', 'China'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom']],
      };
    case 'home':
      return {
        tab: 'home',
        banners: [{ id: id(41), eyebrow: 'New · Turnkey Projects', title: 'Open a project in a shared container', body: 'Book space, we source and inspect.', cta_label: 'See projects', cta_href: '/turnkey', cta2_label: null, cta2_href: null, ticks: ['QC included', 'Door to door'], theme: 'navy', image_url: null, show_open_project: true, starts_at: null, ends_at: '2026-12-31T00:00:00Z', sort: 10, active: true }],
        bannerStats: { [id(41)]: '1,204 views · 63 clicks · 5.2 % CTR' },
        sideStats: { pools: '820 views · 31 clicks · 3.8 % CTR', shipping: '640 views · 12 clicks · 1.9 % CTR', announcement: '2,310 views · 44 clicks · 1.9 % CTR' },
        announcementEnabled: true,
        showPlaceholders: false,
        order: ['rfq', 'pool', 'turnkey', 'dropship', '3pl'],
        announcement: '{turnkey} turnkey projects open|See projects|/turnkey',
      };
    case 'media':
      return { tab: 'media', slots: [
        { key: 'home.hero.image', label: 'Home hero', src: '/images/services/3d-3pl-logistics.webp', path: null, alt: '3D illustration of a container ship and warehouse' },
        { key: 'home.dropship.image', label: 'Dropshipping card', src: '/images/services/3d-dropshipping.webp', path: 'site/custom/home-dropship-image-1.webp', alt: '' },
      ] };
    default:
      return { tab: 'terms', versions: SAMPLE_TERMS, settings: { deposit_pct: '30' } };
  }
}

export const SAMPLE_ADS: AdsData = {
  adsOn: true,
  kpis: { revenue: 'US$ 1,284.40', paidClicks: 3212, avgHint: 'avg US$ 0.40 per click', impressions: 182400, ctrHint: 'CTR 1.8%', invalid: 141, active: 6, waiting: 2 },
  slots: [
    { code: 'home_top', name: 'Home · top banner', minCpc: '0.60', clicks: 1420, revenue: 'US$ 742.10', share: 100 },
    { code: 'search_side', name: 'Search · side card', minCpc: '0.25', clicks: 1792, revenue: 'US$ 542.30', share: 73 },
  ],
  slotNote: 'Minimum cost per click (CPC) in USD; campaigns in CNY compare at the approved rate. Revenue in USD.',
  campaigns: [
    { id: id(51), name: 'Winter kitchen deals', headline: 'Up to 30 % off bulk cookware', rejection: null, advertiser: 'Gulf Home Supplies LLC', slot: 'Home · top banner', bid: 'US$ 0.80', budget: 'US$ 40.00/day', today: 'today US$ 12.40', clicks: 512, spent: 'US$ 409.60', status: 'active', statusLabel: 'Live' },
    { id: id(52), name: 'LED panels B2B', headline: 'Factory-direct lighting', rejection: null, advertiser: 'Supplier SZ-0142', slot: 'Search · side card', bid: 'US$ 0.30', budget: 'US$ 15.00/day', today: 'today US$ 0.00', clicks: 0, spent: 'US$ 0.00', status: 'in_review', statusLabel: 'Pending approval' },
    { id: id(53), name: 'Pet beds spring', headline: null, rejection: 'Image shows a competitor logo.', advertiser: 'Petsy Store', slot: 'Home · top banner', bid: 'US$ 0.65', budget: 'US$ 20.00/day', today: 'today US$ 0.00', clicks: 0, spent: 'US$ 0.00', status: 'rejected', statusLabel: 'Rejected' },
  ],
  days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(27 - i).padStart(2, '0')}`, clicks: 180 + ((i * 37) % 90), invalid: (i * 7) % 12, charged: `US$ ${(72 + ((i * 13) % 40)).toFixed(2)}`, share: 60 + ((i * 11) % 40) })),
  chargedHeader: 'Charged (USD)',
  anyClicks: true,
};
export const SAMPLE_ADS_EMPTY: AdsData = { ...SAMPLE_ADS, kpis: { revenue: 'US$ 0.00', paidClicks: 0, impressions: 0, invalid: 0, active: 0, waiting: 0 }, slots: [], campaigns: [], days: [], anyClicks: false };

export const SAMPLE_NOTES: StaffNote[] = [
  { id: id(61), title: 'Second approval needed: payment US$ 3,200.00', body: 'PF-2026-0121 · recorded by Omar K. You can approve or reject it.', link: '/office/approvals', read_at: null, created_at: '2026-11-27T09:30:00Z' },
  { id: id(62), title: 'New brand project assigned to you', body: 'Nordic Living AB · Make My Brand', link: '/office/services', read_at: null, created_at: '2026-11-26T15:10:00Z' },
  { id: id(63), title: 'Credit terms review due', body: null, link: null, read_at: '2026-11-25T13:00:00Z', created_at: '2026-11-25T12:00:00Z' },
];

export const SAMPLE_ME = id(71);
export function sampleCurrency(state: string): CurrencyData {
  const requests: CurrencyData['requests'] =
    state === 'empty'
      ? []
      : [
          { id: id(81), from_currency: 'USD', to_currency: 'CNY', rate: 7.12, wallet_option: 'keep', effective_at: '2026-12-01T00:00:00Z', status: 'pending_approval', impact: null, note: 'Year-end switch for CN customers', requested_by: state === 'pending' ? SAMPLE_ME : id(72), approved_by: null, approved_at: null, applied_at: null, cancelled_at: null, created_at: '2026-11-25T10:00:00Z' },
          { id: id(82), from_currency: 'CNY', to_currency: 'USD', rate: 7.08, wallet_option: 'convert', effective_at: '2026-06-01T00:00:00Z', status: 'applied', impact: null, note: null, requested_by: id(72), approved_by: id(73), approved_at: '2026-05-30T10:00:00Z', applied_at: '2026-06-01T00:00:00Z', cancelled_at: null, created_at: '2026-05-28T10:00:00Z' },
        ];
  return {
    current: 'USD',
    banner: state === 'empty' ? null : { from: 'CNY', to: 'USD', rate: 7.08, applied_at: '2026-06-01T00:00:00Z', wallet_option: 'convert' },
    rates: [
      { id: id(84), rate: 7.15, effective_from: '2026-12-15T00:00:00Z', set_by: id(72), source: 'manual', note: 'December review', created_at: '2026-11-26T10:00:00Z' },
      { id: id(85), rate: 7.1, effective_from: '2026-11-01T00:00:00Z', set_by: id(72), source: 'manual', note: 'Monthly review, bank rate 1 Nov', created_at: '2026-10-31T10:00:00Z' },
      { id: id(86), rate: 7.2391, effective_from: '2026-11-27T06:00:00Z', set_by: null, source: 'reference', note: null, created_at: '2026-11-27T06:00:00Z' },
      { id: id(87), rate: 7.05, effective_from: '2026-10-01T00:00:00Z', set_by: id(73), source: 'manual', note: null, created_at: '2026-09-30T10:00:00Z' },
    ],
    requests,
    names: { [SAMPLE_ME]: 'Priya Shah', [id(72)]: 'Ahmed Rahman', [id(73)]: 'Lina Chen' },
    serviceNames: { sourcing: 'Product sourcing' },
    nowIso: '2026-11-27T12:00:00.000Z',
  };
}
