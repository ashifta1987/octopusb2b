import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODERATION_TABS, REVIEW_DECISIONS, REVIEW_TABS, SUPPLIER_SWITCHES, TAG_KINDS,
  archiveConfirmText, catTree, decisionsFor, draftCount, firstOfMonth, hsSourceLabel, hsTypePill, hsUsage, isReviewTab, matchesModerationTab, mergeTargets,
  moderationActions, moderationIssues, productPill, productStatusPill, runActions, runCounts, supplierMatches, supplierProductCounts, switchOn, tierRanges, usd4,
  validHeading, validateImportUpload, validateSupplier, type CatRow,
} from '@/app/ods/admin/_catalogue/core';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('ODS T9 catalogue · product moderation', () => {
  it('pills, tabs, actions = today', () => {
    expect(productPill('submitted', true).label).toBe('On hold');
    expect(productPill('in_review').label).toBe('In review');
    expect(MODERATION_TABS.map(([t]) => t)).toEqual(['all', 'submitted', 'in_review', 'hold']);
    expect(matchesModerationTab({ status: 'submitted', moderation_hold: true }, 'hold') && !matchesModerationTab({ status: 'submitted', moderation_hold: true }, 'submitted')).toBe(true);
    expect(moderationActions({ status: 'submitted', moderation_hold: false })).toEqual({ startReview: true, approve: true, reject: true });
    expect(moderationActions({ status: 'in_review', moderation_hold: true })).toEqual({ startReview: false, approve: false, reject: true });
  });
  it('Check list wording and thresholds = today', () => {
    expect(moderationIssues({ description: 'x'.repeat(80), tiers: 1, photos: 1, hasImageUrl: false, hs_code: '6302', hs_code_status: 'confirmed', category: 'A' })).toEqual([]);
    expect(moderationIssues({ description: 'short', tiers: 0, photos: 0, hasImageUrl: false, hs_code: null, hs_code_status: null, category: null })).toEqual([
      'Description is short (under 80 characters)', 'No price tiers', 'No photos', 'Missing HS code', 'No category',
    ]);
    expect(moderationIssues({ description: 'x'.repeat(90), tiers: 1, photos: 0, hasImageUrl: true, hs_code: '6302', hs_code_status: 'suggested', category: 'A' })).toEqual(['HS code 6302 is a suggestion — check it (does not block approval)']);
  });
  it('tier ranges', () => {
    expect(tierRanges([{ min_qty: 5000 }, { min_qty: 1000 }], 'pcs')).toEqual(['1,000–4,999 pcs', '5,000+ pcs']);
  });
  it('drafts needing a quote / in development say so (productStatusView)', () => {
    expect(productStatusPill('draft', 'needs_quote').label).toBe('Needs quote');
    expect(productStatusPill('draft', 'in_development').label).toBe('In development');
    expect(productStatusPill('live', null).label).toBe('Live');
  });
});

describe('ODS T9 catalogue · suppliers', () => {
  it('switches and counts = today', () => {
    expect(SUPPLIER_SWITCHES.map((s) => s.key)).toEqual(['portal_login', 'product_upload', 'rfq_replies', 'listings_live', 'ai_tools']);
    expect(switchOn({}, 'listings_live') && !switchOn({ listings_live: false }, 'listings_live') && switchOn(null, 'ai_tools')).toBe(true);
    const c = supplierProductCounts([{ supplier_id: 'a', status: 'live' }, { supplier_id: 'a', status: 'archived' }, { supplier_id: 'a', status: 'in_review' }, { supplier_id: 'a', status: 'submitted' }, { supplier_id: 'b', status: 'draft' }]);
    expect(c.get('a')).toEqual({ live: 1, total: 3, review: 2 });
    expect(c.get('b')).toEqual({ live: 0, total: 1, review: 0 });
  });
  it('search, archive text and form checks = today', () => {
    expect(supplierMatches({ code: 'SUP-1', legal_name: 'Acme', country: 'CN', city: 'Ningbo' }, 'ningbo')).toBe(true);
    expect(archiveConfirmText('SUP-1', false, { live: 2, total: 5, review: 1 })).toBe('Archive SUP-1? All 5 of its products will be archived too — 2 live, 1 in moderation, 2 other. They disappear from the storefront, the moderation queue and the distributor portal. You can restore the supplier later.');
    expect(archiveConfirmText('SUP-1', false)).toBe('Archive SUP-1? It has no active products.');
    expect(archiveConfirmText('SUP-1', true)).toMatch(/^Restore this supplier\?/);
    expect(validateSupplier({ legal_name: 'A', country: 'CN', contact_email: '' })).toMatch(/Legal name/);
    expect(validateSupplier({ legal_name: 'Acme', country: '', contact_email: '' })).toMatch(/country/);
    expect(validateSupplier({ legal_name: 'Acme', country: 'CN', contact_email: 'bad' })).toMatch(/email/);
    expect(validateSupplier({ legal_name: 'Acme', country: 'CN', contact_email: '' })).toBeNull();
  });
});

