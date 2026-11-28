/**
 * ODS T9 batch 5 (Catalogue, part A) — pure logic shared by Product moderation, Suppliers, Bulk import (+ run, review),
 * HS codes and Categories & tags. Every rule mirrors today's page; the database keeps enforcing permissions.
 */

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo';
export type Pill = { label: string; tone: Tone };
export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/* ───────── Product moderation ───────── */

/** Queue = today's statuses (submitted, in review). A held product shows "On hold". */
export const MODERATION_STATUSES = ['submitted', 'in_review'] as const;
export function productPill(status: string, hold = false): Pill {
  if (hold) return { label: 'On hold', tone: 'warning' };
  return ({ submitted: { label: 'Submitted', tone: 'info' }, in_review: { label: 'In review', tone: 'warning' }, live: { label: 'Live', tone: 'success' }, rejected: { label: 'Rejected', tone: 'danger' }, draft: { label: 'Draft', tone: 'neutral' }, archived: { label: 'Archived', tone: 'neutral' }, paused: { label: 'Paused', tone: 'neutral' } } as Record<string, Pill>)[status] ?? { label: human(status), tone: 'neutral' };
}
/** Same view as today's productStatusView: drafts that need a quote / are in development say so. */
export function productStatusPill(status: string | null | undefined, listingStatus?: string | null): Pill {
  const s = status ?? 'draft';
  if (s === 'draft' && listingStatus === 'needs_quote') return { label: 'Needs quote', tone: 'warning' };
  if (s === 'draft' && listingStatus === 'in_development') return { label: 'In development', tone: 'neutral' };
  return productPill(s);
}
export type ModerationTab = 'all' | 'submitted' | 'in_review' | 'hold';
export const MODERATION_TABS: readonly [ModerationTab, string][] = [
  ['all', 'All'],
  ['submitted', 'Submitted'],
  ['in_review', 'In review'],
  ['hold', 'On hold'],
];
export const matchesModerationTab = (q: { status: string; moderation_hold: boolean }, tab: ModerationTab) =>
  tab === 'all' ? true : tab === 'hold' ? q.moderation_hold : q.status === tab && !q.moderation_hold;

/** Today's "Check:" list (same wording and thresholds). */
export function moderationIssues(p: { description: string | null; tiers: number; photos: number; hasImageUrl: boolean; hs_code: string | null; hs_code_status: string | null; category: string | null }): string[] {
  return [
    !p.description || p.description.length < 80 ? 'Description is short (under 80 characters)' : null,
    !p.tiers ? 'No price tiers' : null,
    !p.photos && !p.hasImageUrl ? 'No photos' : null,
    !p.hs_code ? 'Missing HS code' : null,
    p.hs_code && p.hs_code_status === 'suggested' ? `HS code ${p.hs_code} is a suggestion — check it (does not block approval)` : null,
    !p.category ? 'No category' : null,
  ].filter(Boolean) as string[];
}
/** Today's buttons: Start review only from submitted; Approve & publish hidden while on hold; Reject always (reason required). */
export function moderationActions(p: { status: string; moderation_hold: boolean }) {
  return { startReview: p.status === 'submitted', approve: !p.moderation_hold, reject: true };
}
/** Tier ranges as today: "100–499 pcs", last tier "1,000+ pcs". */
export function tierRanges(tiers: readonly { min_qty: number }[], unit: string): string[] {
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  return sorted.map((t, i) => `${t.min_qty.toLocaleString('en-US')}${sorted[i + 1] ? `–${(sorted[i + 1].min_qty - 1).toLocaleString('en-US')}` : '+'} ${unit}`);
}

/* ───────── Suppliers ───────── */

