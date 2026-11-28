/**
 * ODS T9 · Website screens (Site content · Advertising · Notifications · Currency) — pure logic, unit tested in
 * tests/unit/ods-office-website.test.ts. Same rules as today's pages (app/admin/{content,ads,notifications,currency}).
 */

// ───────────────────────── Site content ─────────────────────────

export const CONTENT_TABS = [
  ['terms', 'Terms & conditions'],
  ['pages', 'Pages'],
  ['blocks', 'Content blocks'],
  ['company', 'Company & branches'],
  ['home', 'Home page'],
  ['media', 'Media'],
] as const;
export type ContentTab = (typeof CONTENT_TABS)[number][0];
export const contentTab = (v: string | undefined): ContentTab => (CONTENT_TABS.some(([k]) => k === v) ? (v as ContentTab) : 'terms');

export type TermsSection = { no: number; title: string; body: string };
export type TermsVersion = { id: string; version: string; status: string; sections: TermsSection[]; publish_at: string | null; published_at: string | null; created_at: string };

/** Today's choice: the viewed version, else the working draft / in review, else scheduled, else live. */
export function termsView(versions: TermsVersion[], viewId?: string) {
  const live = versions.find((v) => v.status === 'published') ?? null;
  const working = versions.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null;
  const scheduled = versions.find((v) => v.status === 'scheduled') ?? null;
  const current = (viewId ? versions.find((v) => v.id === viewId) : undefined) ?? working ?? scheduled ?? live ?? null;
  return { live, working, scheduled, current, canEditCurrent: !!current && ['draft', 'in_review'].includes(current.status) };
}
export const sectionNo = (v: string | undefined) => Math.min(15, Math.max(1, Number(v) || 1));
export function termsSection(current: TermsVersion | null, no: number): TermsSection {
  return current?.sections.find((x) => x.no === no) ?? { no, title: `Section ${no}`, body: '' };
}
/** {{setting_key}} placeholders used in a section body (today's live-values chips). */
export const termsVars = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))];

/** Status words for content (pages / terms / banners). */
export const CONTENT_STATUS: Record<string, string> = { published: 'Live', draft: 'Draft', in_review: 'In review', scheduled: 'Scheduled', superseded: 'Superseded', archived: 'Archived', active: 'Active', inactive: 'Inactive' };
export const contentStatusTone = (s: string): 'success' | 'warning' | 'info' | 'neutral' => (s === 'published' || s === 'active' ? 'success' : s === 'in_review' ? 'warning' : s === 'scheduled' ? 'info' : 'neutral');

/** Page editor buttons, as today: a live legal page edited by a non-admin → only "Submit changes for Admin approval". */
export function pageIntents(p: { is_legal: boolean; status: string }, isAdmin: boolean): ('draft' | 'review' | 'publish' | 'proposal')[] {
  const legalLive = p.is_legal && ['published', 'scheduled'].includes(p.status);
  if (legalLive && !isAdmin) return ['proposal'];
  return ['draft', 'review', ...((!p.is_legal || isAdmin) ? (['publish'] as const) : [])];
}

export const HOME_FEATURES: readonly [string, string][] = [['rfq', 'RFQ'], ['pool', 'Group buy'], ['turnkey', 'Turnkey Projects'], ['dropship', 'Dropshipping'], ['3pl', '3PL & global shipping'], ['qc', 'QC inspection'], ['certification', 'Certification'], ['wallet', 'Wallet & escrow'], ['assistant', 'AI account manager'], ['api', 'API & integrations']];
export const featureOrder = (setting: unknown): string[] => (Array.isArray(setting) ? (setting as string[]) : HOME_FEATURES.map(([k]) => k));

/** Banner performance line (today: "n views · n clicks · x % CTR", 30 days). */
export function bannerStat(events: { banner_id: string | null; slot: string; event: string }[], pred: (e: { banner_id: string | null; slot: string; event: string }) => boolean): string {
  const ev = events.filter(pred);
  const imp = ev.filter((e) => e.event === 'impression').length;
  const clk = ev.filter((e) => e.event === 'click').length;
  return `${imp} views · ${clk} clicks${imp ? ` · ${((clk / imp) * 100).toFixed(1)} % CTR` : ''}`;
}

// ───────────────────────── Advertising ─────────────────────────

