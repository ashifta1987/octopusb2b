'use server';
import { deleteView, listViews, saveView } from '@/lib/office/views';
import type { OfficeResult, SavedView, SaveViewInput } from '@/lib/office/workspace-core';

/** Grid: the views for a page (own + shared with my roles). */
export async function listViewsAction(page: string): Promise<OfficeResult<SavedView[]>> {
  return listViews(String(page ?? ''));
}

/** Grid: "Save as view" / update an own view. */
export async function saveViewAction(input: SaveViewInput): Promise<OfficeResult<SavedView>> {
  return saveView(input);
}

export async function deleteViewAction(id: string): Promise<OfficeResult<null>> {
  return deleteView(String(id ?? ''));
}
