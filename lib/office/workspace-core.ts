/**
 * ODS T8 · Back Office data — pure helpers shared by the server modules, server actions, the SHELL (client) and unit tests.
 * No `server-only`, no Supabase: safe in client components.
 */
import { mapDbError } from '@/lib/format';

// ───────────────────────── results + errors ─────────────────────────

/** Result of every lib/office/* call and app/ods/office/_actions/* action. */
export type OfficeResult<T> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      /** friendly text for the user */
      error: string;
      /** the database code (FORBIDDEN, MAKER_CANNOT_APPROVE …) */
      code?: string;
      /** step-up needed: send the user here (re-enter the 2FA code), then back */
      redirect?: string;
      /** the T8 migration (254/255/256) is not applied yet: keep working from localStorage / hide the feature */
      unavailable?: true;
    };

export const okResult = <T,>(data: T, message?: string): OfficeResult<T> => ({ ok: true, data, message });

type DbErr = { message?: string; code?: string; details?: string; hint?: string } | string | null | undefined;

const errText = (e: DbErr) => (typeof e === 'string' ? e : [e?.message, e?.code, e?.details, e?.hint].filter(Boolean).join(' '));

/** True when the table / function does not exist yet (migration not applied): Postgres 42P01 / 42883 or PostgREST PGRST202 / PGRST205. */
export function isMissingObjectError(e: DbErr): boolean {
  if (!e) return false;
  const code = typeof e === 'string' ? '' : e.code ?? '';
  if (['42P01', '42883', 'PGRST202', 'PGRST205', 'PGRST200'].includes(code)) return true;
  return /relation "?[\w.]+"? does not exist|function [\w.]+\(.*\) does not exist|could not find the (function|table)|in the schema cache/i.test(errText(e));
}

/** Text after "CODE: " in a raised exception, first letter upper-cased. */
function detail(raw: string): string {
  const i = raw.indexOf(':');
  const d = i < 0 ? '' : raw.slice(i + 1).trim();
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : '';
}

const FRIENDLY: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again.',
  STAFF_ONLY: 'Only Octopus staff signed in with their 2-step code can do this.',
  FORBIDDEN: 'You do not have permission to do this.',
  NOT_FOUND: 'Not found. It may have been removed.',
  MAKER_CANNOT_APPROVE: 'You recorded this, so a different person must approve it.',
  INVALID_TRANSITION: 'This was already decided.',
  INVALID_AMOUNT: 'Enter an amount above zero.',
  VIEW_LIMIT: 'You have 50 views on this page. Delete one first.',
  APPROVALS_APPEND_ONLY: 'Approvals are never deleted.',
  APPROVAL_DECIDED: 'This approval was already decided.',
  OVER_LIMIT_NEEDS_ADMIN: 'This amount is over the Finance approval limit and needs an Admin.',
};

/** The DB error code (text before the first colon). */
export function errorCode(e: DbErr): string {
  const raw = typeof e === 'string' ? e : e?.message ?? '';
  return raw.split(':')[0].trim();
}

/** Maps a database / RPC error to an OfficeResult failure with a friendly message. `stepUpPath` = where to come back after the 2FA code. */
export function officeFail<T = never>(e: DbErr, stepUpPath = '/office'): OfficeResult<T> {
  const raw = typeof e === 'string' ? e : e?.message ?? 'Something went wrong';
  const code = errorCode(raw);
  if (isMissingObjectError(e)) return { ok: false, error: 'This part of the Back Office is not switched on yet.', code: 'UNAVAILABLE', unavailable: true };
  if (/STEP_UP_REQUIRED|MFA_REQUIRED/.test(raw)) {
    return { ok: false, error: 'Enter your 2-step code again to continue.', code: 'STEP_UP_REQUIRED', redirect: `/staff/verify?next=${encodeURIComponent(stepUpPath)}&reason=step_up` };
  }
  if (FRIENDLY[code]) return { ok: false, error: FRIENDLY[code], code };
  if (['INVALID_INPUT', 'VIEW_NAME_TAKEN', 'ROLE_NOT_ALLOWED', 'APPROVAL_PENDING', 'REASON_REQUIRED', 'INVALID_TARGET', 'NOT_STAFF', 'INVALID_ROLE'].includes(code)) {
    return { ok: false, error: detail(raw) || (code === 'REASON_REQUIRED' ? 'Add a reason.' : 'Check the details and try again.'), code };
  }
  if (/row-level security|permission denied/i.test(raw)) return { ok: false, error: FRIENDLY.FORBIDDEN, code: 'FORBIDDEN' };
  return { ok: false, error: mapDbError({ message: raw }), code: code || undefined };
}