export const SUPPLIER_SWITCHES: readonly { key: string; label: string }[] = [
  { key: 'portal_login', label: 'Portal login' },
  { key: 'product_upload', label: 'Product upload' },
  { key: 'rfq_replies', label: 'RFQ replies' },
  { key: 'listings_live', label: 'Listings live' },
  { key: 'ai_tools', label: 'AI tools' },
];
export const SUPPLIER_TYPES = ['Manufacturer', 'Wholesaler', 'Trading company', '3PL partner', 'Service partner'] as const;
/** Switch is on unless explicitly false (today's `swv[k] !== false`). */
export const switchOn = (sw: Record<string, unknown> | null | undefined, key: string) => (sw ?? {})[key] !== false;
/** Product counts per supplier, exactly as today (total excludes archived; review = submitted + in review). */
export function supplierProductCounts(rows: readonly { supplier_id: string | null; status: string }[]) {
  const m = new Map<string, { live: number; total: number; review: number }>();
  for (const p of rows) {
    const a = m.get(p.supplier_id ?? '') ?? { live: 0, total: 0, review: 0 };
    if (p.status !== 'archived') a.total++;
    if (p.status === 'live') a.live++;
    if (p.status === 'submitted' || p.status === 'in_review') a.review++;
    m.set(p.supplier_id ?? '', a);
  }
  return m;
}
/** Today's client-side search (code, legal name, country, city). */
export const supplierMatches = (x: { code: string; legal_name: string; country: string; city?: string | null }, q: string) => !q || `${x.code} ${x.legal_name} ${x.country} ${x.city ?? ''}`.toLowerCase().includes(q.toLowerCase());
/** Today's archive confirmation text. */
export function archiveConfirmText(code: string, archived: boolean, c?: { live: number; total: number; review: number }) {
  if (archived) return 'Restore this supplier? Products archived with it come back: live ones as paused (resume them in Moderation), ones that were in moderation go back to the queue, drafts stay drafts.';
  return c?.total ? `Archive ${code}? All ${c.total} of its products will be archived too — ${c.live} live, ${c.review} in moderation, ${c.total - c.live - c.review} other. They disappear from the storefront, the moderation queue and the distributor portal. You can restore the supplier later.` : `Archive ${code}? It has no active products.`;
}
/** Same field checks as today's createSupplier / updateSupplier schema (run in the browser before saving; the action re-checks). */
export function validateSupplier(f: { legal_name: string; country: string; contact_email: string }): string | null {
  const n = f.legal_name.trim();
  if (n.length < 2 || n.length > 200) return 'Legal name: 2 to 200 characters.';
  if (f.country.trim().length !== 2) return 'Choose the country.';
  if (f.contact_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact_email.trim())) return 'Contact email is not valid.';
  return null;
}

/* ───────── Bulk import ───────── */

