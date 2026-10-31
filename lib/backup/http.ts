import 'server-only';
import { NextResponse } from 'next/server';
import { can, getSession, type Session } from '@/lib/auth';

/** JSON helpers for the /api/backups and /api/exports routes: `{ ok: true, … } | { ok: false, error }` (contract in docs/AGENT_BRIEF_16.md). */
export function ok(data: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Session + `backups:<action>` permission gate. Admins pass automatically. */
export async function gate(action: string): Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: fail('UNAUTHORIZED', 401) };
  if (!can(session, 'backups', action)) return { response: fail('FORBIDDEN', 403) };
  return { session };
}

/** "INVALID_TRANSITION: approved" → { code: 'INVALID_TRANSITION', message } — UI maps the code. */
export function dbError(e: { message?: string } | null | undefined) {
  const message = e?.message ?? 'Unknown error';
  const m = /^([A-Z][A-Z0-9_]{2,})\b/.exec(message);
  return { code: m ? m[1] : 'DB_ERROR', message };
}

export function failDb(e: { message?: string } | null | undefined, extra: Record<string, unknown> = {}) {
  const { code, message } = dbError(e);
  const status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'MFA_REQUIRED' ? 401 : code === 'DB_ERROR' ? 500 : 409;
  return fail(code, status, { message, ...extra });
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
