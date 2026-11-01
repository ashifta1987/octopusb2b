'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { fail, failAt, guard, ok, type Result } from '@/components/admin/server';
import { parseCountryMap, parseOfficeHours, parseRules, parseTopics } from '@/components/admin/assistant/settings-schema';

const PATH = '/admin/assistant';

async function save(entries: [string, unknown][]): Promise<Result> {
  const g = await guard('assistant', 'configure');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can change assistant settings.');
  for (const [key, value] of entries) {
    const { error } = await g.sb.rpc('set_setting', { p_key: key, p_value: value });
    if (error) return failAt(error, PATH);
  }
  revalidateTag('site-content', 'max');
  revalidatePath(PATH);
  return ok('Saved');
}

export async function setAssistantEnabled(on: boolean): Promise<Result> {
  const r = await save([['assistant_enabled', on]]);
  return r.ok ? ok(on ? 'Octo is ON.' : 'Octo is OFF — customers see their account manager only.') : r;
}

export async function saveRules(_prev: Result | null, fd: FormData): Promise<Result> {
  const p = parseRules(Object.fromEntries(fd));
  if (!p.ok) return fail(p.error);
  const minRes = Number(fd.get('min_bot_resolution_rate'));
  const maxSla = Number(fd.get('max_sla_breach_rate'));
  if (!Number.isFinite(minRes) || minRes < 0 || minRes > 100 || !Number.isFinite(maxSla) || maxSla < 0 || maxSla > 100) return fail('Alert thresholds must be 0–100 %.');
  return save([
    ['assistant_confidence_threshold', p.value.confidence_threshold],
    ['assistant_max_customers_per_manager', p.value.max_customers_per_manager],
    ['assistant_escalation_sla_minutes', p.value.escalation_sla_minutes],
    ['assistant_rate_limit_per_min', p.value.rate_limit_per_min],
    ['assistant_cost_per_1k_tokens_usd', p.value.cost_per_1k_tokens_usd],
    ['assistant_alert_thresholds', { min_bot_resolution_rate: minRes, max_sla_breach_rate: maxSla }],
  ]);
}

export async function saveTopics(_prev: Result | null, fd: FormData): Promise<Result> {
  const p = parseTopics(String(fd.get('topics') ?? '[]'));
  if (!p.ok) return fail(p.error);
  return save([['assistant_sensitive_topics', p.value]]);
}

export async function saveCountryMap(_prev: Result | null, fd: FormData): Promise<Result> {
  const p = parseCountryMap(String(fd.get('rows') ?? '[]'), fd.get('default_team'));
  if (!p.ok) return fail(p.error);
  return save([['assistant_team_country_map', p.value]]);
}

export async function saveOfficeHours(_prev: Result | null, fd: FormData): Promise<Result> {
  const p = parseOfficeHours({ timezone: fd.get('timezone'), days: fd.getAll('days'), start: fd.get('start'), end: fd.get('end') });
  if (!p.ok) return fail(p.error);
  return save([['assistant_office_hours', p.value]]);
}
