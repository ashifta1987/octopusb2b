/**
 * Staging fixtures (T9 · Sourcing requests): SAMPLE staff data only. Never imported by app/ods/** pages.
 */
import { initials, lineSummary, linesForRecord, quoteSummary, rfqPerms, rfqStatusName, supplierCell, tabCounts, type RfqPerms } from '@/app/ods/office/rfqs/_lib/rfq-core';
import type { QuoteRowVM, RfqKpis, RfqRecordVM, RfqRowVM, SupplierOption, ThreadVM } from '@/app/ods/office/rfqs/_lib/rfq-data';

export const NOW = Date.parse('2026-11-27T10:00:00Z');
const ago = (h: number) => new Date(NOW - h * 36e5).toISOString();

type Seed = { code: string; customer: string; city: string; country: string; status: string; h: number; lines: string[]; qty: number; unit?: string; quotes: string[]; owner?: string; target?: number };
const SEEDS: Seed[] = [
  { code: 'RFQ-1048', customer: 'Gulf Home Trading LLC', city: 'Dubai', country: 'UAE', status: 'submitted', h: 3, lines: ['Ceramic mug 350 ml, matte', 'Bamboo coaster set (4)', 'Gift box, kraft'], qty: 2000, quotes: [], target: 120 },
  { code: 'RFQ-1047', customer: 'Nairobi Office Supplies', city: 'Nairobi', country: 'Kenya', status: 'assigned', h: 30, lines: ['A4 copy paper 80 gsm'], qty: 500, unit: 'reams', quotes: [], owner: 'Omar Khalid' },
  { code: 'RFQ-1045', customer: 'Riyadh Kitchen Co.', city: 'Riyadh', country: 'Saudi Arabia', status: 'quoting', h: 70, lines: ['Stainless steel pan 28 cm', 'Glass lid 28 cm'], qty: 800, quotes: [], owner: 'Omar Khalid', target: 640 },
  { code: 'RFQ-1043', customer: 'Lagos Baby Store', city: 'Lagos', country: 'Nigeria', status: 'quoted', h: 96, lines: ['Silicone baby bib'], qty: 3000, quotes: ['sent', 'viewed'], owner: 'Sara Haddad', target: 85 },
  { code: 'RFQ-1041', customer: 'Doha Events', city: 'Doha', country: 'Qatar', status: 'quoted', h: 140, lines: ['LED string light 10 m', 'Battery box', 'Remote control', 'Storage reel'], qty: 1200, quotes: ['sent'], owner: 'Sara Haddad' },
  { code: 'RFQ-1038', customer: 'Muscat Fitness', city: 'Muscat', country: 'Oman', status: 'accepted', h: 300, lines: ['Yoga mat 6 mm TPE'], qty: 600, quotes: ['approved', 'rejected'], owner: 'Omar Khalid', target: 410 },
  { code: 'RFQ-1031', customer: 'Kampala Hardware', city: 'Kampala', country: 'Uganda', status: 'expired', h: 900, lines: ['Cordless drill 18 V'], qty: 150, quotes: ['expired'] },
  { code: 'RFQ-1029', customer: 'Amman Stationers', city: 'Amman', country: 'Jordan', status: 'cancelled', h: 1100, lines: ['Gel pen, blue (box of 12)'], qty: 1000, unit: 'boxes', quotes: [] },
];

export const SAMPLE_ROWS: RfqRowVM[] = SEEDS.map((s, i) => {
  const lines = s.lines.map((t, n) => ({ line_no: n + 1, title: t, quantity: s.qty, unit: s.unit ?? 'pcs' }));
  const q = quoteSummary(s.quotes);
  const h = s.h;
  return {
    id: `00000000-0000-4000-8000-0000000010${String(i).padStart(2, '0')}`,
    code: s.code,
    title: s.lines[0],
    customer: { id: `00000000-0000-4000-9000-0000000000${String(i).padStart(2, '0')}`, name: s.customer, place: `${s.city}, ${s.country}` },
    products: lineSummary(lines, { title: s.lines[0] }),
    service: 'Sourcing',
    statusRaw: s.status,
    status: rfqStatusName(s.status),
    owner: s.owner ? { name: s.owner, initials: initials(s.owner) } : null,
    createdAt: ago(h),
    age: { text: h < 48 ? `${h} h` : `${Math.round(h / 24)} d`, late: h > 48 && s.quotes.length === 0 && s.status !== 'accepted' },
    quotes: { count: s.quotes.length, ...q },
    quantity: s.qty,
    unit: s.unit ?? 'pcs',
    targetMinor: s.target ?? null,
    currency: 'USD',
    href: `/dev/ui/screens/office-rfq?rfq=${s.code}`,
  };
});

export const SAMPLE_KPIS: RfqKpis = {
  counts: tabCounts({ submitted: 1, assigned: 1, quoting: 1, quoted: 2, accepted: 1, expired: 1, cancelled: 1 }),
  late48: 1,
};

/* ───────── record ───────── */

export type FixtureRole = 'sales' | 'admin' | 'no-supplier-perm';
export const FIXTURE_ROLES: [FixtureRole, string][] = [
  ['sales', 'Sourcing agent (suppliers:view)'],
  ['admin', 'Owner (admin)'],
  ['no-supplier-perm', 'Staff without suppliers:view'],
];