describe('ODS T9 catalogue · bulk import', () => {
  it('run counts: committed → report, otherwise diff', () => {
    expect(runCounts({ status: 'committed', diff: { products: { create: 9 } }, report: { products: { create: 2, update: 1 }, review: { create: 4 } } })).toMatchObject({ products: { create: 2, update: 1 }, review: 4 });
    expect(runCounts({ status: 'previewed', diff: { products: { create: 9 }, review: { total: 3 } }, report: null })).toMatchObject({ products: { create: 9, update: 0 }, review: 3 });
  });
  it('commit / discard / submit availability = today', () => {
    expect(runActions({ status: 'previewed', errors: 0, canEdit: true, drafts: 0 })).toEqual({ commit: true, discard: true, submit: false });
    expect(runActions({ status: 'previewed', errors: 2, canEdit: true, drafts: 0 })).toEqual({ commit: false, discard: true, submit: false });
    expect(runActions({ status: 'committed', errors: 0, canEdit: true, drafts: 3 })).toEqual({ commit: false, discard: false, submit: true });
    expect(runActions({ status: 'previewed', errors: 0, canEdit: false, drafts: 0 })).toEqual({ commit: false, discard: false, submit: false });
  });
  it('drafts count, money format, upload checks', () => {
    const st = new Map([['a', 'draft'], ['b', 'rejected'], ['c', 'draft'], ['d', 'submitted']]);
    const li = new Map<string, string | null>([['a', null], ['b', null], ['c', 'needs_quote'], ['d', null]]);
    expect(draftCount(st, li)).toBe(2);
    expect(usd4(15800)).toBe('US$ 1.58');
    expect(usd4(12345)).toBe('US$ 1.2345');
    expect(validateImportUpload({ name: 'x', validFrom: '2026-11-01', xlsx: null })).toMatch(/workbook/);
    expect(validateImportUpload({ name: 'ab', validFrom: '2026-11-01', xlsx: { size: 1 } })).toMatch(/name/);
    expect(validateImportUpload({ name: 'abc', validFrom: '', xlsx: { size: 1 } })).toMatch(/valid from/);
    expect(validateImportUpload({ name: 'abc', validFrom: '2026-11-01', xlsx: { size: 1 } })).toBeNull();
    expect(firstOfMonth(Date.parse('2026-11-27T10:00:00Z'))).toBe('2026-11-01');
  });
  it('review tabs and decisions = today (Hold only on open)', () => {
    expect(REVIEW_TABS).toEqual({ open: ['open'], held: ['held'], done: ['accepted_quote', 'accepted_dashboard', 'resolved'] });
    expect(isReviewTab('done') && !isReviewTab('x')).toBe(true);
    expect(decisionsFor('open').map((d) => d.status)).toEqual(['accepted_quote', 'accepted_dashboard', 'resolved', 'held']);
    expect(decisionsFor('held').map((d) => d.status)).toEqual(['accepted_quote', 'accepted_dashboard', 'resolved']);
    expect(decisionsFor('resolved')).toEqual([]);
    expect(REVIEW_DECISIONS[0].prompt).toBe('Accept the supplier QUOTE figures. Optional note:');
  });
});

describe('ODS T9 catalogue · HS codes', () => {
  it('status, source, usage and heading check = today', () => {
    expect(hsTypePill({ confirmed: true, heading: '6302' }).label).toBe('Confirmed');
    expect(hsTypePill({ confirmed: false, heading: '6302' }).label).toBe('Suggested');
    expect(hsTypePill({ confirmed: false, heading: null }).label).toBe('Needs heading');
    expect(hsSourceLabel({ source: 'ai', confidence: 0.857 })).toBe('AI · 86%');
    expect(hsSourceLabel({ source: 'seed', confidence: null })).toBe('Starter rule');
    expect(hsSourceLabel({ source: 'x', confidence: null })).toBe('Manual');
    const u = hsUsage([{ hs_product_type_id: 't', hs_code_status: 'suggested' }, { hs_product_type_id: 't', hs_code_status: 'confirmed' }, { hs_product_type_id: null, hs_code_status: 'missing' }]);
    expect(u.use.get('t')).toEqual({ total: 2, suggested: 1 });
    expect([u.confirmed, u.suggested, u.missing]).toEqual([1, 1, 1]);
    expect(validHeading('8414') && !validHeading('841') && !validHeading('84a4')).toBe(true);
  });
});

