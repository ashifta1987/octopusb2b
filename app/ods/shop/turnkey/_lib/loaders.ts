import 'server-only';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyCatalogue, getTkServices } from '@/lib/turnkey/catalogue';
import { categoryLabel, tkImageUrl, type TkProject } from '@/lib/turnkey/format';
import { includedRows, type IncludedRow } from './turnkey-logic';
import type { TurnkeyProjectViewProps } from '../_components/turnkey-project-view';

/**
 * ODS T4 · Turnkey data: today's public catalogue (getTurnkeyCatalogue → turnkey_projects, TK_PROJECT_COLUMNS:
 * project_id, title, category, short_reason, starting_budget_usd, budget_unit, hero_image_path, hero_image_alt,
 * floor_area_m2, sort_rank) and the active services (getTkServices → tk_services: code, name, from_cents, unit, approx,
 * rule_text, group_code, photo_path, sort). No supplier data exists in either.
 */

export async function turnkeyEnabled(): Promise<boolean> {
  const { settings } = await getSiteContent();
  return settings['turnkey.enabled'] !== false;
}

export async function findProject(slug: string): Promise<TkProject | null> {
  const { projects } = await getTurnkeyCatalogue();
  return projects.find((p) => p.project_id === slug) ?? null;
}

export function toProjectProps(p: TkProject): TurnkeyProjectViewProps['project'] {
  const src = tkImageUrl(p.hero_image_path, process.env.NEXT_PUBLIC_SUPABASE_URL);
  return {
    id: p.project_id,
    title: p.title,
    category: categoryLabel(p.category),
    summary: p.short_reason,
    image: src ? { src, alt: p.hero_image_alt ?? p.title } : null,
    fromUsd: p.starting_budget_usd != null && Number(p.starting_budget_usd) > 0 ? Number(p.starting_budget_usd) : null,
    budgetUnit: p.budget_unit,
    floorAreaM2: p.floor_area_m2,
  };
}

export async function loadIncluded(): Promise<{ rows: IncludedRow[]; error: boolean }> {
  try {
    return { rows: includedRows(await getTkServices()), error: false };
  } catch {
    return { rows: [], error: true };
  }
}
