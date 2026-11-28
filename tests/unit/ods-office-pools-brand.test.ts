import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ODS_SUPPLIER_STRICT, POOL_TABS, closingSoon48, fillPct, parsePoolQuery, paidQty, pledgeActions, pledgeStatusName, poolActions, poolDeposits, poolPerms, poolQueryHref, poolStatus, sumByCurrency,
} from '@/app/ods/admin/pools/_lib/pools-core';
import { BRAND_TABS, brandCounts, brandSteps, brandTabHref, brandTone, historyTitle, isBrandRecordTab, logoName, parseBrandTab } from '@/app/ods/admin/brand-projects/_lib/brand-core';
import { brandMoves } from '@/lib/brand-projects';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const h = (n: number) => new Date(NOW + n * 36e5).toISOString();

describe('pools · URL state = today', () => {
  it('parses ?status= / ?closing=1 / ?pool= like today', () => {
    expect(parsePoolQuery({})).toEqual({ tab: 'open', pool: null });
    expect(parsePoolQuery({ status: 'locked' }).tab).toBe('locked');
    expect(parsePoolQuery({ status: 'all' }).tab).toBe('all');
    expect(parsePoolQuery({ status: 'nope' }).tab).toBe('open');
    expect(parsePoolQuery({ status: 'locked', closing: '1' }).tab).toBe('closing');
    expect(parsePoolQuery({ pool: 'x' }).pool).toBeNull();
    expect(parsePoolQuery({ pool: '00000000-0000-4000-a000-000000003000' }).pool).toBe('00000000-0000-4000-a000-000000003000');
  });
  it('builds today’s hrefs', () => {
    expect(poolQueryHref('/admin/pools', { tab: 'open', pool: null })).toBe('/admin/pools');
    expect(poolQueryHref('/admin/pools', { tab: 'closing', pool: null })).toBe('/admin/pools?closing=1');
    expect(poolQueryHref('/admin/pools', { tab: 'expired', pool: 'p' })).toBe('/admin/pools?status=expired&pool=p');
    expect(POOL_TABS.find(([t]) => t === 'locked')?.[1]).toBe('Waiting for balances');
  });
});

describe('pools · status names (Appendix C) and figures', () => {
  const st = (status: string, filled: number, target: number, deadlineH: number) => poolStatus({ status, filledQty: filled, targetQty: target, deadlineAt: h(deadlineH) }, NOW);
  it('maps raw pool status to Appendix C pool names, keeping the raw step as detail', () => {
    expect(st('open', 100, 1000, 200)).toEqual({ name: 'Open', detail: null });
    expect(st('open', 100, 1000, 30).name).toBe('Closing soon');
    expect(st('open', 800, 1000, 200).name).toBe('Almost full');
    expect(st('locked', 1000, 1000, -5)).toEqual({ name: 'Filled', detail: 'Waiting for balances' });
    expect(st('shipped', 1000, 1000, -5)).toEqual({ name: 'Filled', detail: 'Shipped' });
    expect(st('expired', 10, 1000, -5)).toEqual({ name: 'Closed (not filled)', detail: 'Expired' });
    expect(st('cancelled', 10, 1000, 50)).toEqual({ name: 'Closed (not filled)', detail: 'Cancelled' });
  });
  it('fill % and today’s 48 h closing rule', () => {
    expect(fillPct(4100, 5000)).toBe(82);
    expect(fillPct(6000, 5000)).toBe(100);
    expect(fillPct(1, 0)).toBe(0);
    expect(closingSoon48('open', h(47), NOW)).toBe(true);
    expect(closingSoon48('open', h(49), NOW)).toBe(false);
    expect(closingSoon48('locked', h(2), NOW)).toBe(false);
  });
  it('deposits held = paid + confirmed pledges, per currency; force-settle quantity = paid', () => {
    const pl = [
      { status: 'paid', qty: 10, deposit_minor: 100, currency: 'USD' },
      { status: 'confirmed', qty: 5, deposit_minor: 50, currency: 'USD' },
      { status: 'pending', qty: 7, deposit_minor: 70, currency: 'USD' },
      { status: 'paid', qty: 3, deposit_minor: 30, currency: 'AED' },
    ];
    expect(poolDeposits(pl)).toEqual([{ currency: 'USD', minor: 150 }, { currency: 'AED', minor: 30 }]);
    expect(paidQty(pl)).toBe(13);
    expect(sumByCurrency([], () => 1, () => 'USD')).toEqual([]);
  });
  it('pledge statuses → Payments words', () => {
    expect(pledgeStatusName('pending')).toBe('Pending');
    expect(pledgeStatusName('shipped')).toBe('Paid');
    expect(pledgeStatusName('withdrawn')).toBe('Refunded');
    expect(pledgeStatusName('defaulted')).toBe('Failed');
  });
});

