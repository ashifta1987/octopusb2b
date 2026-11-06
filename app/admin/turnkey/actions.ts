'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { guard, fail, ok, type Result } from '@/components/admin/server';
import { LEAD_STATUSES, REGIONS, TURNKEY_CATEGORIES, TURNKEY_STATUSES } from '@/lib/turnkey/format';

/** Admin → Turnkey (ADDON-31 §5). Writes go through the user's client: RLS requires can('turnkey','edit'). */

const done = (msg?: string) => { revalidateTag('turnkey', 'max'); revalidateTag('turnkey-leads', 'max'); revalidatePath('/admin/turnkey', 'layout'); return ok(msg); };
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const intOrNull = (fd: FormData, k: string) => { const v = txt(fd, k).replace(/[,$\s]/g, ''); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : NaN; };

async function audit(actor: string, action: string, entity: string, id: string, details: Record<string, unknown>) {
  await createAdminClient().from('audit_log').insert({ actor_id: actor, action, entity, entity_id: id, details });
}

export async function updateLead(leadId: string, patch: { status?: string; assigned_to?: string | null }): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) { if (!(LEAD_STATUSES as readonly string[]).includes(patch.status)) return fail('Invalid status'); up.status = patch.status; }
  if (patch.assigned_to !== undefined) { up.assigned_to = patch.assigned_to || null; up.assigned_at = patch.assigned_to ? new Date().toISOString() : null; }
  const { error, data } = await g.sb.from('turnkey_leads').update(up).eq('lead_id', leadId).select('reference').maybeSingle();
  if (error) return fail(error);
  if (!data) return fail('NOT_FOUND');
  if (patch.assigned_to) {
    await createAdminClient().from('notifications').insert({ user_id: patch.assigned_to, title: 'Turnkey lead assigned to you', body: `${data.reference} was assigned to you by ${g.s.profile?.full_name ?? 'an admin'}.`, link: `/admin/turnkey?lead=${leadId}` });
  }
  await audit(g.s.userId, 'turnkey.lead_updated', 'turnkey_leads', leadId, up);
  return done('Lead updated');
}

export async function setStaffRegion(userId: string, region: string): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  if (region && !(REGIONS as readonly string[]).includes(region)) return fail('Invalid region');
  const admin = createAdminClient();
  const { data: role } = await admin.from('user_roles').select('user_id').eq('user_id', userId).eq('role_code', 'sourcing_agent').maybeSingle();
  if (!role) return fail('Only sourcing agents carry a lead region.');
  const { error } = await admin.from('profiles').update({ region: region || null }).eq('id', userId);
  if (error) return fail(error);
  await audit(g.s.userId, 'turnkey.staff_region_set', 'profiles', userId, { region: region || null });
  return done('Region saved');
}

export async function saveProject(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const id = txt(fd, 'project_id');
  const isNew = fd.get('_new') === '1';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 60) return fail('Project id: lowercase letters, digits and hyphens (e.g. water-bottling).');
  if (['atlas', 'confirmation'].includes(id)) return fail('That project id is reserved.');
  const category = txt(fd, 'category'); const status = txt(fd, 'status');
  if (!(TURNKEY_CATEGORIES as readonly string[]).includes(category)) return fail('Choose a category.');
  if (!(TURNKEY_STATUSES as readonly string[]).includes(status)) return fail('Choose a status.');
  const budget = intOrNull(fd, 'starting_budget_usd'); const lead = intOrNull(fd, 'lead_time_days'); const rank = intOrNull(fd, 'starter_rank');
  if (Number.isNaN(budget) || Number.isNaN(lead) || Number.isNaN(rank)) return fail('Budget, lead time and rank must be numbers.');
  const pick = fd.get('is_starter_pick') === 'on';
  if (pick && !(rank && rank >= 1 && rank <= 5)) return fail('A starter pick needs a rank from 1 to 5.');
  const title = txt(fd, 'title'); if (title.length < 3) return fail('Title is required.');
  if (status === 'live' && !isNew) {
    const { count } = await g.sb.from('turnkey_packages').select('package_id', { count: 'exact', head: true }).eq('project_id', id).eq('is_active', true);
    if (!count) return fail('Add at least one active package before switching the project live.');
  }
  const row = {
    project_id: id, title, category, status, short_reason: txt(fd, 'short_reason') || null, starting_budget_usd: budget, budget_unit: txt(fd, 'budget_unit') || null,
    lead_time_days: lead, hub_label: txt(fd, 'hub_label') || null, factory_hub_ids: fd.getAll('factory_hub_ids').map(String).filter(Boolean),
    best_markets: txt(fd, 'best_markets').split(',').map((x) => x.trim()).filter(Boolean), is_starter_pick: pick, starter_rank: pick ? rank : null,
    overview_md: txt(fd, 'overview_md') || null, highlights: txt(fd, 'highlights').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6),
    hero_image_path: txt(fd, 'hero_image_path') || null, hero_image_alt: txt(fd, 'hero_image_alt') || null, seo_title: txt(fd, 'seo_title') || null, seo_description: txt(fd, 'seo_description') || null,
    updated_at: new Date().toISOString(),
  };
  if (row.hero_image_path && !/^https:\/\//.test(row.hero_image_path)) return fail('Hero image must be an https:// URL.');
  const { error } = isNew ? await g.sb.from('turnkey_projects').insert({ ...row, sort_rank: 100 }) : await g.sb.from('turnkey_projects').update(row).eq('project_id', id);
  if (error) return fail(/starter_rank_key/.test(error.message) ? 'Another project already has that starter rank.' : error);
  await audit(g.s.userId, isNew ? 'turnkey.project_created' : 'turnkey.project_updated', 'turnkey_projects', id, { status, is_starter_pick: pick, starter_rank: row.starter_rank });
  return done(isNew ? 'Project created' : 'Project saved');
}

