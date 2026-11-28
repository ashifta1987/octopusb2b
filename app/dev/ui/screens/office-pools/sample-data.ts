/** Staging fixtures (T9 · MOQ pools + Make My Brand): SAMPLE staff data only. Never imported by app/ods/** pages. */
import { poolSettings } from '@/components/store/pools/shared';
import type { BrandRow } from '@/lib/brand-projects';
import { closingSoon48, fillPct, poolDeposits, poolPerms, poolStatus, sumByCurrency, ACTIVE_PLEDGE, POOL_STATUSES, type PoolPerms } from '@/app/ods/admin/pools/_lib/pools-core';
import type { PledgeVM, PoolKpis, PoolRowVM } from '@/app/ods/admin/pools/_lib/pools-data';

export const NOW = Date.parse('2026-11-27T10:00:00Z');
export const SAMPLE_FX = { currency: 'USD' as const, rate: 7.1, rounding: {} };
const h = (n: number) => new Date(NOW + n * 36e5).toISOString();

export const SAMPLE_RULES = poolSettings({ pool_enabled: true, pool_deposit_pct: 30, pool_min_pledge_default: 50, pool_max_buyers: 20, pool_balance_hours: 72, pool_min_days: 3, pool_max_days: 30, pool_default_days: 14 });

type Seed = { code: string; product: string; status: string; target: number; filled: number; price: number; deadline: number; pledges: [string, number, string, string, string][]; balance?: number; po?: boolean; sup: string; unit?: string };
const SEEDS: Seed[] = [
  { code: 'POOL-3112', product: 'Stainless steel water bottle 750 ml', status: 'open', target: 5000, filled: 4100, price: 245, deadline: 30, sup: 'SUP-0142', pledges: [['B-1021', 1500, 'paid', 'wallet', 'Gulf Home Trading LLC'], ['B-1188', 1600, 'paid', 'card', 'Doha Events'], ['B-1204', 1000, 'pending', 'card', 'Lagos Baby Store']] },
  { code: 'POOL-3108', product: 'Bamboo cutting board set', status: 'open', target: 3000, filled: 900, price: 410, deadline: 200, sup: 'SUP-0207', pledges: [['B-1301', 500, 'paid', 'wallet', 'Riyadh Kitchen Co.'], ['B-1302', 400, 'pending', 'card', 'Muscat Fitness']] },
  { code: 'POOL-3099', product: 'LED desk lamp, USB-C', status: 'locked', target: 2000, filled: 2000, price: 690, deadline: -20, balance: 52, sup: 'SUP-0311', po: true, pledges: [['B-1100', 1200, 'paid', 'wallet', 'Nairobi Office Supplies'], ['B-1101', 800, 'paid', 'card', 'Amman Stationers']] },
  { code: 'POOL-3071', product: 'Yoga mat 6 mm TPE', status: 'shipped', target: 1000, filled: 1000, price: 520, deadline: -400, sup: 'SUP-0099', po: true, pledges: [['B-1050', 1000, 'shipped', 'wallet', 'Muscat Fitness']] },
  { code: 'POOL-3040', product: 'Silicone baby bib', status: 'expired', target: 4000, filled: 1200, price: 85, deadline: -900, sup: 'SUP-0420', pledges: [['B-1009', 1200, 'withdrawn', 'wallet', 'Lagos Baby Store']] },
];

/** `suppliersVisible` = sample stand-in for today's RLS (suppliers_staff): the read returns rows only with suppliers:view. */
export function samplePools(perms: PoolPerms, suppliersVisible = true): PoolRowVM[] {
  return SEEDS.map((s, i) => {
    const pledges: PledgeVM[] = s.pledges.map(([code, qty, st, src, company], j) => ({
      id: `00000000-0000-4000-b000-0000000${i}${j}000`.slice(0, 36), qty, status: st, depositMinor: Math.round(qty * s.price * 0.3), balanceMinor: s.status === 'locked' ? Math.round(qty * s.price * 0.7) : null,
      currency: 'USD', paySource: src, joinedAt: h(-200 - j * 10), orderId: s.status === 'locked' || s.status === 'shipped' ? `00000000-0000-4000-c000-00000000${i}${j}00` : null,
      buyerCode: code, company, country: 'AE',
    }));
    const st = poolStatus({ status: s.status, filledQty: s.filled, targetQty: s.target, deadlineAt: h(s.deadline) }, NOW);
    return {
      id: `00000000-0000-4000-a000-00000000300${i}`, code: s.code, statusRaw: s.status, status: st.name, statusDetail: st.detail, currency: 'USD',
      targetQty: s.target, filledQty: s.filled, pct: fillPct(s.filled, s.target), maxBuyers: 20, buyers: pledges.filter((x) => ACTIVE_PLEDGE.includes(x.status)).length,
      deadlineAt: h(s.deadline), balanceDueAt: s.balance ? h(s.balance) : null, createdAt: h(-500), unitPriceMinor: s.price, product: s.product, unit: s.unit ?? 'pcs',
      supplierCode: perms.readSuppliers && suppliersVisible ? s.sup : null, poDocumentId: s.po ? `00000000-0000-4000-d000-00000000300${i}` : null,
      deposits: poolDeposits(pledges.map((x) => ({ status: x.status, qty: x.qty, deposit_minor: x.depositMinor, currency: x.currency }))), pledges,
      closingSoon: closingSoon48(s.status, h(s.deadline), NOW),
    };
  });
}

