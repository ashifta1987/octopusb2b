import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { Session } from '@/lib/auth';

/**
 * Divisions step 4 (19 Nov 2026) — the Admin division switcher.
 * The choice ("All divisions" or one division) is kept in a cookie and validated on every request against the
 * divisions this person may see: company-wide roles (admin, finance, support) every division, everyone else only the
 * divisions they are a member of. Row-level security still decides what can be read; the switcher only narrows it.
 */
import { DIVISION_COOKIE, COMPANY_WIDE_ROLES, type Division, type DivisionScope } from './shared';
export { DIVISION_COOKIE, COMPANY_WIDE_ROLES, divisionCodeForService, type Division, type DivisionScope } from './shared';

export const isCompanyWide = (s: Session) => s.roles.some((r) => (COMPANY_WIDE_ROLES as readonly string[]).includes(r));

/** Divisions this staff member may switch to (active ones; inactive stay visible to company-wide roles only). */
export async function staffDivisions(s: Session): Promise<Division[]> {
  const sb = await createClient();
  const { data: divs } = await sb.from('divisions').select('id, code, name, sort_order, logo_key, status').order('sort_order').order('name');
  const all = (divs ?? []) as Division[];
  if (isCompanyWide(s)) return all;
  const { data: mine } = await sb.from('division_members').select('division_id').eq('user_id', s.userId);
  const ids = new Set((mine ?? []).map((m) => m.division_id as string));
  return all.filter((d) => ids.has(d.id) && d.status === 'active');
}

/** The current switcher choice for this request. Unknown / not-allowed values fall back to "All divisions". */
export async function getDivisionScope(s: Session): Promise<DivisionScope> {
  const options = await staffDivisions(s);
  const code = (await cookies()).get(DIVISION_COOKIE)?.value;
  const division = code && code !== 'all' ? options.find((d) => d.code === code) ?? null : null;
  return division ? { all: false, division, options } : { all: true, division: null, options };
}

/** Narrow a Supabase query to the chosen division (no-op for "All divisions"). */
export function inScope<Q extends { eq: (col: string, v: string) => Q }>(q: Q, scope: DivisionScope, column = 'division_id'): Q {
  return scope.all ? q : q.eq(column, scope.division.id);
}