describe('ODS T9 catalogue · categories & tags', () => {
  const cats: CatRow[] = [
    { id: 'a', name: 'A', slug: 'a', parent_id: null, level: 1, hs_code: null, sort: 1, active: true, products: 1 },
    { id: 'b', name: 'B', slug: 'b', parent_id: 'a', level: 2, hs_code: null, sort: 2, active: true, products: 2 },
    { id: 'c', name: 'C', slug: 'c', parent_id: 'b', level: 3, hs_code: null, sort: 1, active: true, products: 3 },
    { id: 'd', name: 'D', slug: 'd', parent_id: null, level: 1, hs_code: null, sort: 2, active: false, products: 4 },
    { id: 'e', name: 'E', slug: 'e', parent_id: null, level: 1, hs_code: null, sort: 3, active: true, products: 0 },
  ];
  it('rolled-up totals, path and merge targets = today', () => {
    const t = catTree(cats);
    expect(t.totals.get('a')).toBe(6);
    expect(t.pathOf('c').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(mergeTargets(cats, 'b', t.pathOf).map((x) => x.id)).toEqual(['a', 'e']);
    expect([...TAG_KINDS]).toEqual(['general', 'feature', 'badge', 'use_case', 'service', 'certification']);
  });
});

describe('ODS T9 catalogue · pages replace the T8 re-exports with today’s guards and actions', () => {
  const cases: [string, RegExp][] = [
    ['app/ods/office/products/page.tsx', /requireStaff\('products', 'approve', '\/office\/products'\)/],
    ['app/ods/admin/suppliers/page.tsx', /requireStaff\('suppliers', 'view', '\/admin\/suppliers'\)/],
    ['app/ods/admin/import/page.tsx', /requireStaff\('products', 'edit', '\/admin\/import'\)/],
    ['app/ods/admin/import/[id]/page.tsx', /requireStaff\('products', 'edit', `\/admin\/import\/\$\{id\}`\)/],
    ['app/ods/admin/import/review/page.tsx', /requireStaff\('products', 'view', '\/admin\/import\/review'\)/],
    ['app/ods/admin/import/[id]/review/page.tsx', /redirect\(`\/admin\/import\/review\?run=\$\{encodeURIComponent\(id\)\}`\)/],
    ['app/ods/admin/hs-codes/page.tsx', /requireStaff\('products', 'approve', '\/admin\/hs-codes'\)/],
    ['app/ods/admin/catalog/page.tsx', /requireStaff\('catalog', 'view', '\/admin\/catalog'\)/],
  ];
  it.each(cases)('%s', (file, guard) => {
    const src = read(file);
    expect(src.startsWith('// ODS T9')).toBe(true);
    expect(src).toMatch(guard);
  });
  it('today’s actions are passed unchanged', () => {
    expect(read('app/ods/office/products/page.tsx')).toMatch(/moderate: moderateProduct/);
    expect(read('app/ods/admin/suppliers/page.tsx')).toMatch(/create: createSupplier, update: updateSupplier, setSwitch, setArchived, remove: deleteSupplier, setCanonical: setCanonicalName/);
    expect(read('app/ods/admin/import/[id]/page.tsx')).toMatch(/commit: commitImportRun, discard: discardImportRun, submit: submitImportRun/);
    expect(read('app/ods/admin/import/review/page.tsx')).toMatch(/decide: decideReview, setPricing: setProductPricing/);
    expect(read('app/ods/admin/hs-codes/page.tsx')).toMatch(/confirm: confirmHsType, change: changeHsHeading, preview: previewHsChangeAction, backfillPreview: runBackfillPreview, backfillApply: applyBackfill/);
    expect(read('app/ods/admin/import/_components/import-list-live.tsx')).toMatch(/createUploads: createImportUploads,\s*stage: stageImportRun/);
    expect(read('app/ods/admin/import/_components/import-list-live.tsx')).toMatch(/storage\.from\('imports'\)\.uploadToSignedUrl\(path, token, file/);
  });
  it('supplier visibility stays with today’s reads (no new supplier filter or gate)', () => {
    expect(read('app/ods/office/products/page.tsx')).toMatch(/suppliers!products_supplier_id_fkey\(code, country\)/);
    expect(read('app/ods/admin/suppliers/page.tsx')).toMatch(/withHiddenColumns<\{ id: string; status: string \}, \{ supplier_id: string \}>\('products', countRows, 'supplier_id'\)/);
    expect(read('app/ods/admin/suppliers/page.tsx')).toMatch(/s\.isAdmin \? sb\.rpc\('supplier_delete_preview'/);
  });
  it('the only new server action is today’s HS preview read', () => {
    const a = read('app/ods/admin/hs-codes/actions.ts');
    expect(a).toMatch(/rpc\('hs_type_change_preview', \{ p_type: typeId, p_heading: heading \}\)/);
    expect(a).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(read('app/admin/hs-codes/page.tsx')).toMatch(/rpc\('hs_type_change_preview', \{ p_type: typeId, p_heading: h \}\)/);
  });
});