// ───────────────────────── workspace tabs + prefs ─────────────────────────

export type WorkspaceTab = {
  id: string;
  /** a real route (public URL: /office/…, /admin/…) */
  href: string;
  title: string;
  icon?: string;
  pinned?: boolean;
  filters?: Record<string, unknown>;
  scrollY?: number;
  openedAt?: number;
};

export type UiPrefs = {
  sidebarCollapsed: boolean;
  density: 'compact' | 'comfortable' | null;
  groupsCollapsed: string[];
  extra: Record<string, unknown>;
};

export type WorkspaceState = {
  tabs: WorkspaceTab[];
  activeId: string | null;
  prefs: UiPrefs;
  /** 'local-only' = the tables are not there yet (or no staff session): use localStorage alone */
  source: 'db' | 'local-only';
  updatedAt: string | null;
};

/** At most 12 open tabs besides the pinned Dashboard (Part 7.1). */
export const MAX_OPEN_TABS = 12;
export const DASHBOARD_TAB: WorkspaceTab = { id: 'dashboard', href: '/office', title: 'Dashboard', icon: 'home', pinned: true };
export const DEFAULT_PREFS: UiPrefs = { sidebarCollapsed: false, density: null, groupsCollapsed: [], extra: {} };

export const localTabsKey = (userId: string) => `octopus.office.tabs.v1:${userId}`;
export const localPrefsKey = (userId: string) => `octopus.office.prefs.v1:${userId}`;

