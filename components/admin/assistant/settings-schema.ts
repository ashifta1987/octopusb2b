/** Validation for the assistant admin settings (SPEC §20.4). Pure — safe on server, client and in unit tests. */

export type OfficeHours = { timezone: string; days: number[]; start: string; end: string };
export type AssistantRules = {
  confidence_threshold: number;
  max_customers_per_manager: number;
  escalation_sla_minutes: number;
  rate_limit_per_min: number;
  cost_per_1k_tokens_usd: number;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CC = /^[A-Z]{2}$/;

/** Sensitive-topic chips: trimmed, lower-case, 2–40 chars, de-duplicated, max 50. */
export function parseTopics(input: unknown): Ok<string[]> | Err {
  let arr: unknown = input;
  if (typeof input === 'string') {
    try { arr = JSON.parse(input); } catch { return { ok: false, error: 'Topics must be a list.' }; }
  }
  if (!Array.isArray(arr)) return { ok: false, error: 'Topics must be a list.' };
  const out: string[] = [];
  for (const t of arr) {
    if (typeof t !== 'string') return { ok: false, error: 'Each topic must be text.' };
    const v = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!v) continue;
    if (v.length < 2 || v.length > 40) return { ok: false, error: `Topic “${v}” must be 2–40 characters.` };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > 50) return { ok: false, error: 'At most 50 topics.' };
  if (!out.length) return { ok: false, error: 'Keep at least one sensitive topic.' };
  return { ok: true, value: out };
}

/** Team–country map: [{country, team}] rows (+ default team) → {"default": team, "<CC>": team}. */
export function parseCountryMap(rows: unknown, defaultTeam: unknown): Ok<Record<string, string>> | Err {
  let list: unknown = rows;
  if (typeof rows === 'string') {
    try { list = JSON.parse(rows); } catch { return { ok: false, error: 'Invalid team map.' }; }
  }
  if (!Array.isArray(list)) return { ok: false, error: 'Invalid team map.' };
  const def = typeof defaultTeam === 'string' ? defaultTeam.trim() : '';
  if (!def || def.length > 40) return { ok: false, error: 'Enter a default team (max 40 characters).' };
  const map: Record<string, string> = { default: def };
  for (const r of list) {
    const row = r as { country?: unknown; team?: unknown };
    const cc = typeof row?.country === 'string' ? row.country.trim().toUpperCase() : '';
    const team = typeof row?.team === 'string' ? row.team.trim() : '';
    if (!cc && !team) continue;
    if (!CC.test(cc)) return { ok: false, error: `“${cc || '(blank)'}” is not a 2-letter country code.` };
    if (!team || team.length > 40) return { ok: false, error: `Enter a team for ${cc} (max 40 characters).` };
    if (map[cc]) return { ok: false, error: `${cc} is listed twice.` };
    map[cc] = team;
  }
  return { ok: true, value: map };
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

export function parseRules(src: Record<string, unknown>): Ok<AssistantRules> | Err {
  const thr = num(src.confidence_threshold);
  if (!Number.isFinite(thr) || thr < 0 || thr > 1) return { ok: false, error: 'Confidence threshold must be between 0 and 1.' };
  const cap = num(src.max_customers_per_manager);
  if (!Number.isInteger(cap) || cap < 1 || cap > 1000) return { ok: false, error: 'Max customers per manager must be a whole number 1–1000.' };
  const sla = num(src.escalation_sla_minutes);
  if (!Number.isInteger(sla) || sla < 5 || sla > 10080) return { ok: false, error: 'Escalation SLA must be 5–10080 minutes.' };
  const rate = num(src.rate_limit_per_min);
  if (!Number.isInteger(rate) || rate < 1 || rate > 600) return { ok: false, error: 'Rate limit must be 1–600 messages per minute.' };
  const cost = num(src.cost_per_1k_tokens_usd);
  if (!Number.isFinite(cost) || cost < 0 || cost > 10) return { ok: false, error: 'Cost per 1k tokens must be between 0 and 10 USD.' };
  return { ok: true, value: { confidence_threshold: Math.round(thr * 100) / 100, max_customers_per_manager: cap, escalation_sla_minutes: sla, rate_limit_per_min: rate, cost_per_1k_tokens_usd: cost } };
}

export function parseOfficeHours(src: { timezone?: unknown; days?: unknown; start?: unknown; end?: unknown }): Ok<OfficeHours> | Err {
  const tz = typeof src.timezone === 'string' ? src.timezone.trim() : '';
  if (!tz) return { ok: false, error: 'Choose a timezone.' };
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { return { ok: false, error: `Unknown timezone “${tz}”.` }; }
  const days = (Array.isArray(src.days) ? src.days : []).map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  if (!uniq.length) return { ok: false, error: 'Pick at least one working day.' };
  const start = typeof src.start === 'string' ? src.start : '';
  const end = typeof src.end === 'string' ? src.end : '';
  if (!TIME.test(start) || !TIME.test(end)) return { ok: false, error: 'Times must be HH:MM.' };
  if (start >= end) return { ok: false, error: 'End time must be after the start time.' };
  return { ok: true, value: { timezone: tz, days: uniq, start, end } };
}

/** Add/remove an org id in the VIP list (idempotent). */
export function toggleVip(list: unknown, orgId: string, on: boolean): string[] {
  const cur = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  const without = cur.filter((x) => x !== orgId);
  return on ? [...without, orgId] : without;
}

/** Estimated model cost in USD (tokens × price per 1k). */
export function estimateCost(tokens: number | null | undefined, per1k: number): number {
  const t = Number(tokens ?? 0);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(per1k) || per1k <= 0) return 0;
  return Math.round((t / 1000) * per1k * 10000) / 10000;
}

export const WEEKDAYS: { n: number; label: string }[] = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];