export const CAMPAIGN_LABEL: Record<string, string> = { in_review: 'Pending approval', active: 'Live', paused: 'Paused', rejected: 'Rejected', ended: 'Ended', draft: 'Draft' };
export const campaignTone = (s: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' => (s === 'active' ? 'success' : s === 'in_review' ? 'warning' : s === 'rejected' ? 'danger' : s === 'paused' ? 'info' : 'neutral');
/** Moderation buttons by status (today: approve / reject in review; pause, end when live; resume, end when paused). */
export function campaignActions(status: string): ('approve' | 'reject' | 'pause' | 'resume' | 'end')[] {
  if (status === 'in_review') return ['approve', 'reject'];
  if (status === 'active') return ['pause', 'end'];
  if (status === 'paused') return ['resume', 'end'];
  return [];
}
export const adsOn = (v: unknown) => v === true || v === 'true';

/** The 14 days ending today (UTC dates, oldest first), as today's "Clicks per day". */
export function last14Days(nowMs: number): string[] {
  return Array.from({ length: 14 }, (_, i) => new Date(nowMs - (13 - i) * 864e5).toISOString().slice(0, 10));
}
/** Paid / invalid clicks per day (charged amounts converted by `conv`). */
export function clicksPerDay<T extends { created_at: string; valid: boolean; charged_cents: number }>(clicks: T[], days: string[], conv: (c: T) => number) {
  const per = new Map(days.map((d) => [d, { clicks: 0, charged: 0, invalid: 0 }]));
  for (const c of clicks) {
    const d = per.get(c.created_at.slice(0, 10));
    if (!d) continue;
    if (c.valid && Number(c.charged_cents) > 0) {
      d.clicks++;
      d.charged += conv(c);
    } else d.invalid++;
  }
  return days.map((d) => ({ day: d, ...per.get(d)! }));
}
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ───────────────────────── Notifications ─────────────────────────

export type StaffNote = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
export const unreadCount = (rows: StaffNote[]) => rows.filter((n) => !n.read_at).length;
/** "Mark all as read" only covers what was shown: rows up to the newest shown (today's `seen`). */
export const seenStamp = (rows: StaffNote[]) => (rows.length ? rows[0].created_at : null);
export const notificationFilter = (v: string | undefined): 'all' | 'unread' => (v === 'unread' ? 'unread' : 'all');

// ───────────────────────── Currency ─────────────────────────

export type FxRow = { id: string; rate: number; effective_from: string; set_by: string | null; source: string; note: string | null; created_at: string };
export type SwitchRow = {
  id: string; from_currency: string; to_currency: string; rate: number; wallet_option: string; effective_at: string; status: string;
  impact: Record<string, unknown> | null; note: string | null; requested_by: string; approved_by: string | null; approved_at: string | null;
  applied_at: string | null; cancelled_at: string | null; created_at: string;
};
export const SWITCH_LABEL: Record<string, string> = { draft: 'Draft', pending_approval: 'Waiting for Finance', scheduled: 'Approved · scheduled', applied: 'Applied', cancelled: 'Cancelled' };
export const switchTone = (s: string): 'neutral' | 'warning' | 'info' | 'success' | 'danger' => ({ draft: 'neutral', pending_approval: 'warning', scheduled: 'info', applied: 'success', cancelled: 'danger' } as const)[s as 'draft'] ?? 'neutral';

/** Approved (manual, in force), upcoming (manual, future) and reference rates — today's rules; fallback 7.1 seed. */
export function rateSummary(rates: FxRow[], nowIso: string) {
  const approved = rates.find((r) => r.source === 'manual' && r.effective_from <= nowIso) ?? null;
  const upcoming = rates.filter((r) => r.source === 'manual' && r.effective_from > nowIso).at(-1) ?? null;
  const reference = rates.find((r) => r.source === 'reference') ?? null;
  const rate = Number(approved?.rate ?? 7.1);
  const diff = reference && approved ? ((Number(reference.rate) - rate) / rate) * 100 : null;
  return { approved, upcoming, reference, rate, diff };
}
/** Rate history status cell. */
export function rateStatus(r: FxRow, approvedId: string | null, nowIso: string): 'display' | 'in-use' | 'scheduled' | 'previous' {
  if (r.source !== 'manual') return 'display';
  if (r.id === approvedId) return 'in-use';
  return r.effective_from > nowIso ? 'scheduled' : 'previous';
}
/** Who may do what on a switch request (maker–checker, as today; the RPCs enforce it again). */
export function switchActions(r: Pick<SwitchRow, 'status' | 'requested_by'>, me: { userId: string; isAdmin: boolean; canApprove: boolean }) {
  const mine = r.requested_by === me.userId;
  const active = r.status === 'pending_approval' || r.status === 'scheduled';
  return {
    approve: r.status === 'pending_approval' && me.canApprove && !mine,
    otherMustApprove: r.status === 'pending_approval' && mine,
    cancel: active && (me.isAdmin || (me.canApprove && r.status === 'pending_approval')),
    mine,
  };
}