export function sampleKpis(rows: PoolRowVM[]): PoolKpis {
  const counts: Record<string, number> = Object.fromEntries(POOL_STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => (counts[r.statusRaw] = (counts[r.statusRaw] ?? 0) + 1));
  const held = rows.filter((p) => p.statusRaw === 'open').flatMap((p) => p.pledges.filter((x) => x.status === 'paid'));
  return { open: counts.open, soon: rows.filter((r) => r.closingSoon).length, held: sumByCurrency(held, (x) => x.depositMinor, (x) => x.currency), locked: counts.locked, expired: counts.expired, cancelled: counts.cancelled, counts };
}

export type PoolRole = 'admin' | 'ops' | 'finance';
export const POOL_ROLES: [PoolRole, string][] = [['admin', 'Owner (admin)'], ['ops', 'Operations (orders view/edit/approve)'], ['finance', 'Finance (orders view + wallet approve)']];
const PERMS: Record<PoolRole, string[]> = { admin: [], ops: ['orders:view', 'orders:edit', 'orders:approve', 'suppliers:view'], finance: ['orders:view', 'wallet:approve'] };
/** roles whose session RLS returns suppliers (suppliers:view) */
export const roleSeesSuppliers = (role: PoolRole) => role === 'admin' || PERMS[role].includes('suppliers:view');
export const samplePoolPerms = (role: PoolRole) => poolPerms(role === 'admin', (a, act = 'view') => role === 'admin' || PERMS[role].includes(`${a}:${act}`));

/* ───────── Make My Brand ───────── */

const base: Omit<BrandRow, 'id' | 'ref' | 'status' | 'company' | 'org_id' | 'product_title' | 'manager_name' | 'created_at' | 'paid' | 'closed_from'> = {
  status_changed_at: null, product_id: null, product_slug: 'ceramic-mug-350', product_link: null, quantity: 1000, markets: ['AE', 'SA'], method: 'pad', packaging: 'colour_box',
  colours: 'Navy + white (Pantone 2766 C)', logo_paths: ['org/7b0e2f6a-1c1d-4b8e-9b55-1f2a3b4c5d6e-logo-gulf.png', 'org/8c1f3a7b-2d2e-4c9f-8c66-2a3b4c5d6e7f-logo-mono.pdf'],
  stock_destination: 'warehouse', bulk_country: null, stores: ['Amazon.ae', 'Noon'], note: 'Logo on the front only. Please send a proof before the sample.', manager_id: null,
};
const B = (i: number, ref: string, status: string, company: string, product: string, manager: string | null, hours: number, extra: Partial<BrandRow> = {}): BrandRow => ({
  ...base, id: `00000000-0000-4000-e000-00000000400${i}`, ref, status, company, org_id: `00000000-0000-4000-9000-00000000400${i}`, product_title: product,
  manager_name: manager, created_at: h(-hours), paid: false, closed_from: null, ...extra,
});
export const SAMPLE_BRANDS: BrandRow[] = [
  B(0, 'MB-1042', 'proof', 'Gulf Home Trading LLC', 'Ceramic mug 350 ml', 'Omar Khalid', 60, { status_changed_at: h(-20) }),
  B(1, 'MB-1041', 'submitted', 'Doha Events', 'LED string light 10 m', null, 8, { logo_paths: [] }),
  B(2, 'MB-1039', 'sample', 'Riyadh Kitchen Co.', 'Stainless steel pan 28 cm', 'Sara Haddad', 150, { method: 'laser', packaging: 'gift_box' }),
  B(3, 'MB-1035', 'quoted', 'Muscat Fitness', 'Yoga mat 6 mm TPE', 'Omar Khalid', 300, { stock_destination: 'bulk', bulk_country: 'OM' }),
  B(4, 'MB-1030', 'production', 'Lagos Baby Store', 'Silicone baby bib', 'Sara Haddad', 600, { paid: true }),
  B(5, 'MB-1022', 'stocked', 'Nairobi Office Supplies', 'A4 notebook, hard cover', 'Omar Khalid', 1400, { paid: true }),
  B(6, 'MB-1019', 'closed', 'Amman Stationers', 'Gel pen, blue', null, 1800, { closed_from: 'quoted' }),
];

export const SAMPLE_HISTORY = [
  { at: h(-60), actor: 'Gulf Home Trading LLC', from_status: null, to_status: 'submitted', reason: null },
  { at: h(-20), actor: 'Omar Khalid', from_status: 'submitted', to_status: 'proof', reason: null },
];
