import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adsOn, bannerStat, campaignActions, clicksPerDay, contentTab, featureOrder, last14Days, notificationFilter, pageIntents, pct, rateStatus, rateSummary,
  sectionNo, seenStamp, switchActions, termsSection, termsVars, termsView, unreadCount, HOME_FEATURES, type FxRow, type TermsVersion,
} from '@/app/ods/admin/_website/website-core';

const T = (id: string, status: string, created = '2026-01-01'): TermsVersion => ({ id, version: id, status, sections: [{ no: 1, title: 'Intro', body: 'Pay {{deposit_pct}} % now, {{ balance_days }} days later, {{deposit_pct}} again.' }], publish_at: null, published_at: null, created_at: created });

describe('Site content rules (same as today)', () => {
  it('tab and section parsing', () => {
    expect(contentTab('media')).toBe('media');
    expect(contentTab('nope')).toBe('terms');
    expect(contentTab(undefined)).toBe('terms');
    expect(sectionNo('0')).toBe(1);
    expect(sectionNo('99')).toBe(15);
    expect(sectionNo('4')).toBe(4);
  });
  it('terms version on screen: viewed → working draft → scheduled → live; only drafts / in review are editable', () => {
    const vs = [T('d', 'draft'), T('s', 'scheduled'), T('l', 'published')];
    expect(termsView(vs).current?.id).toBe('d');
    expect(termsView(vs).canEditCurrent).toBe(true);
    expect(termsView(vs, 'l')).toMatchObject({ current: { id: 'l' }, canEditCurrent: false });
    expect(termsView([T('s', 'scheduled'), T('l', 'published')]).current?.id).toBe('s');
    expect(termsView([T('l', 'published')]).current?.id).toBe('l');
    expect(termsView([]).current).toBeNull();
    expect(termsView([T('r', 'in_review')]).canEditCurrent).toBe(true);
  });
  it('section fallback and {{setting}} variables', () => {
    expect(termsSection(T('d', 'draft'), 5)).toEqual({ no: 5, title: 'Section 5', body: '' });
    expect(termsVars(T('d', 'draft').sections[0].body)).toEqual(['deposit_pct', 'balance_days']);
  });
  it('page editor buttons: live legal page by a non-admin → proposal only; legal pages publish by Admin only', () => {
    expect(pageIntents({ is_legal: true, status: 'published' }, false)).toEqual(['proposal']);
    expect(pageIntents({ is_legal: true, status: 'scheduled' }, false)).toEqual(['proposal']);
    expect(pageIntents({ is_legal: true, status: 'draft' }, false)).toEqual(['draft', 'review']);
    expect(pageIntents({ is_legal: true, status: 'published' }, true)).toEqual(['draft', 'review', 'publish']);
    expect(pageIntents({ is_legal: false, status: 'published' }, false)).toEqual(['draft', 'review', 'publish']);
  });
  it('home: feature card order default and banner CTR line', () => {
    expect(featureOrder(['qc', 'rfq'])).toEqual(['qc', 'rfq']);
    expect(featureOrder(null)).toEqual(HOME_FEATURES.map(([k]) => k));
    const ev = [
      { banner_id: 'a', slot: 'lead', event: 'impression' },
      { banner_id: 'a', slot: 'lead', event: 'impression' },
      { banner_id: 'a', slot: 'lead', event: 'click' },
      { banner_id: 'b', slot: 'lead', event: 'impression' },
    ];
    expect(bannerStat(ev, (e) => e.banner_id === 'a')).toBe('2 views · 1 clicks · 50.0 % CTR');
    expect(bannerStat(ev, (e) => e.banner_id === 'z')).toBe('0 views · 0 clicks');
  });
});

describe('Advertising rules', () => {
  it('ads switch value and moderation buttons per status', () => {
    expect(adsOn(true)).toBe(true);
    expect(adsOn('true')).toBe(true);
    expect(adsOn(false)).toBe(false);
    expect(adsOn(null)).toBe(false);
    expect(campaignActions('in_review')).toEqual(['approve', 'reject']);
    expect(campaignActions('active')).toEqual(['pause', 'end']);
    expect(campaignActions('paused')).toEqual(['resume', 'end']);
    expect(campaignActions('ended')).toEqual([]);
    expect(campaignActions('rejected')).toEqual([]);
  });
  it('clicks per day: last 14 UTC days, paid vs invalid, converted charge', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    const days = last14Days(now);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe('2026-11-14');
    expect(days[13]).toBe('2026-11-27');
    const per = clicksPerDay(
      [
        { created_at: '2026-11-27T01:00:00Z', valid: true, charged_cents: 50 },
        { created_at: '2026-11-27T02:00:00Z', valid: false, charged_cents: 50 },
        { created_at: '2026-11-27T03:00:00Z', valid: true, charged_cents: 0 },
        { created_at: '2026-10-01T03:00:00Z', valid: true, charged_cents: 70 },
      ],
      days,
      (c) => c.charged_cents * 2,
    );
    expect(per.at(-1)).toEqual({ day: '2026-11-27', clicks: 1, charged: 100, invalid: 2 });
    expect(pct(50, 200)).toBe(25);
    expect(pct(1, 0)).toBe(0);
  });
});

