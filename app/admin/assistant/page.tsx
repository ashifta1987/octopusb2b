import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, Stat, StatusBadge, Table } from '@/components/ui';
import { ActionForm, ToggleSetting } from '@/components/admin/client';
import { Bar, Field, Tabs } from '@/components/admin/ui';
import { nowMs } from '@/components/admin/server';
import { loadAssistantSettings, loadWorkload } from '@/components/admin/assistant/data';
import { CountryMapEditor, TopicsEditor } from '@/components/admin/assistant/editors';
import { ReassignButton } from '@/components/admin/assistant/reassign-form';
import { WEEKDAYS, estimateCost } from '@/components/admin/assistant/settings-schema';
import { fmtDate, humanize } from '@/lib/format';
import { saveCountryMap, saveOfficeHours, saveRules, saveTopics, setAssistantEnabled } from './actions';

export const metadata = { title: 'Assistant' };

const RANGES = [{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }];
const TIMEZONES = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/Amsterdam', 'Europe/London', 'America/New_York', 'UTC'];

type Metrics = {
  sessions: number; resolved_by_bot: number; escalated: number; bot_resolution_rate: number | null; escalation_rate: number | null; satisfaction: number | null;
  sla_breaches: number; sla_breach_rate: number | null; avg_latency_ms: number | null; tokens: number;
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const usd4 = (v: number) => `US$${v.toFixed(v < 1 ? 4 : 2)}`;

/** Admin → Assistant (SPEC §20.4/§20.5): switch, rules, topics, team map, office hours, workload, assignments, reports. */
export default async function AdminAssistantPage({ searchParams }: { searchParams: Promise<{ range?: string; aq?: string }> }) {
  const s = await requireStaff('assistant', 'configure', '/admin/assistant');
  const { range = '30', aq = '' } = await searchParams;
  const days = ['7', '30', '90'].includes(range) ? Number(range) : 30;
  const sb = await createClient();
  const now = nowMs();
  const from = new Date(now - days * 86_400_000).toISOString();
  const to = new Date(now).toISOString();

  const [settings, workload, { data: metricsRaw, error: metricsErr }, { data: ams }, { data: lastRun }] = await Promise.all([
    loadAssistantSettings(sb),
    loadWorkload(sb),
    sb.rpc('assistant_metrics', { p_from: from, p_to: to }),
    sb.from('account_managers').select('org_id, staff_user_id, team, assigned_at, reason, organizations(name, buyer_code, country)').order('assigned_at', { ascending: false }).limit(500),
    sb.from('integration_logs').select('status, summary, created_at').eq('integration_code', 'assistant').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const m = (metricsRaw ?? null) as Metrics | null;
  const cost = estimateCost(m?.tokens, settings.costPer1k);
  const perConv = m?.sessions ? cost / m.sessions : 0;
  const readOnly = !s.isAdmin;

  const staffName = new Map(workload.map((w) => [w.id, w.name]));
  const missing = [...new Set((ams ?? []).map((a) => a.staff_user_id as string).filter((id) => !staffName.has(id)))];
  if (missing.length) {
    const { data: extra } = await sb.from('profiles').select('id, full_name').in('id', missing);
    for (const p of extra ?? []) staffName.set(p.id as string, p.full_name as string);
  }
  const term = aq.trim().toLowerCase();
  const assignments = (ams ?? []).map((a) => {
    const o = (Array.isArray(a.organizations) ? a.organizations[0] : a.organizations) as { name: string; buyer_code: string | null; country: string | null } | null;
    return { ...a, org: o, manager: staffName.get(a.staff_user_id as string) ?? 'Staff' };
  }).filter((a) => !term || [a.org?.name, a.org?.buyer_code, a.org?.country, a.manager, a.team].some((x) => (x ?? '').toString().toLowerCase().includes(term)));
  const teams = [...new Set([...workload.map((w) => w.team).filter(Boolean) as string[], ...Object.values(settings.countryMap)])];
  const lowRes = m?.bot_resolution_rate != null && m.sessions > 0 && m.bot_resolution_rate < settings.alerts.min_bot_resolution_rate;
  const highSla = m?.sla_breach_rate != null && m.sla_breach_rate > settings.alerts.max_sla_breach_rate;

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Octo (AI assistant) and the dedicated account managers behind it."
        actions={
          <span className="inline-flex items-center gap-3">
            <span className="font-semibold text-sm">Octo</span>
            <ToggleSetting checked={settings.enabled} label="AI assistant Octo" onToggle={setAssistantEnabled} showText disabled={readOnly} />
          </span>
        }
      />
      {readOnly && <div className="mb-6"><Notice tone="amber">Settings are read-only — only an Admin can change them.</Notice></div>}
      {!settings.enabled && <div className="mb-6"><Notice tone="amber">Octo is <strong>OFF</strong>. Customers cannot start new assistant conversations; they still see their account manager.</Notice></div>}

      <section aria-labelledby="rep" className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="rep" className="text-xl font-semibold">Reports</h2>
          <span className="text-xs text-muted">{lastRun ? <>Last daily check {fmtDate(lastRun.created_at as string, true)} · {lastRun.status === 200 ? 'OK' : 'alert sent'}</> : 'Daily check has not run yet.'}</span>
        </div>
        <Tabs tabs={RANGES} active={String(days)} base="/admin/assistant" param="range" />
        {metricsErr ? <Notice tone="red">Could not load metrics: {metricsErr.message}</Notice> : !m || !m.sessions ? (
          <div className="card p-6"><EmptyState title="No conversations in this period" body="Metrics appear once customers start talking to Octo." /></div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Bot resolution rate" value={pct(m.bot_resolution_rate)} hint={lowRes ? `Below ${settings.alerts.min_bot_resolution_rate}% target` : `${m.resolved_by_bot} of ${m.sessions} conversations`} hintTone={lowRes ? 'bad' : 'ok'} />
              <Stat label="Escalation rate" value={pct(m.escalation_rate)} hint={`${m.escalated} handed to a human`} />
              <Stat label="Satisfaction" value={pct(m.satisfaction)} hint="Thumbs up on Octo replies" />
              <Stat label="SLA breach rate" value={pct(m.sla_breach_rate)} hint={highSla ? `Above ${settings.alerts.max_sla_breach_rate}% limit · ${m.sla_breaches} breaches` : `${m.sla_breaches} breaches`} hintTone={highSla ? 'bad' : 'ok'} />
              <Stat label="Avg bot latency" value={m.avg_latency_ms != null ? `${(Number(m.avg_latency_ms) / 1000).toFixed(1)} s` : '—'} />
              <Stat label="Tokens" value={Number(m.tokens ?? 0).toLocaleString('en-US')} hint={`@ US$${settings.costPer1k} per 1k`} />
              <Stat label="Estimated model cost" value={usd4(cost)} hint={`${days} days`} />
              <Stat label="Cost per conversation" value={usd4(perConv)} hint={`${m.sessions} conversations`} />
            </div>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <Card title="Rules">
          <ActionForm action={saveRules} submitLabel="Save rules" hideSubmit={readOnly}>
            <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
              <Field label="Confidence threshold (0–1)" htmlFor="r-thr" hint="Escalate after 3 bot turns in a row below this.">
                <input id="r-thr" name="confidence_threshold" type="number" min={0} max={1} step={0.01} defaultValue={settings.threshold} className="input" required />
              </Field>
              <Field label="Max customers per manager" htmlFor="r-cap">
                <input id="r-cap" name="max_customers_per_manager" type="number" min={1} max={1000} step={1} defaultValue={settings.cap} className="input" required />
              </Field>
              <Field label="Escalation SLA (minutes)" htmlFor="r-sla" hint="First human response target.">
                <input id="r-sla" name="escalation_sla_minutes" type="number" min={5} max={10080} step={1} defaultValue={settings.slaMinutes} className="input" required />
              </Field>
              <Field label="Rate limit (messages / min / customer)" htmlFor="r-rate">
                <input id="r-rate" name="rate_limit_per_min" type="number" min={1} max={600} step={1} defaultValue={settings.rateLimit} className="input" required />
              </Field>
              <Field label="Model cost per 1k tokens (USD)" htmlFor="r-cost" hint="Used for the cost estimate in reports.">
                <input id="r-cost" name="cost_per_1k_tokens_usd" type="number" min={0} max={10} step={0.0001} defaultValue={settings.costPer1k} className="input" required />
              </Field>
              <div />
              <Field label="Alert if bot resolution below (%)" htmlFor="r-ares">
                <input id="r-ares" name="min_bot_resolution_rate" type="number" min={0} max={100} step={1} defaultValue={settings.alerts.min_bot_resolution_rate} className="input" required />
              </Field>
              <Field label="Alert if SLA breaches above (%)" htmlFor="r-asla">
                <input id="r-asla" name="max_sla_breach_rate" type="number" min={0} max={100} step={0.5} defaultValue={settings.alerts.max_sla_breach_rate} className="input" required />
              </Field>
            </fieldset>
          </ActionForm>
        </Card>

        <Card title="Office hours">
          <ActionForm action={saveOfficeHours} submitLabel="Save office hours" hideSubmit={readOnly}>
            <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-3">
              <Field label="Timezone" htmlFor="oh-tz" className="sm:col-span-3">
                <select id="oh-tz" name="timezone" defaultValue={settings.officeHours.timezone} className="input">
                  {[...new Set([settings.officeHours.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <fieldset className="sm:col-span-3">
                <legend className="label">Working days</legend>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((d) => (
                    <label key={d.n} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="days" value={d.n} defaultChecked={settings.officeHours.days.includes(d.n)} /> {d.label}</label>
                  ))}
                </div>
              </fieldset>
              <Field label="Start" htmlFor="oh-s"><input id="oh-s" name="start" type="time" defaultValue={settings.officeHours.start} className="input" required /></Field>
              <Field label="End" htmlFor="oh-e"><input id="oh-e" name="end" type="time" defaultValue={settings.officeHours.end} className="input" required /></Field>
            </fieldset>
          </ActionForm>
          <p className="text-xs text-muted mt-3">Shown to customers on their account team card. Outside these hours customers can wait for a human or let Octo try.</p>
        </Card>

        <Card title="Sensitive topics">
          <p className="text-sm text-muted mb-3">A customer message matching any of these hands the conversation to the account manager immediately.</p>
          <TopicsEditor initial={settings.topics} action={saveTopics} disabled={readOnly} />
        </Card>

        <Card title="Team–country map">
          <p className="text-sm text-muted mb-3">New customers are assigned to a Sourcing agent in the team mapped to their country, balanced by workload.</p>
          <CountryMapEditor initial={settings.countryMap} teams={teams} action={saveCountryMap} disabled={readOnly} />
        </Card>
      </div>

      <section aria-labelledby="wl" className="mb-8">
        <h2 id="wl" className="text-xl font-semibold mb-3">Staff workload</h2>
        <div className="card overflow-hidden">
          <Table head={['Account manager', 'Team', 'Customers vs cap', 'Open handoffs', 'Status']} empty={<EmptyState title="No account managers" body="Give staff the Sourcing agent role (or Assistant · view) in Staff & roles." />}>
            {workload.map((w) => (
              <tr key={w.id} className="border-t border-line">
                <td className="td"><div className="font-semibold">{w.name}</div><div className="text-xs text-muted">{w.email}{w.roles.length ? ` · ${w.roles.map((r) => humanize(r)).join(', ')}` : ''}</div></td>
                <td className="td text-sm">{w.team ?? '—'}</td>
                <td className="td min-w-[200px]"><Bar label="" value={w.customers} max={settings.cap} display={`${w.customers}/${settings.cap}${w.customers >= settings.cap ? ' · at cap' : ''}`} tone={w.customers >= settings.cap ? 'navy' : 'blue'} /></td>
                <td className="td mono text-sm">{w.openEscalations}</td>
                <td className="td">{w.outOfOffice ? <StatusBadge status="ooo" label="Out of office" tone="amber" /> : <StatusBadge status="active" label="Available" tone="green" />}</td>
              </tr>
            ))}
          </Table>
        </div>
      </section>

      <section aria-labelledby="as">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h2 id="as" className="text-xl font-semibold">Assignments</h2>
          <form action="/admin/assistant" className="flex items-end gap-2" role="search">
            <input type="hidden" name="range" value={String(days)} />
            <div>
              <label htmlFor="aq" className="label">Filter</label>
              <input id="aq" name="aq" defaultValue={aq} className="input" placeholder="Customer, buyer code, manager, team" />
            </div>
            <button type="submit" className="btn btn-dark">Filter</button>
            {aq && <Link href={`/admin/assistant?range=${days}`} className="btn btn-ghost">Clear</Link>}
          </form>
        </div>
        <div className="card overflow-hidden">
          <Table head={['Customer', 'Account manager', 'Team', 'Assigned', 'Reason', 'VIP', '']} empty={<EmptyState title={aq ? 'No matching assignments' : 'No assignments yet'} body="Customers get an account manager when their KYC is verified." />}>
            {assignments.map((a) => (
              <tr key={a.org_id as string} className="border-t border-line">
                <td className="td"><Link href={`/admin/customers/${a.org_id}`} className="font-semibold text-blue">{a.org?.name ?? 'Customer'}</Link><div className="text-xs text-muted mono">{a.org?.buyer_code ?? ''} {a.org?.country ? `· ${a.org.country}` : ''}</div></td>
                <td className="td text-sm">{a.manager}</td>
                <td className="td text-sm">{(a.team as string | null) ?? '—'}</td>
                <td className="td text-sm text-muted">{fmtDate(a.assigned_at as string)}</td>
                <td className="td text-sm">{humanize(a.reason as string | null) || '—'}</td>
                <td className="td">{settings.vip.includes(a.org_id as string) ? <StatusBadge status="vip" label="VIP" tone="blue" /> : <span className="text-muted text-sm">—</span>}</td>
                <td className="td text-right">
                  <ReassignButton orgId={a.org_id as string} orgName={a.org?.name ?? 'Customer'} currentStaffId={a.staff_user_id as string} candidates={workload} cap={settings.cap} path="/admin/assistant" />
                </td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="text-xs text-muted mt-2">VIP flags are set on each customer&apos;s page (Admin → Customers).</p>
      </section>
    </>
  );
}
