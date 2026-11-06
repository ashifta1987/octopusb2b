import { describe, expect, it } from 'vitest';
import { filterProjects, fromLabel, hubPosition, kUsd, starterPickProblems, validFourTests, waLink, type TurnkeyProject } from '@/lib/turnkey/format';
import { leadSchema } from '@/lib/turnkey/schema';

const P = (o: Partial<TurnkeyProject>): TurnkeyProject => ({
  project_id: 'x', title: 'X', category: 'self-service', short_reason: null, starting_budget_usd: 10000, budget_unit: null, lead_time_days: 60, best_markets: [],
  factory_hub_ids: [], hub_label: null, status: 'register-interest', is_starter_pick: false, starter_rank: null, sort_rank: 1, hero_image_path: null, overview_md: null,
  highlights: [], earn: [], four_tests: {}, seo_title: null, seo_description: null, ...o,
});

describe('turnkey format (ADDON-31)', () => {
  it('formats budgets the way the design does', () => {
    expect(kUsd(38000)).toBe('$38 k');
    expect(kUsd(1100)).toBe('$1.1 k');
    expect(kUsd(800)).toBe('$800');
    expect(fromLabel({ starting_budget_usd: 22000, budget_unit: 'court' })).toBe('From $22 k/court');
    expect(fromLabel({ starting_budget_usd: null, budget_unit: null })).toBeNull();
  });

  it('starter picks: ranks 1–5, unique, at most five', () => {
    const ok = [1, 2, 3, 4, 5].map((r) => P({ project_id: `p${r}`, is_starter_pick: true, starter_rank: r }));
    expect(starterPickProblems(ok)).toEqual([]);
    expect(starterPickProblems([...ok.slice(0, 4), P({ project_id: 'dup', is_starter_pick: true, starter_rank: 1 })])).toContain('Starter ranks must be unique.');
    expect(starterPickProblems([P({ is_starter_pick: true, starter_rank: 6 })])).toContain('Starter ranks must be 1–5.');
    expect(starterPickProblems([P({ is_starter_pick: true, starter_rank: 1, status: 'archived' }), P({ project_id: 'b', is_starter_pick: true, starter_rank: 1 })])).toEqual([]);
  });

  it('four_tests schema', () => {
    expect(validFourTests({ equipment_share: 0.72, ships_in_container: true, simple_revenue: true, non_expert_buyer: true })).toBe(true);
    expect(validFourTests({ equipment_share: null, ships_in_container: true, simple_revenue: false, non_expert_buyer: true })).toBe(true);
    expect(validFourTests({ equipment_share: 1.5, ships_in_container: true, simple_revenue: true, non_expert_buyer: true })).toBe(false);
    expect(validFourTests({ ships_in_container: 'yes' })).toBe(false);
    expect(validFourTests([])).toBe(false);
  });

  it('atlas filter + sort: hub, category, live first by budget, lead time', () => {
    const list = [
      P({ project_id: 'bottling', category: 'small-factory', factory_hub_ids: ['CN-JS-ZJG'], starting_budget_usd: 38000, lead_time_days: 90 }),
      P({ project_id: 'injection', category: 'small-factory', factory_hub_ids: ['CN-ZJ-NB', 'CN-JS-ZJG'], starting_budget_usd: 35000, lead_time_days: 70 }),
      P({ project_id: 'gym', category: 'leisure', status: 'live', starting_budget_usd: 28000, lead_time_days: 60 }),
      P({ project_id: 'old', status: 'archived' }),
    ];
    expect(filterProjects(list, { hub: 'CN-JS-ZJG' }).map((p) => p.project_id)).toEqual(['injection', 'bottling']);
    expect(filterProjects(list, {}).map((p) => p.project_id)).toEqual(['gym', 'injection', 'bottling']);
    expect(filterProjects(list, { category: 'leisure' }).map((p) => p.project_id)).toEqual(['gym']);
    expect(filterProjects(list, { sort: 'lead' }).map((p) => p.project_id)).toEqual(['gym', 'injection', 'bottling']);
  });

  it('hub positions stay inside the map box', () => {
    for (const h of [{ lat: 41.8, lng: 123.43 }, { lat: 22.54, lng: 114.06 }, { lat: 60, lng: 140 }]) {
      const p = hubPosition(h);
      expect(p.left).toBeGreaterThanOrEqual(6); expect(p.left).toBeLessThanOrEqual(94);
      expect(p.top).toBeGreaterThanOrEqual(8); expect(p.top).toBeLessThanOrEqual(90);
    }
  });

  it('WhatsApp link carries the reference', () => {
    expect(waLink('+86 188 2652 7644', 'ref TK-2026-00001')).toBe('https://wa.me/8618826527644?text=ref%20TK-2026-00001');
    expect(waLink(null, 'x')).toBeNull();
  });
});

describe('turnkey lead form schema', () => {
  const base = { kind: 'interest' as const, project_id: 'water-bottling', company_name: 'Acme Water', contact_name: 'Ada', email: 'ada@example.com', country: 'NG' };
  it('accepts a minimal interest', () => { expect(leadSchema.safeParse(base).success).toBe(true); });
  it('accepts the deterministic (md5-based) package ids used by the catalogue', () => {
    expect(leadSchema.safeParse({ ...base, package_id: '757da9cb-2ce4-bc28-4a22-d2f03616967f' }).success).toBe(true);
    expect(leadSchema.safeParse({ ...base, package_id: 'not-a-uuid' }).success).toBe(false);
  });
  it('requires a port / city for CIF / DAP', () => {
    const r = leadSchema.safeParse({ ...base, delivery_term: 'CIF' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['delivery_place']);
    expect(leadSchema.safeParse({ ...base, delivery_term: 'DAP', delivery_place: 'Lagos' }).success).toBe(true);
  });
  it('rejects bad email, country and past dates', () => {
    expect(leadSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, country: 'Nigeria' }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, target_open_date: '2020-01-01' }).success).toBe(false);
  });
});

