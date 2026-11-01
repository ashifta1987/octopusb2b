import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getContextCounts, pageHint } from './context';
import { isWithinOfficeHours, officeHoursLabel } from './escalation';
import { getAssistantSettings } from './settings';
import { getAccountTeam } from './team';
import { MESSAGE_COLUMNS, type AccountTeam, type AssistantMessage, type ContextCounts } from './types';

/** Initial state for a conversation view (page or drawer). All reads use the customer's client (RLS). */
export type Bootstrap = {
  enabled: boolean;
  session: { id: string; status: string; started_at: string; title: string | null } | null;
  messages: AssistantMessage[];
  team: AccountTeam | null;
  withinHours: boolean;
  hoursLabel: string | null;
  counts: ContextCounts;
  hint: { hint: string; prompt: string } | null;
  orgName: string;
  handoffTopics: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadBootstrap(sb: SupabaseClient, org: { id: string; name: string }, opts: { sessionId?: string | null; page?: string | null } = {}): Promise<Bootstrap> {
  const sid = opts.sessionId && UUID_RE.test(opts.sessionId) ? opts.sessionId : null;
  const [settings, team, counts, hint, sessRes, msgRes] = await Promise.all([
    getAssistantSettings(),
    getAccountTeam(sb),
    getContextCounts(sb, org.id),
    pageHint(sb, opts.page),
    sid ? sb.from('assistant_sessions').select('id, status, started_at, title').eq('id', sid).maybeSingle() : Promise.resolve({ data: null }),
    sid ? sb.from('assistant_messages').select(MESSAGE_COLUMNS).eq('session_id', sid).order('created_at').limit(300) : Promise.resolve({ data: [] }),
  ]);
  const session = (sessRes.data as Bootstrap['session']) ?? null;
  return {
    enabled: settings.enabled,
    session,
    messages: session ? ((msgRes.data ?? []) as AssistantMessage[]) : [],
    team,
    withinHours: isWithinOfficeHours(settings.officeHours),
    hoursLabel: team?.hours_label ?? officeHoursLabel(settings.officeHours),
    counts,
    hint,
    orgName: org.name,
    handoffTopics: settings.topics,
  };
}
