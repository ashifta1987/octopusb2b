import 'server-only';
import { officeCtx } from '@/lib/office/server';
import { officeFail, okResult, sortViews, viewFromRow, viewPageKey, type OfficeResult, type SavedView, type SaveViewInput } from '@/lib/office/workspace-core';

export type { SavedView, SaveViewInput } from '@/lib/office/workspace-core';

const COLS = 'id, user_id, scope, page, name, filters, columns, sort, shared_role, is_default, created_at, updated_at';

/** Views the signed-in staff member can use on a grid page: their own + shared with one of their roles (or all staff). */
export async function listViews(page: string): Promise<OfficeResult<SavedView[]>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { data, error } = await c.sb.from('saved_views').select(COLS).eq('page', viewPageKey(page)).order('name').limit(200);
  if (error) return officeFail(error);
  return okResult(sortViews((data ?? []).map((r) => viewFromRow(r as Record<string, unknown>, c.s.userId))));
}

/** Creates (no id) or updates (own view) a saved view. Shared views: with one of your roles (admins: any role, or everyone). */
export async function saveView(input: SaveViewInput): Promise<OfficeResult<SavedView>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const page = viewPageKey(input.page);
  const { data: id, error } = await c.sb.rpc('save_view', {
    p_id: input.id ?? null,
    p_page: page,
    p_name: (input.name ?? '').trim(),
    p_scope: input.scope,
    p_shared_role: input.scope === 'shared' ? input.sharedRole ?? null : null,
    p_filters: input.filters ?? {},
    p_columns: input.columns ?? [],
    p_sort: input.sort ?? [],
    p_is_default: input.scope === 'personal' && !!input.isDefault,
  });
  if (error) return officeFail(error);
  const { data: row, error: e2 } = await c.sb.from('saved_views').select(COLS).eq('id', id as string).maybeSingle();
  if (e2 || !row) return officeFail(e2 ?? 'NOT_FOUND');
  return okResult(viewFromRow(row as Record<string, unknown>, c.s.userId), input.id ? 'View updated' : 'View saved');
}

export async function deleteView(id: string): Promise<OfficeResult<null>> {
  const c = await officeCtx();
  if ('fail' in c) return c.fail;
  const { error } = await c.sb.rpc('delete_view', { p_id: id });
  if (error) return officeFail(error);
  return okResult(null, 'View deleted');
}