describe('pools · action visibility = today’s page', () => {
  const as = (perms: string[], admin = false) => poolPerms(admin, (a, act = 'view') => admin || perms.includes(`${a}:${act}`));
  it('admin: extend + force-settle + cancel on open pools', () => {
    expect(poolActions('open', as([], true))).toEqual({ extend: true, forceSettle: true, cancel: true });
    expect(poolActions('locked', as([], true))).toEqual({ extend: false, forceSettle: false, cancel: true });
    expect(poolActions('shipped', as([], true))).toEqual({ extend: false, forceSettle: false, cancel: false });
  });
  it('orders:approve (not admin): extend + cancel, never force-settle', () => {
    expect(poolActions('open', as(['orders:approve']))).toEqual({ extend: true, forceSettle: false, cancel: true });
  });
  it('orders:view only: no pool actions', () => {
    expect(poolActions('open', as(['orders:view']))).toEqual({ extend: false, forceSettle: false, cancel: false });
  });
  it('confirm deposit = wallet:approve + pending + open pool; mark defaulted = orders:edit + paid + order + locked', () => {
    const fin = as(['wallet:approve']);
    expect(pledgeActions({ status: 'pending', order_id: null }, 'open', fin).confirmDeposit).toBe(true);
    expect(pledgeActions({ status: 'pending', order_id: null }, 'locked', fin).confirmDeposit).toBe(false);
    expect(pledgeActions({ status: 'pending', order_id: null }, 'open', as(['orders:edit'])).confirmDeposit).toBe(false);
    const ed = as(['orders:edit']);
    expect(pledgeActions({ status: 'paid', order_id: 'o' }, 'locked', ed).markDefaulted).toBe(true);
    expect(pledgeActions({ status: 'paid', order_id: null }, 'locked', ed).markDefaulted).toBe(false);
    expect(pledgeActions({ status: 'paid', order_id: 'o' }, 'open', ed).markDefaulted).toBe(false);
  });
  it('supplier read = today (RLS decides) while ODS_SUPPLIER_STRICT is false', () => {
    expect(ODS_SUPPLIER_STRICT).toBe(false);
    expect(as(['orders:view']).readSuppliers).toBe(true);
    expect(as(['orders:view', 'suppliers:view']).readSuppliers).toBe(true);
  });
});

