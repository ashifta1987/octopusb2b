/**
 * ODS T4 · Turnkey (Part 5.6) — pure helpers for the project page and the start form (server, client, tests).
 * The start form posts through TODAY's action (app/account/turnkey/actions.ts submitEnquiryAction → RPC
 * tk_submit_enquiry), which only knows: catalogue project, title, country, city, opening date, floor area, budget (US$)
 * and the plan text. The board's extra fields (products, quantity per item) are written into the plan text.
 */
import { usdToCents, type TkService } from '@/lib/turnkey/format';

/** Slug used for "Start my own project" (no catalogue project): /shop/turnkey/new/start. Project ids look like "1-robotic-cafe". */
export const OWN_PROJECT_SLUG = 'new';

export const isProjectSlug = (s: string) => /^[a-z0-9-]{1,60}$/.test(s);

export type TurnkeyStartValues = {
  products: string;
  quantity: string;
  budgetUsd: string;
  country: string;
  brief: string;
};

/** Minimum brief length — today's action refuses a plan shorter than 20 characters. */
export const BRIEF_MIN = 20;

/** The plan text sent to tk_submit_enquiry: products and quantity first, then the brief. */
export function buildTurnkeyPlan(v: Pick<TurnkeyStartValues, 'products' | 'quantity' | 'brief'>): string {
  const head = [
    v.products.trim() ? `Products: ${v.products.trim()}` : null,
    v.quantity.trim() ? `Quantity per item: ${v.quantity.trim()}` : null,
  ].filter(Boolean) as string[];
  return [...head, ...(head.length ? [''] : []), v.brief.trim()].join('\n').trim();
}

/** Same budget rule as today's action (usdToCents): empty is fine, else whole US dollars (up to 2 decimals). */
export function budgetError(raw: string): string | null {
  return Number.isNaN(usdToCents(raw)) ? 'Enter an amount in US dollars, for example 35000.' : null;
}

/** What still blocks Send (shown next to the disabled button). `own` = no catalogue project: products are required. */
export function startMissing(v: TurnkeyStartValues, own: boolean): string[] {
  return [
    own && !v.products.trim() ? 'what you want to make or open' : null,
    v.brief.trim().length < BRIEF_MIN ? `your brief (${BRIEF_MIN} characters or more)` : null,
  ].filter(Boolean) as string[];
}

/** Shown next to the disabled controls (today's start action has no file upload and there is no draft store). */
export const TURNKEY_FILES_REASON = 'Files can’t be attached to the request yet. Your account manager asks for them when they contact you.';
export const TURNKEY_DRAFT_REASON = 'Drafts aren’t saved yet. Sending is free and you can change the brief with your account manager.';

/** Files: 20 MB each (Part 5.6) — the same limit as today's turnkey drawings (TK_DRAWING_MAX_BYTES). */
export const TURNKEY_FILE_MAX_BYTES = 20 * 1024 * 1024;

/* ───────── project page ───────── */

export type IncludedRow = { id: string; item: string; detail: string | null; fee: { cents: number; approx: boolean; unit: TkService['unit'] } };

/** "What's included": the active Turnkey services from tk_services (core + quality checks), in the owner's order. */
export function includedRows(services: TkService[]): IncludedRow[] {
  return services
    .filter((s) => s.group_code === 'core' || s.group_code === 'qc')
    .sort((a, b) => a.sort - b.sort)
    .map((s) => ({ id: s.code, item: s.name, detail: s.rule_text, fee: { cents: s.from_cents, approx: s.approx, unit: s.unit } }));
}

const PER: Record<TkService['unit'], string> = { project: 'per project', day: 'per day', version: 'per version', item: '', trip: 'per trip', free: '' };
/** Suffix for a starting fee, e.g. "per day" (empty for item / free). */
export const feeUnit = (u: TkService['unit']) => PER[u] ?? '';