const PERMS: Record<FixtureRole, string[]> = {
  // sourcing_agent seed role: requests {view,create,edit}, suppliers {view}
  sales: ['requests:view', 'requests:create', 'requests:edit', 'suppliers:view', 'products:view'],
  admin: [],
  // e.g. a support / customer-success member who can quote but has no supplier access
  'no-supplier-perm': ['requests:view', 'requests:create', 'customers:view'],
};
export function samplePerms(role: FixtureRole): RfqPerms {
  const set = new Set(PERMS[role]);
  return rfqPerms((a, act = 'view') => role === 'admin' || set.has(`${a}:${act}`));
}

export function sampleRecord(status = 'quoted', single = false): RfqRecordVM {
  const lineRows = single
    ? null
    : [
        { line_no: 1, title: 'Ceramic mug 350 ml, matte', quantity: 2000, unit: 'pcs', target_price_minor: 120, customisation: ['logo_print', 'colour'], notes: 'Pantone 7462 C, logo on one side', product_id: null },
        { line_no: 2, title: 'Bamboo coaster set (4)', quantity: 2000, unit: 'sets', target_price_minor: 95, customisation: ['engraving'], notes: null, product_id: null },
        { line_no: 3, title: 'Gift box, kraft', quantity: 2000, unit: 'pcs', target_price_minor: null, customisation: [], notes: 'Fits 1 mug + 1 coaster set', product_id: null },
      ];
  const base = { title: 'Ceramic mug 350 ml, matte', quantity: 2000, unit: 'pcs', target_price_cents: 120, product_id: null };
  return {
    id: '00000000-0000-4000-8000-000000001000',
    code: 'RFQ-1048',
    title: 'Ceramic mug 350 ml, matte',
    details: 'Matte glaze, dishwasher safe. Logo print on one side. Packed 36 per carton with dividers.',
    statusRaw: status,
    status: rfqStatusName(status),
    createdAt: ago(76),
    expiresAt: status === 'expired' ? ago(4) : new Date(NOW + 9 * 864e5).toISOString(),
    quantity: 2000,
    unit: 'pcs',
    targetMinor: 120,
    currency: 'USD',
    incoterm: 'FOB',
    shipTo: 'Dubai, AE',
    category: 'Kitchen & dining',
    customer: { id: '00000000-0000-4000-9000-000000000000', name: 'Gulf Home Trading LLC', place: 'Dubai, United Arab Emirates', kyc: 'verified' },
    owner: 'Omar Khalid',
    product: { title: 'Ceramic mug 350 ml', slug: 'ceramic-mug-350', specs: [{ name: 'Material', value: 'Stoneware' }, { name: 'Capacity', value: '350 ml' }] },
    lines: linesForRecord(lineRows, base),
    order: status === 'accepted' ? { id: '00000000-0000-4000-8000-00000000a001', code: 'ORD-2231', status: 'deposit_pending' } : null,
  };
}

const SUPPLIER_ROWS = [
  { code: 'SUP-0142', legal_name: 'Chaozhou Ceramics Co., Ltd', country: 'CN' },
  { code: 'SUP-0207', legal_name: 'Dehua Homeware Factory', country: 'CN' },
];

export function sampleQuotes(perms: RfqPerms, status = 'quoted'): QuoteRowVM[] {
  if (status === 'submitted' || status === 'assigned') return [];
  const raw = status === 'accepted' ? ['approved', 'rejected'] : status === 'expired' ? ['expired', 'expired'] : ['sent', 'viewed'];
  return raw.map((st, i) => {
    const unit = i === 0 ? 112 : 118;
    const ship = i === 0 ? 38000 : 29500;
    return {
      id: `q-${i}`,
      code: `QT-55${10 + i}`,
      supplier: supplierCell(perms, SUPPLIER_ROWS[i]),
      unitMinor: unit,
      quantity: 2000,
      shippingMinor: ship,
      totalMinor: unit * 2000 + ship,
      leadDays: i === 0 ? 25 : 30,
      incoterm: 'FOB',
      validUntil: new Date(NOW + (10 - i * 3) * 864e5).toISOString(),
      statusRaw: st,
      createdAt: ago(40 - i * 12),
      currency: 'USD',
      notes: null,
    };
  });
}

export const SAMPLE_SUPPLIER_OPTIONS: SupplierOption[] = [
  { id: '00000000-0000-4000-a000-000000000142', label: 'SUP-0142 · Chaozhou Ceramics Co., Ltd · CN' },
  { id: '00000000-0000-4000-a000-000000000207', label: 'SUP-0207 · Dehua Homeware Factory · CN' },
  { id: '00000000-0000-4000-a000-000000000311', label: 'SUP-0311 · Jingdezhen Porcelain · CN (RFQ replies off)', disabled: true },
];

export const SAMPLE_THREAD: ThreadVM = {
  messages: [
    { id: 'm1', fromStaff: false, body: 'Can the logo be printed in two colours? We also need a sample before the order.', at: ago(60) },
    { id: 'm2', fromStaff: true, body: 'Yes — two-colour print is possible. A sample costs US$ 35 incl. courier; we will add it to the quote.', at: ago(52) },
  ],
  files: [
    { id: 'f1', name: 'logo-gulf-home.pdf', kind: 'spec', fromStaff: false },
    { id: 'f2', name: 'mug-reference.jpg', kind: 'photo', fromStaff: false },
  ],
};