export async function setProjectStatus(projectId: string, status: string): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  if (!(TURNKEY_STATUSES as readonly string[]).includes(status)) return fail('Invalid status');
  if (status === 'live') {
    const { count } = await g.sb.from('turnkey_packages').select('package_id', { count: 'exact', head: true }).eq('project_id', projectId).eq('is_active', true);
    if (!count) return fail('Add at least one active package before switching the project live.');
  }
  const { error } = await g.sb.from('turnkey_projects').update({ status, updated_at: new Date().toISOString() }).eq('project_id', projectId);
  if (error) return fail(error);
  await audit(g.s.userId, 'turnkey.project_status', 'turnkey_projects', projectId, { status });
  return done(`Project is now ${status}`);
}

export async function savePackage(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const pkgId = txt(fd, 'package_id'); const projectId = txt(fd, 'project_id');
  const nums = ['tier_rank', 'starting_budget_usd', 'items_count', 'lead_time_days', 'monthly_revenue_low', 'monthly_revenue_high', 'payback_months_low', 'payback_months_high'] as const;
  const n: Record<string, number | null> = {};
  for (const k of nums) { const v = intOrNull(fd, k); if (Number.isNaN(v)) return fail(`${k.replace(/_/g, ' ')} must be a number`); n[k] = v; }
  if (!n.tier_rank || n.tier_rank < 1 || n.tier_rank > 9) return fail('Tier rank must be 1–9.');
  const tier = txt(fd, 'tier_name'); if (!tier) return fail('Tier name is required.');
  const row = {
    project_id: projectId, tier_name: tier, tier_label: txt(fd, 'tier_label') || null, capacity_label: txt(fd, 'capacity_label') || null,
    space_label: txt(fd, 'space_label') || null, container_label: txt(fd, 'container_label') || null, summary_md: txt(fd, 'summary_md') || null,
    starting_budget_notes: txt(fd, 'starting_budget_notes') || null, is_active: fd.get('is_active') === 'on', ...n, updated_at: new Date().toISOString(),
  };
  const { error } = pkgId ? await g.sb.from('turnkey_packages').update(row).eq('package_id', pkgId) : await g.sb.from('turnkey_packages').insert(row);
  if (error) return fail(/duplicate key/.test(error.message) ? 'Another package already uses that tier rank.' : error);
  await audit(g.s.userId, pkgId ? 'turnkey.package_updated' : 'turnkey.package_created', 'turnkey_packages', pkgId || projectId, { tier, budget: n.starting_budget_usd });
  return done('Package saved');
}

export async function saveEquipment(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const lineId = txt(fd, 'line_id'); const pkgId = txt(fd, 'package_id');
  const qty = intOrNull(fd, 'quantity'); const budget = intOrNull(fd, 'budget_usd'); const sort = intOrNull(fd, 'sort_order');
  if (Number.isNaN(qty) || Number.isNaN(budget) || Number.isNaN(sort)) return fail('Quantity, budget and order must be numbers.');
  const name = txt(fd, 'name'); if (!name) return fail('Item name is required.');
  const row = { package_id: pkgId, name, group_label: txt(fd, 'group_label') || null, quantity: qty && qty > 0 ? qty : 1, unit: txt(fd, 'unit') || null, spec_md: txt(fd, 'spec_md') || null, budget_usd: budget, notes: txt(fd, 'notes') || null, ...(sort != null ? { sort_order: sort } : {}) };
  if (!lineId && sort == null) {
    const { data: last } = await g.sb.from('turnkey_equipment').select('sort_order').eq('package_id', pkgId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    Object.assign(row, { sort_order: (Number(last?.sort_order) || 0) + 1 });
  }
  const { error } = lineId ? await g.sb.from('turnkey_equipment').update(row).eq('line_id', lineId) : await g.sb.from('turnkey_equipment').insert(row);
  if (error) return fail(error);
  return done('Item saved');
}

export async function deleteEquipment(lineId: string): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const { error } = await g.sb.from('turnkey_equipment').delete().eq('line_id', lineId);
  if (error) return fail(error);
  return done('Item removed');
}

/** Move an equipment line up/down (keyboard-accessible alternative to drag-to-reorder). */
export async function moveEquipment(lineId: string, dir: -1 | 1): Promise<Result> {
  const g = await guard('turnkey', 'edit'); if ('error' in g) return g.error;
  const { data: line } = await g.sb.from('turnkey_equipment').select('package_id').eq('line_id', lineId).maybeSingle();
  if (!line) return fail('NOT_FOUND');
  const { data: all } = await g.sb.from('turnkey_equipment').select('line_id, sort_order').eq('package_id', line.package_id).order('sort_order').order('line_id');
  const list = (all ?? []).map((r) => r.line_id as string);
  const i = list.indexOf(lineId); const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return ok();
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    const { error } = await g.sb.from('turnkey_equipment').update({ sort_order: k + 1 }).eq('line_id', list[k]);
    if (error) return fail(error);
  }
  return done();
}

