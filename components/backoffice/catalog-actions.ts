'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/format';
import { actionSession, fail, ok, type Result } from './server-utils';

function refresh() {
  revalidatePath('/distributor/catalog');
  revalidatePath('/admin/catalog');
  revalidateTag('site-content', 'max');
  revalidateTag('products', 'max');
}

async function audit(sb: Awaited<ReturnType<typeof createClient>>, action: string, id: string, details?: Record<string, unknown>) {
  await sb.rpc('log_catalog_change', { p_action: action, p_entity_id: id, p_details: details ?? null });
}

export async function createCategory(parentId: string | null, name: string): Promise<Result<{ id: string }>> {
  const g = await actionSession('catalog', 'create');
  if ('error' in g) return fail(g.error);
  const n = name.trim();
  if (n.length < 2) return fail('Name must be at least 2 characters.');
  const sb = await createClient();
  let level = 1;
  if (parentId) {
    const { data: p } = await sb.from('categories').select('level').eq('id', parentId).maybeSingle();
    if (!p) return fail('Parent category not found');
    if (p.level >= 4) return fail('Level 4 is the deepest level. Add products here, not subcategories.');
    level = p.level + 1;
  }
  const sib = parentId ? sb.from('categories').select('sort').eq('parent_id', parentId) : sb.from('categories').select('sort').is('parent_id', null);
  const { data: sibs } = await sib.order('sort', { ascending: false }).limit(1);
  const { data, error } = await sb.from('categories')
    .insert({ parent_id: parentId, name: n, slug: slugify(n), level, sort: (sibs?.[0]?.sort ?? 0) + 1 })
    .select('id').single();
  if (error) return fail(error.code === '23505' ? 'A category with this name already exists here.' : error);
  await audit(sb, 'category.create', data.id, { name: n, parent_id: parentId });
  refresh();
  return ok({ id: data.id as string }, 'Category created');
}

export async function updateCategory(id: string, fields: { name: string; hs_code: string | null }): Promise<Result> {
  const g = await actionSession('catalog', 'edit');
  if ('error' in g) return fail(g.error);
  const n = fields.name.trim();
  if (n.length < 2) return fail('Name must be at least 2 characters.');
  const sb = await createClient();
  const { error, data } = await sb.from('categories').update({ name: n, slug: slugify(n), hs_code: fields.hs_code?.trim() || null }).eq('id', id).select('id');
  if (error) return fail(error.code === '23505' ? 'A sibling category already uses this name.' : error);
  if (!data?.length) return fail('You cannot edit this category.');
  await audit(sb, 'category.rename', id, { name: n });
  refresh();
  return ok(undefined, 'Saved');
}

export async function moveCategory(id: string, dir: 'up' | 'down'): Promise<Result> {
  const g = await actionSession('catalog', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data: c } = await sb.from('categories').select('id, parent_id, sort').eq('id', id).maybeSingle();
  if (!c) return fail('Not found');
  const q = c.parent_id ? sb.from('categories').select('id, sort').eq('parent_id', c.parent_id) : sb.from('categories').select('id, sort').is('parent_id', null);
  const { data: sibs } = await q.order('sort').order('name');
  const list = sibs ?? [];
  const i = list.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return ok();
  [list[i], list[j]] = [list[j], list[i]];
  // renumber all siblings so sort is unique and contiguous
  const res = await Promise.all(list.map((x, k) => sb.from('categories').update({ sort: k + 1 }).eq('id', x.id)));
  const e = res.find((r) => r.error)?.error;
  if (e) return fail(e);
  await audit(sb, 'category.reorder', id, { dir });
  refresh();
  return ok();
}

export async function setCategoryActive(id: string, active: boolean): Promise<Result> {
  const g = await actionSession('catalog', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { error } = await sb.from('categories').update({ active }).eq('id', id);
  if (error) return fail(error);
  await audit(sb, active ? 'category.activate' : 'category.deactivate', id);
  refresh();
  return ok(undefined, active ? 'Category shown' : 'Category hidden');
}

export async function mergeCategory(fromId: string, toId: string): Promise<Result> {
  const g = await actionSession('catalog', 'edit');
  if ('error' in g) return fail(g.error);
  if (!toId) return fail('Choose the category to merge into.');
  const sb = await createClient();
  const { data, error } = await sb.rpc('merge_category', { p_from: fromId, p_to: toId });
  if (error) return fail(error);
  refresh();
  revalidatePath('/distributor/products');
  return ok(undefined, `Merged · ${data ?? 0} products moved`);
}

export async function saveTag(id: string | null, name: string, kind: string): Promise<Result> {
  const g = await actionSession('catalog', id ? 'edit' : 'create');
  if ('error' in g) return fail(g.error);
  const n = name.trim();
  if (n.length < 2) return fail('Tag name must be at least 2 characters.');
  const sb = await createClient();
  const row = { name: n, slug: slugify(n), kind: kind || 'general' };
  const { error } = id ? await sb.from('tags').update(row).eq('id', id) : await sb.from('tags').insert(row);
  if (error) return fail(error.code === '23505' ? 'A tag with this name already exists.' : error);
  await audit(sb, id ? 'tag.update' : 'tag.create', id ?? n, row);
  refresh();
  return ok(undefined, id ? 'Tag updated' : 'Tag added');
}

export async function deleteTag(id: string): Promise<Result> {
  const g = await actionSession('catalog', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { error, data } = await sb.from('tags').delete().eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('You cannot delete tags.');
  await audit(sb, 'tag.delete', id);
  refresh();
  return ok(undefined, 'Tag deleted');
}