export function importRunPill(status: string): Pill {
  return ({ previewed: { label: 'Previewed', tone: 'info' }, committed: { label: 'Committed', tone: 'success' }, discarded: { label: 'Discarded', tone: 'neutral' }, failed: { label: 'Failed', tone: 'danger' }, staging: { label: 'Staging', tone: 'info' } } as Record<string, Pill>)[status] ?? { label: human(status), tone: 'neutral' };
}
type D = Record<string, { create?: number; update?: number; skip?: number; total?: number }> | null | undefined;
/** Today's runs table: committed runs show the report, others the diff. */
export function runCounts(r: { status: string; diff: D; report: D }) {
  const d = r.status === 'committed' && r.report ? r.report : r.diff;
  return {
    products: { create: d?.products?.create ?? 0, update: d?.products?.update ?? 0 },
    prices: { create: d?.prices?.create ?? 0, update: d?.prices?.update ?? 0 },
    images: d?.images?.create ?? 0,
    review: r.status === 'committed' ? (r.report?.review?.create ?? 0) : (r.diff?.review?.total ?? 0),
  };
}
/** Today's run-page commit / discard / submit availability. */
export function runActions(r: { status: string; errors: number; canEdit: boolean; drafts: number }) {
  return {
    commit: r.canEdit && r.status === 'previewed' && r.errors === 0,
    discard: r.canEdit && r.status === 'previewed',
    submit: r.canEdit && r.status === 'committed' && r.drafts > 0,
  };
}
/** Supplier prices in 4-decimal minor units, as today ("US$ 1.2345"). */
export const usd4 = (minor: number) => `US$ ${(minor / 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
/** Today's drafts count after a commit: draft or rejected, not waiting for a quote / in development. */
export function draftCount(statusOf: ReadonlyMap<string, string>, listingOf: ReadonlyMap<string, string | null>) {
  return [...statusOf.entries()].filter(([k, v]) => (v === 'draft' || v === 'rejected') && !['needs_quote', 'in_development'].includes(listingOf.get(k) ?? '')).length;
}
/** Today's upload checks (before anything is sent). */
export function validateImportUpload(f: { name: string; validFrom: string; xlsx: { size: number } | null }): string | null {
  if (!f.xlsx || !f.xlsx.size) return 'Choose the supplier workbook (.xlsx).';
  if (f.name.trim().length < 3) return 'Give the import a name, e.g. "Bowijie 2026-11 catalogue".';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validFrom)) return 'Choose the date the supplier prices are valid from.';
  return null;
}
export const firstOfMonth = (nowMs: number) => {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

/* ───────── Import review ───────── */

export const REVIEW_TABS: Record<'open' | 'held' | 'done', string[]> = { open: ['open'], held: ['held'], done: ['accepted_quote', 'accepted_dashboard', 'resolved'] };
export type ReviewTab = keyof typeof REVIEW_TABS;
export const isReviewTab = (t: unknown): t is ReviewTab => typeof t === 'string' && t in REVIEW_TABS;
export const REVIEW_DECISIONS: readonly { status: 'accepted_quote' | 'accepted_dashboard' | 'resolved' | 'held'; label: string; prompt: string }[] = [
  { status: 'accepted_quote', label: 'Accept quote', prompt: 'Accept the supplier QUOTE figures. Optional note:' },
  { status: 'accepted_dashboard', label: 'Accept dashboard', prompt: 'Accept the DASHBOARD / listing figures. Optional note:' },
  { status: 'resolved', label: 'Resolved', prompt: 'Mark resolved (e.g. confirmed with the supplier). Note:' },
  { status: 'held', label: 'Hold', prompt: 'Hold — why?' },
];
/** Hold is offered only on open items (today). */
export const decisionsFor = (status: string) => (status === 'open' ? REVIEW_DECISIONS : status === 'held' ? REVIEW_DECISIONS.filter((d) => d.status !== 'held') : []);
export function reviewPill(status: string): Pill {
  return ({ open: { label: 'Open', tone: 'warning' }, held: { label: 'Held', tone: 'indigo' }, accepted_quote: { label: 'Accepted quote', tone: 'success' }, accepted_dashboard: { label: 'Accepted dashboard', tone: 'success' }, resolved: { label: 'Resolved', tone: 'success' } } as Record<string, Pill>)[status] ?? { label: human(status), tone: 'neutral' };
}

/* ───────── HS codes ───────── */

export function hsTypePill(t: { confirmed: boolean; heading: string | null }): Pill {
  return t.confirmed ? { label: 'Confirmed', tone: 'success' } : t.heading ? { label: 'Suggested', tone: 'warning' } : { label: 'Needs heading', tone: 'danger' };
}
export function hsProposalPill(status: string): Pill {
  return status === 'confirmed' ? { label: 'Confirmed', tone: 'success' } : status === 'suggested' ? { label: 'Suggested', tone: 'warning' } : { label: 'Missing', tone: 'danger' };
}
export const hsSourceLabel = (t: { source: string; confidence: number | null }) => (t.source === 'ai' ? `AI${t.confidence != null ? ` · ${Math.round(Number(t.confidence) * 100)}%` : ''}` : t.source === 'seed' ? 'Starter rule' : 'Manual');
export const validHeading = (h: string) => /^[0-9]{4}$/.test(h.trim());
/** Usage per product type + status counts, as today. */
export function hsUsage(prods: readonly { hs_product_type_id: string | null; hs_code_status: string | null }[]) {
  const use = new Map<string, { total: number; suggested: number }>();
  for (const p of prods) {
    if (!p.hs_product_type_id) continue;
    const u = use.get(p.hs_product_type_id) ?? { total: 0, suggested: 0 };
    u.total++;
    if (p.hs_code_status === 'suggested') u.suggested++;
    use.set(p.hs_product_type_id, u);
  }
  const count = (st: string) => prods.filter((p) => p.hs_code_status === st).length;
  return { use, confirmed: count('confirmed'), suggested: count('suggested'), missing: count('missing') };
}

/* ───────── Categories & tags ───────── */

export const TAG_KINDS = ['general', 'feature', 'badge', 'use_case', 'service', 'certification'] as const;
export type CatRow = { id: string; name: string; slug: string; parent_id: string | null; level: number; hs_code: string | null; sort: number; active: boolean; products: number };
export type TagRow = { id: string; name: string; kind: string; products: number };
export function catTree(categories: readonly CatRow[]) {
  const children = new Map<string | null, CatRow[]>();
  for (const c of categories) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
  children.forEach((l) => l.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  const walk = (c: CatRow): number => {
    const n = c.products + (children.get(c.id) ?? []).reduce((a, k) => a + walk(k), 0);
    totals.set(c.id, n);
    return n;
  };
  (children.get(null) ?? []).forEach(walk);
  const pathOf = (id: string) => {
    const out: CatRow[] = [];
    let c = byId.get(id);
    while (c) {
      out.unshift(c);
      c = c.parent_id ? byId.get(c.parent_id) : undefined;
    }
    return out;
  };
  return { children, byId, totals, pathOf };
}
/** Merge targets: active, not itself, not inside its own subtree (today). */
export function mergeTargets(categories: readonly CatRow[], selId: string, pathOf: (id: string) => CatRow[]) {
  return categories.filter((c) => c.id !== selId && c.active && !pathOf(c.id).some((p) => p.id === selId));
}
export const slugPart = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