/** An app path: starts with one "/" (never "//host" or "/\host"), no scheme, ≤ 500 chars. */
export function isAppPath(href: unknown): href is string {
  return typeof href === 'string' && href.length <= 500 && /^\/([^/\\]|$)/.test(href) && ![...href].some((ch) => ch.charCodeAt(0) < 32);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Cleans tabs from localStorage / the database / the client before use or save: valid ids / paths / titles only, duplicates
 * dropped, the Dashboard pinned first, at most MAX_OPEN_TABS others (the newest kept), sizes capped like the database checks.
 */
export function normalizeTabs(raw: unknown): WorkspaceTab[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: WorkspaceTab[] = [];
  for (const t of list) {
    if (!isObj(t)) continue;
    const id = typeof t.id === 'string' ? t.id.trim().slice(0, 80) : '';
    const title = typeof t.title === 'string' ? t.title.trim().slice(0, 200) : '';
    if (!id || !title || !isAppPath(t.href) || seen.has(id) || id === DASHBOARD_TAB.id) continue;
    seen.add(id);
    const tab: WorkspaceTab = { id, href: t.href, title };
    if (typeof t.icon === 'string' && t.icon.length <= 40) tab.icon = t.icon;
    if (t.pinned === true) tab.pinned = true;
    if (isObj(t.filters) && JSON.stringify(t.filters).length <= 2000) tab.filters = t.filters;
    if (typeof t.scrollY === 'number' && Number.isFinite(t.scrollY) && t.scrollY >= 0) tab.scrollY = Math.round(t.scrollY);
    if (typeof t.openedAt === 'number' && Number.isFinite(t.openedAt)) tab.openedAt = t.openedAt;
    out.push(tab);
  }
  // over the limit: close the oldest unpinned tabs first; the rest keep their order
  const drop = new Set<WorkspaceTab>();
  while (out.length - drop.size > MAX_OPEN_TABS) {
    const o = oldestUnpinned(out.filter((t) => !drop.has(t)));
    if (!o) break;
    drop.add(o);
  }
  return [DASHBOARD_TAB, ...out.filter((t) => !drop.has(t)).slice(0, MAX_OPEN_TABS)];
}

/** The tab to close when a 13th is opened: the unpinned one opened longest ago (else the first unpinned). */
export function oldestUnpinned(tabs: WorkspaceTab[]): WorkspaceTab | null {
  const free = tabs.filter((t) => !t.pinned && t.id !== DASHBOARD_TAB.id);
  if (!free.length) return null;
  return free.reduce((a, b) => ((b.openedAt ?? Infinity) < (a.openedAt ?? Infinity) ? b : a), free[0]);
}

/** The active id if that tab is open, else the Dashboard. */
export function activeOrDashboard(tabs: WorkspaceTab[], activeId: string | null | undefined): string {
  return activeId && tabs.some((t) => t.id === activeId) ? activeId : DASHBOARD_TAB.id;
}

/** Database row (ui_prefs / save_ui_prefs result) → UiPrefs. */
export function prefsFromRow(row: unknown): UiPrefs {
  if (!isObj(row)) return { ...DEFAULT_PREFS };
  const d = row.density_override;
  return {
    sidebarCollapsed: row.sidebar_collapsed === true,
    density: d === 'compact' || d === 'comfortable' ? d : null,
    groupsCollapsed: Array.isArray(row.groups_collapsed) ? row.groups_collapsed.filter((g): g is string => typeof g === 'string').slice(0, 40) : [],
    extra: isObj(row.extra) ? row.extra : {},
  };
}

/** UiPrefs patch → the save_ui_prefs payload (snake_case, only the keys given; extra merged key by key on the server). */
export function prefsPatchPayload(patch: Partial<UiPrefs>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (patch.sidebarCollapsed !== undefined) p.sidebar_collapsed = !!patch.sidebarCollapsed;
  if (patch.density !== undefined) p.density_override = patch.density;
  if (patch.groupsCollapsed !== undefined) p.groups_collapsed = [...new Set(patch.groupsCollapsed.filter((g) => typeof g === 'string' && g.length >= 1 && g.length <= 40))].slice(0, 40);
  if (patch.extra !== undefined) p.extra = patch.extra;
  return p;
}

/** Local merge with the same rules as the server (extra merged; null removes a key). */
export function mergePrefs(base: UiPrefs, patch: Partial<UiPrefs>): UiPrefs {
  const extra = { ...base.extra, ...(patch.extra ?? {}) };
  for (const k of Object.keys(extra)) if (extra[k] === null) delete extra[k];
  return {
    sidebarCollapsed: patch.sidebarCollapsed ?? base.sidebarCollapsed,
    density: patch.density !== undefined ? patch.density : base.density,
    groupsCollapsed: patch.groupsCollapsed ?? base.groupsCollapsed,
    extra,
  };
}

// ───────────────────────── saved views ─────────────────────────

export type SavedView = {
  id: string;
  page: string;
  name: string;
  scope: 'personal' | 'shared';
  sharedRole: string | null;
  filters: Record<string, unknown> | unknown[];
  columns: string[];
  sort: unknown;
  isDefault: boolean;
  /** created by the signed-in user (they may edit / delete it) */
  mine: boolean;
  updatedAt: string;
};

export type SaveViewInput = {
  id?: string | null;
  page: string;
  name: string;
  scope: 'personal' | 'shared';
  sharedRole?: string | null;
  filters?: Record<string, unknown> | unknown[];
  columns?: string[];
  sort?: unknown;
  isDefault?: boolean;
};

/** Grid page key from a pathname: "/office/accounts/invoices?x" → "/office/accounts/invoices" (lower-case, no ids with capitals). */
export function viewPageKey(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] || '/').toLowerCase().replace(/\/+$/, '') || '/';
  return /^\/[a-z0-9/_-]{1,119}$/.test(p) ? p : '/office';
}

