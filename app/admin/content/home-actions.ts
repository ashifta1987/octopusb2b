'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { guard, fail, ok, type Result } from '@/components/admin/server';

/** Admin → Site content → Home page (ADDON-32): lead banners, announcement, feature cards, placeholder switch. */

const FEATURES = ['rfq', 'pool', 'turnkey', 'dropship', '3pl', 'qc', 'certification', 'wallet', 'assistant', 'api'];
const t = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const href = (v: string) => !v || /^(\/(?!\/)|https:\/\/|#)/.test(v);
const done = (m: string) => { revalidateTag('home-banners', 'max'); revalidateTag('site-content', 'max'); revalidatePath('/admin/content'); return ok(m); };

export async function saveBanner(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit'); if ('error' in g) return g.error;
  const id = t(fd, 'id');
  const row = {
    eyebrow: t(fd, 'eyebrow') || null, title: t(fd, 'title'), body: t(fd, 'body') || null,
    cta_label: t(fd, 'cta_label') || null, cta_href: t(fd, 'cta_href') || null, cta2_label: t(fd, 'cta2_label') || null, cta2_href: t(fd, 'cta2_href') || null,
    ticks: t(fd, 'ticks').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 4), theme: t(fd, 'theme') || 'navy', image_url: t(fd, 'image_url') || null,
    show_open_project: fd.get('show_open_project') === 'on', active: fd.get('active') === 'on', sort: Number(t(fd, 'sort') || 0) || 0,
    starts_at: t(fd, 'starts_at') ? new Date(t(fd, 'starts_at')).toISOString() : null, ends_at: t(fd, 'ends_at') ? new Date(t(fd, 'ends_at')).toISOString() : null,
    updated_at: new Date().toISOString(), updated_by: g.s.userId,
  };
  if (row.title.length < 3) return fail('Title is required.');
  if (!['navy', 'blue', 'light'].includes(row.theme)) return fail('Choose a theme.');
  if (!href(row.cta_href ?? '') || !href(row.cta2_href ?? '')) return fail('Links must start with /, # or https://');
  if ((row.cta_label == null) !== (row.cta_href == null) || (row.cta2_label == null) !== (row.cta2_href == null)) return fail('Each button needs both a label and a link.');
  if (row.image_url && !/^https:\/\//.test(row.image_url)) return fail('Image must be an https:// URL.');
  if (row.starts_at && row.ends_at && row.ends_at <= row.starts_at) return fail('End date must be after the start date.');
  const { error } = id ? await g.sb.from('home_banners').update(row).eq('id', id) : await g.sb.from('home_banners').insert(row);
  if (error) return fail(error);
  await createAdminClient().from('audit_log').insert({ actor_id: g.s.userId, action: id ? 'home_banner.updated' : 'home_banner.created', entity: 'home_banners', entity_id: id || null, details: { title: row.title, active: row.active } });
  return done(id ? 'Banner saved' : 'Banner added');
}

export async function deleteBanner(id: string): Promise<Result> {
  const g = await guard('content', 'edit'); if ('error' in g) return g.error;
  const { error } = await g.sb.from('home_banners').delete().eq('id', id);
  if (error) return fail(error);
  await createAdminClient().from('audit_log').insert({ actor_id: g.s.userId, action: 'home_banner.deleted', entity: 'home_banners', entity_id: id, details: {} });
  return done('Banner deleted');
}

/** Home switches. site_settings writes go through set_setting (Admin only, audited). */
export async function saveHomeSettings(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit'); if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can change home-page switches. Banners and texts can be edited by content editors.');
  const features = FEATURES.filter((k) => fd.get(`f_${k}`) === 'on').sort((a, b) => (Number(fd.get(`o_${a}`)) || 99) - (Number(fd.get(`o_${b}`)) || 99));
  const sets: [string, unknown][] = [
    ['home.announcement_enabled', fd.get('announcement_enabled') === 'on'],
    ['home.show_placeholders', fd.get('show_placeholders') === 'on'],
    ['home.feature_cards', features],
  ];
  for (const [k, v] of sets) {
    const { error } = await g.sb.rpc('set_setting', { p_key: k, p_value: v as never });
    if (error) return fail(error);
  }
  const ann = t(fd, 'announcement');
  if (ann) {
    const { error } = await g.sb.from('content_blocks').upsert({ key: 'home.announcement', value: ann, updated_at: new Date().toISOString(), updated_by: g.s.userId });
    if (error) return fail(error);
  }
  return done('Home settings saved');
}

