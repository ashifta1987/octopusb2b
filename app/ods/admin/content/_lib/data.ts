import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES } from '@/lib/format';
import { bannerStat, featureOrder, type ContentTab, type TermsVersion } from '../../_website/website-core';

/**
 * Site content — TODAY's reads (app/admin/content/page.tsx, home-tab.tsx, media-tab.tsx), unchanged, for the tab on
 * screen only (session client, RLS). Read-only here; every write is today's action from app/admin/content/*.
 */
export type ContentPage = { id: string; slug: string; title: string; body: string; status: string; is_legal: boolean; published_at: string | null; updated_at: string };
export type Snapshot = { id: string; snapshot: Record<string, unknown>; created_by: string | null; created_at: string };
export type Banner = {
  id: string; eyebrow: string | null; title: string; body: string | null; cta_label: string | null; cta_href: string | null; cta2_label: string | null; cta2_href: string | null;
  ticks: string[]; theme: string; image_url: string | null; show_open_project: boolean; starts_at: string | null; ends_at: string | null; sort: number; active: boolean;
};
export type MediaSlot = { key: string; label: string; src: string; path: string | null; alt: string };

export type ContentData =
  | { tab: 'terms'; versions: TermsVersion[]; settings: Record<string, string> }
  | { tab: 'pages'; pages: ContentPage[]; page: ContentPage | null; proposals: Snapshot[]; history: Snapshot[]; who: Record<string, string> }
  | { tab: 'blocks'; blocks: { key: string; value: string; status: string; updated_at: string }[] }
  | { tab: 'company'; company: Record<string, string | null>; branches: Record<string, unknown>[]; countries: [string, string][] }
  | { tab: 'home'; banners: Banner[]; bannerStats: Record<string, string>; sideStats: { pools: string; shipping: string; announcement: string }; announcementEnabled: boolean; showPlaceholders: boolean; order: string[]; announcement: string }
  | { tab: 'media'; slots: MediaSlot[] };

const publicUrl = (path: string) => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/site-media/${path}`;

export async function loadContent(tab: ContentTab, opts: { slug?: string; nowMs: number }): Promise<ContentData> {
  const sb = await createClient();
  switch (tab) {
    case 'terms': {
      const [{ data }, { data: settings }] = await Promise.all([
        sb.from('terms_versions').select('id, version, status, sections, publish_at, published_at, created_at').eq('kind', 'general').order('created_at', { ascending: false }),
        sb.from('site_settings').select('key, value'),
      ]);
      return { tab, versions: (data ?? []) as TermsVersion[], settings: Object.fromEntries((settings ?? []).map((r) => [r.key as string, String(r.value)])) };
    }
    case 'pages': {
      const { data } = await sb.from('pages').select('id, slug, title, body, status, is_legal, published_at, updated_at').order('is_legal', { ascending: false }).order('title');
      const pages = (data ?? []) as ContentPage[];
      const page = pages.find((p) => p.slug === opts.slug) ?? pages[0] ?? null;
      const [{ data: proposals }, { data: history }] = page
        ? await Promise.all([
            sb.from('content_versions').select('id, snapshot, created_by, created_at').eq('entity', 'page_proposal').eq('entity_id', page.id).order('created_at', { ascending: false }),
            sb.from('content_versions').select('id, snapshot, created_by, created_at').eq('entity', 'page').eq('entity_id', page.id).order('created_at', { ascending: false }).limit(10),
          ])
        : [{ data: [] }, { data: [] }];
      const people = [...new Set([...(proposals ?? []), ...(history ?? [])].map((x) => x.created_by as string | null).filter(Boolean) as string[])];
      const { data: profs } = people.length ? await sb.from('profiles').select('id, full_name').in('id', people) : { data: [] };
      return { tab, pages, page, proposals: (proposals ?? []) as Snapshot[], history: (history ?? []) as Snapshot[], who: Object.fromEntries((profs ?? []).map((p) => [p.id as string, (p.full_name as string) ?? '—'])) };
    }
    case 'blocks': {
      const { data } = await sb.from('content_blocks').select('key, value, status, updated_at').order('key');
      return { tab, blocks: (data ?? []) as { key: string; value: string; status: string; updated_at: string }[] };
    }
    case 'company': {
      const [{ data: company }, { data: branches }] = await Promise.all([sb.from('company_profile').select('*').eq('id', 1).maybeSingle(), sb.from('branches').select('*').order('sort')]);
      return { tab, company: (company ?? {}) as Record<string, string | null>, branches: (branches ?? []) as Record<string, unknown>[], countries: Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])) };
    }
    case 'home': {
      const since = new Date(opts.nowMs - 30 * 864e5).toISOString();
      const [{ data: banners }, { data: settings }, { data: ann }, { data: events }] = await Promise.all([
        sb.from('home_banners').select('id, eyebrow, title, body, cta_label, cta_href, cta2_label, cta2_href, ticks, theme, image_url, show_open_project, starts_at, ends_at, sort, active').order('sort'),
        sb.from('site_settings').select('key, value').in('key', ['home.announcement_enabled', 'home.show_placeholders', 'home.feature_cards']),
        sb.from('content_blocks').select('value').eq('key', 'home.announcement').maybeSingle(),
        sb.from('banner_events').select('banner_id, slot, event').gte('ts', since).limit(50000),
      ]);
      const st = Object.fromEntries((settings ?? []).map((r) => [r.key as string, r.value])) as Record<string, unknown>;
      const ev = (events ?? []) as { banner_id: string | null; slot: string; event: string }[];
      const bs = (banners ?? []) as Banner[];
      return {
        tab,
        banners: bs,
        bannerStats: Object.fromEntries(bs.map((b) => [b.id, bannerStat(ev, (e) => e.banner_id === b.id)])),
        sideStats: { pools: bannerStat(ev, (e) => e.slot === 'side-pools'), shipping: bannerStat(ev, (e) => e.slot === 'side-shipping'), announcement: bannerStat(ev, (e) => e.slot === 'announcement') },
        announcementEnabled: st['home.announcement_enabled'] !== false,
        showPlaceholders: st['home.show_placeholders'] === true,
        order: featureOrder(st['home.feature_cards']),
        announcement: (ann?.value as string) ?? '',
      };
    }
    case 'media': {
      const { data, error } = await sb.from('site_media').select('key, label, default_src, path, alt, width, height, updated_at').order('sort');
      if (error) throw new Error(`Could not load the picture slots: ${error.message}`);
      return { tab, slots: (data ?? []).map((m) => ({ key: m.key as string, label: m.label as string, path: (m.path as string | null) ?? null, src: m.path ? publicUrl(m.path as string) : (m.default_src as string), alt: (m.alt as string) ?? '' })) };
    }
  }
}