export function viewFromRow(r: Record<string, unknown>, userId: string | null): SavedView {
  return {
    id: String(r.id),
    page: String(r.page),
    name: String(r.name),
    scope: r.scope === 'shared' ? 'shared' : 'personal',
    sharedRole: (r.shared_role as string | null) ?? null,
    filters: (r.filters as SavedView['filters']) ?? {},
    columns: Array.isArray(r.columns) ? (r.columns as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    sort: r.sort ?? [],
    isDefault: r.is_default === true,
    mine: !!userId && r.user_id === userId,
    updatedAt: String(r.updated_at ?? ''),
  };
}

/** Mine first (default first), then shared; by name. */
export function sortViews(views: SavedView[]): SavedView[] {
  return [...views].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

// ───────────────────────── approvals ─────────────────────────

export type ApprovalSource = 'staff_approvals' | 'finance_approvals' | 'escrow_hold_approvals' | 'customer_credit_terms';
export const APPROVAL_SOURCES: ApprovalSource[] = ['staff_approvals', 'finance_approvals', 'escrow_hold_approvals', 'customer_credit_terms'];
export type StaffApprovalKind = 'payment' | 'refund' | 'credit_note' | 'supplier_payment' | 'wallet_adjustment' | 'pay_later';

export type ApprovalItem = {
  source: ApprovalSource;
  id: string;
  /** APR-00001 for staff approvals; null for the existing tables */
  code: string | null;
  kind: string;
  status: 'waiting' | 'approved' | 'rejected';
  amountMinor: number;
  currency: string;
  reason: string;
  orgId: string | null;
  orgName: string | null;
  refType: string | null;
  refId: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** waiting, I hold finance:approve and I did not record it */
  canDecide: boolean;
  /** I recorded it */
  mine: boolean;
};

export function approvalFromRow(r: Record<string, unknown>, userId: string | null): ApprovalItem {
  const st = r.status === 'approved' || r.status === 'rejected' ? r.status : 'waiting';
  return {
    source: (APPROVAL_SOURCES as string[]).includes(String(r.source)) ? (r.source as ApprovalSource) : 'staff_approvals',
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    kind: String(r.kind ?? ''),
    status: st,
    amountMinor: Number(r.amount_minor ?? 0),
    currency: String(r.currency ?? 'USD').trim(),
    reason: String(r.reason ?? ''),
    orgId: (r.org_id as string | null) ?? null,
    orgName: (r.org_name as string | null) ?? null,
    refType: (r.ref_type as string | null) ?? null,
    refId: (r.ref_id as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null,
    requestedByName: (r.requested_by_name as string | null) ?? null,
    requestedAt: String(r.requested_at ?? ''),
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedByName: (r.decided_by_name as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    canDecide: r.can_decide === true,
    mine: !!userId && r.requested_by === userId,
  };
}

/**
 * Which database function decides an item, with its arguments. The three existing tables are decided by TODAY's functions,
 * unchanged (they run the money step themselves); staff approvals by staff_approval_decide (records only).
 */
export function decideCall(source: ApprovalSource, id: string, approve: boolean, note: string | null, ip: string | null): { fn: string; args: Record<string, unknown> } {
  const n = note?.trim() ? note.trim().slice(0, 1000) : null;
  switch (source) {
    case 'staff_approvals': return { fn: 'staff_approval_decide', args: { p_id: id, p_approve: approve, p_note: n, p_ip: ip } };
    case 'finance_approvals': return { fn: 'decide_finance_approval', args: { p_id: id, p_approve: approve, p_note: n } };
    case 'escrow_hold_approvals': return { fn: 'decide_escrow_hold_approval', args: { p_approval_id: id, p_approve: approve, p_note: n } };
    case 'customer_credit_terms': return { fn: 'decide_customer_credit_terms', args: { p_terms_id: id, p_approve: approve, p_note: n } };
  }
}

/** First address of x-forwarded-for (else x-real-ip), only if it looks like an IP. */
export function clientIpFrom(forwardedFor: string | null | undefined, realIp?: string | null): string | null {
  const first = (forwardedFor ?? '').split(',')[0]?.trim() || (realIp ?? '').trim();
  if (!first || first.length > 45) return null;
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(first) && first.split('.').every((n) => Number(n) <= 255);
  const v6 = /^[0-9a-f:]+$/i.test(first) && first.includes(':');
  return v4 || v6 ? first : null;
}

// ───────────────────────── staff notifications ─────────────────────────

export type StaffNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
  readAt: string | null;
  /** role-wide alert (e.g. 'finance'); null = to me personally */
  forRole: string | null;
};

export function notificationFromRow(r: Record<string, unknown>): StaffNotification {
  return {
    id: String(r.id),
    kind: String(r.kind ?? ''),
    title: String(r.title ?? ''),
    body: (r.body as string | null) ?? null,
    link: isAppPath(r.link) ? r.link : null,
    refType: (r.ref_type as string | null) ?? null,
    refId: (r.ref_id as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    readAt: (r.read_at as string | null) ?? null,
    forRole: (r.for_role as string | null) ?? null,
  };
}