describe('brand projects', () => {
  it('tabs = today’s ?status= (steps + closed), unknown → all', () => {
    expect(BRAND_TABS.map(([t]) => t)).toEqual(['all', 'submitted', 'proof', 'sample', 'quoted', 'production', 'stocked', 'closed']);
    expect(parseBrandTab({ status: 'proof' })).toBe('proof');
    expect(parseBrandTab({ status: 'x' })).toBe('all');
    expect(brandTabHref('/admin/brand-projects', 'all')).toBe('/admin/brand-projects');
    expect(brandTabHref('/admin/brand-projects', 'closed')).toBe('/admin/brand-projects?status=closed');
  });
  it('counts and tones', () => {
    expect(brandCounts([{ status: 'proof' }, { status: 'proof' }, { status: 'closed' }])).toMatchObject({ all: 3, proof: 2, closed: 1, submitted: 0 });
    expect(brandTone('stocked')).toBe('success');
    expect(brandTone('proof')).toBe('warning');
    expect(brandTone('closed')).toBe('neutral');
    expect(brandTone('submitted')).toBe('info');
  });
  it('stepper over today’s 6 steps', () => {
    const s = (st: string, from: string | null = null) => brandSteps(st, from).map((x) => x.status);
    expect(brandSteps('proof', null).map((x) => x.label)).toEqual(['Submitted', 'Proof', 'Sample', 'Quoted', 'In production', 'Stocked']);
    expect(s('submitted')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(s('quoted')).toEqual(['done', 'done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(s('stocked')).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(s('closed', 'sample')).toEqual(['done', 'done', 'error', 'upcoming', 'upcoming', 'upcoming']);
  });
  it('moves come from today’s brandMoves (paid close = admin only; closed → admin reopen)', () => {
    expect(brandMoves({ status: 'production', closed_from: null, paid: true }, false).find((m) => m.to === 'closed')?.disabled).toMatch(/only an admin/);
    expect(brandMoves({ status: 'closed', closed_from: 'quoted', paid: false }, false)).toEqual([]);
    expect(brandMoves({ status: 'closed', closed_from: 'quoted', paid: false }, true)[0]).toMatchObject({ to: 'quoted', reopen: true });
  });
  it('helpers', () => {
    expect(logoName('org/7b0e2f6a-1c1d-4b8e-9b55-1f2a3b4c5d6e-logo.png')).toBe('logo.png');
    expect(historyTitle({ from_status: null, to_status: 'submitted' })).toBe('Submitted by the customer');
    expect(historyTitle({ from_status: 'submitted', to_status: 'proof' })).toBe('Submitted → Proof');
    expect(isBrandRecordTab('logos')).toBe(true);
    expect(isBrandRecordTab('files')).toBe(false);
  });
});

describe('static guards', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  it('pages are ODS T9 screens behind today’s guards', () => {
    expect(read('app/ods/admin/pools/page.tsx').startsWith('// ODS T9')).toBe(true);
    expect(read('app/ods/admin/pools/page.tsx')).toContain("requireStaff('orders', 'view'");
    for (const p of ['app/ods/admin/brand-projects/page.tsx', 'app/ods/admin/brand-projects/[id]/page.tsx']) {
      expect(read(p).startsWith('// ODS T9')).toBe(true);
      expect(read(p)).toMatch(/requireStaffOrManager\((BRAND_PATH|'\/admin\/brand-projects'), \['customers', 'view'\]\)/);
    }
  });
  it('actions are today’s, and the ODS files add no write of their own', () => {
    expect(read('app/ods/admin/pools/_components/pools-screen.tsx')).toContain("from '@/app/admin/pools/actions'");
    expect(read('app/ods/admin/brand-projects/[id]/page.tsx')).toContain("import { BrandStatusControls } from '@/app/admin/brand-projects/status-controls'");
    for (const p of ['app/ods/admin/pools/_lib/pools-data.ts', 'app/ods/admin/pools/page.tsx', 'app/ods/admin/brand-projects/page.tsx', 'app/ods/admin/brand-projects/[id]/page.tsx']) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      for (const m of src.matchAll(/\.rpc\('([a-z_]+)'/g)) expect(['admin_brand_projects', 'brand_project_history'], p).toContain(m[1]);
    }
  });
  it('supplier codes: today’s session read (RLS), "—" when empty; deposits use today’s CurrencyTotals', () => {
    expect(read('app/ods/admin/pools/_lib/pools-data.ts')).toContain("perms.readSuppliers ? sb.from('suppliers')");
    const scr = read('app/ods/admin/pools/_components/pools-screen.tsx');
    expect(scr).toContain("{r.supplierCode ?? '—'}");
    expect(scr).toContain("from '@/components/admin/currency'");
  });
});