describe('Notifications rules', () => {
  const rows = [
    { id: '1', title: 'a', body: null, link: null, read_at: null, created_at: '2026-11-27T09:00:00Z' },
    { id: '2', title: 'b', body: null, link: null, read_at: '2026-11-26T09:00:00Z', created_at: '2026-11-26T08:00:00Z' },
  ];
  it('unread count, "seen" = newest shown, filter', () => {
    expect(unreadCount(rows)).toBe(1);
    expect(seenStamp(rows)).toBe('2026-11-27T09:00:00Z');
    expect(seenStamp([])).toBeNull();
    expect(notificationFilter('unread')).toBe('unread');
    expect(notificationFilter('x')).toBe('all');
  });
});

describe('Currency rules', () => {
  const now = '2026-11-27T12:00:00.000Z';
  const r = (id: string, rate: number, from: string, source = 'manual'): FxRow => ({ id, rate, effective_from: from, set_by: null, source, note: null, created_at: from });
  // fx_rates come newest first (effective_from desc)
  const rates = [r('future2', 7.3, '2026-12-20T00:00:00Z'), r('future1', 7.2, '2026-12-01T00:00:00Z'), r('ref', 7.25, '2026-11-27T06:00:00Z', 'reference'), r('cur', 7.1, '2026-11-01T00:00:00Z'), r('old', 7.0, '2026-10-01T00:00:00Z')];
  it('approved = newest manual in force; upcoming = the nearest future manual; reference diff', () => {
    const s = rateSummary(rates, now);
    expect(s.approved?.id).toBe('cur');
    expect(s.upcoming?.id).toBe('future1');
    expect(s.reference?.id).toBe('ref');
    expect(s.rate).toBe(7.1);
    expect(s.diff).toBeCloseTo(((7.25 - 7.1) / 7.1) * 100, 6);
    expect(rateSummary([], now).rate).toBe(7.1);
  });
  it('rate history status', () => {
    expect(rateStatus(rates[2], 'cur', now)).toBe('display');
    expect(rateStatus(rates[3], 'cur', now)).toBe('in-use');
    expect(rateStatus(rates[0], 'cur', now)).toBe('scheduled');
    expect(rateStatus(rates[4], 'cur', now)).toBe('previous');
  });
  it('maker–checker: the requester never approves; cancel by Admin, or Finance while waiting', () => {
    const me = { userId: 'u1', isAdmin: false, canApprove: true };
    expect(switchActions({ status: 'pending_approval', requested_by: 'u2' }, me)).toMatchObject({ approve: true, cancel: true, otherMustApprove: false });
    expect(switchActions({ status: 'pending_approval', requested_by: 'u1' }, me)).toMatchObject({ approve: false, otherMustApprove: true, mine: true });
    expect(switchActions({ status: 'scheduled', requested_by: 'u2' }, me)).toMatchObject({ approve: false, cancel: false });
    expect(switchActions({ status: 'scheduled', requested_by: 'u2' }, { ...me, isAdmin: true })).toMatchObject({ cancel: true });
    expect(switchActions({ status: 'applied', requested_by: 'u2' }, { ...me, isAdmin: true })).toMatchObject({ approve: false, cancel: false });
  });
});

describe('static guards', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const pages: [string, string][] = [
    ['content', "requireStaff('content', 'view'"],
    ['ads', "requireStaff('ads', 'view'"],
    ['currency', "requireStaff('finance', 'view'"],
    ['notifications', "if (s.aal !== 'aal2') redirect("],
  ];
  it.each(pages)('%s: replaced re-export marked ODS T9, same guard as today', (p, guard) => {
    const src = read(`app/ods/admin/${p}/page.tsx`);
    expect(src.startsWith('// ODS T9')).toBe(true);
    expect(src).toContain(guard);
    expect(src).not.toContain(`export { default`);
  });
  it('saves call TODAY’s actions (imported, not re-implemented)', () => {
    expect(read('app/ods/admin/content/_components/content-screen.tsx')).toMatch(/from '@\/app\/admin\/content\/actions'[\s\S]*from '@\/app\/admin\/content\/home-actions'[\s\S]*from '@\/app\/admin\/content\/media-actions'/);
    expect(read('app/ods/admin/ads/_components/ads-screen.tsx')).toContain("from '@/app/admin/actions'");
    expect(read('app/ods/admin/ads/_components/ads-screen.tsx')).toContain("from '@/app/admin/ads/actions'");
    expect(read('app/ods/admin/currency/_components/currency-screen.tsx')).toContain("from '@/app/admin/currency/actions'");
    expect(read('app/ods/admin/notifications/_components/notifications-screen.tsx')).toContain("from '@/app/account/notifications/actions'");
  });
  it('the ODS loaders only read (no insert / update / upsert / delete / rpc writes)', () => {
    for (const f of ['content', 'ads', 'currency']) expect(read(`app/ods/admin/${f}/_lib/data.ts`), f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});
