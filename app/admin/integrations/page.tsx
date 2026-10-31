import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Tabs } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { fmtDate, humanize } from '@/lib/format';
import { saveIntegrationMode, testConnection, retryOutbox } from './actions';

export const metadata = { title: 'Integrations' };

const KIND_LABEL: Record<string, string> = { carrier: 'Shipping carrier', payment: 'Payment partner', email: 'Transactional email', ai: 'AI text & image', dropship: 'Dropshipping app', source: 'Product source' };
const EVENTS = ['product.published', 'rfq.submitted', 'quote.sent', 'quote.approved', 'payment.confirmed', 'order.confirmed', 'order.ready_to_ship', 'shipment.tracking', 'service_request.paid', 'ticket.created', 'terms.published'];

/** Admin → Integrations (Integrations.png). */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ kind?: string; outbox?: string }> }) {
  const s = await requireStaff('integrations', 'view', '/admin/integrations');
  const sp = await searchParams;
  const sb = await createClient();
  const outboxFilter = sp.outbox === 'all' ? null : ['failed', 'dead'];
  const outboxQ = sb.from('outbox_events').select('id, event_type, aggregate_type, status, attempts, last_error, available_at, created_at').order('created_at', { ascending: false }).limit(40);
  const [{ data: integrations }, { data: outbox }, { data: deliveries }, { data: logs }, counts] = await Promise.all([
    sb.from('integrations').select('code, name, kind, mode, status, last_tested_at, updated_at').order('kind'),
    outboxFilter ? outboxQ.in('status', outboxFilter) : outboxQ,
    sb.from('webhook_deliveries').select('id, event_type, response_status, attempts, delivered_at, created_at, webhook_endpoints(url)').order('created_at', { ascending: false }).limit(20),
    sb.from('integration_logs').select('id, integration_code, direction, status, summary, created_at').order('created_at', { ascending: false }).limit(25),
    Promise.all(['pending', 'failed', 'dead'].map((st) => sb.from('outbox_events').select('id', { count: 'exact', head: true }).eq('status', st))),
  ]);
  const [pendingN, failedN, deadN] = counts.map((c) => c.count ?? 0);
  const list = integrations ?? [];
  const kinds = [...new Set(list.map((i) => i.kind))];
  const kind = kinds.includes(sp.kind ?? '') ? sp.kind! : 'all';
  const shown = kind === 'all' ? list : list.filter((i) => i.kind === kind);
  const edit = can(s, 'integrations', 'edit');

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect shipping carriers, payments, email, AI and dropshipping apps. Each connection is an adapter with sandbox and live modes, so adding one never changes the core platform." />
      <div className="mb-6"><Notice tone="blue">Credentials (API keys, app secrets) live only in the server environment / Supabase Vault and are never shown here. This page controls mode, tests connections and shows delivery logs.</Notice></div>
      <Tabs base="/admin/integrations" param="kind" active={kind} tabs={[{ key: 'all', label: 'All', count: list.length }, ...kinds.map((k) => ({ key: k, label: KIND_LABEL[k] ?? humanize(k), count: list.filter((i) => i.kind === k).length }))]} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 mb-6">
        {shown.length === 0 && <Card className="sm:col-span-2 xl:col-span-3"><EmptyState title="No connections" /></Card>}
        {shown.map((i) => (
          <section key={i.code} className="card p-5 flex flex-col">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-[8px] bg-surface border border-line mono text-xs font-semibold flex items-center justify-center uppercase" aria-hidden>{i.code.slice(0, 3)}</span>
              <div className="min-w-0">
                <h2 className="font-semibold text-[17px]">{i.name}</h2>
                <div className="text-sm text-muted">{KIND_LABEL[i.kind] ?? humanize(i.kind)}</div>
              </div>
            </div>
            <dl className="mt-4 text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Status</dt><dd><StatusBadge status={i.status} /></dd>
              <dt className="text-muted">Mode</dt><dd><StatusBadge status={i.mode} label={humanize(i.mode)} tone={i.mode === 'live' ? 'green' : undefined} /></dd>
              <dt className="text-muted">Last tested</dt><dd>{fmtDate(i.last_tested_at, true)}</dd>
            </dl>
            <div className="mt-auto pt-4 border-t border-line flex flex-wrap items-end gap-2 justify-between">
              {edit ? (
                <ActionForm action={saveIntegrationMode} className="flex items-end gap-2" submitLabel="Set" submitClass="btn btn-ghost btn-sm" inline confirm={`Change the mode of ${i.name}? Live mode uses real credentials and real money / shipments.`}>
                  <input type="hidden" name="code" value={i.code} />
                  <label className="sr-only" htmlFor={`mode-${i.code}`}>Mode</label>
                  <select id={`mode-${i.code}`} name="mode" defaultValue={i.mode} className="input min-h-9 py-1 w-auto text-sm">
                    <option value="sandbox">Sandbox</option><option value="live">Live</option><option value="off">Off</option>
                  </select>
                </ActionForm>
              ) : <span />}
              {edit && <RunButton className="btn btn-ghost btn-sm" action={testConnection.bind(null, i.code)}>Test connection</RunButton>}
            </div>
          </section>
        ))}
      </div>

      <Card title="Failed jobs (outbox)" className="mb-6" action={
        <span className="flex items-center gap-3 text-sm">
          <span className="text-muted">{pendingN} pending · {failedN} failed · {deadN} dead</span>
          <a className="text-blue font-semibold" href={sp.outbox === 'all' ? '/admin/integrations' : '/admin/integrations?outbox=all'}>{sp.outbox === 'all' ? 'Show failed only' : 'Show all events'}</a>
        </span>}>
        <Table head={['Created', 'Event', 'Status', 'Attempts', 'Last error', '']} empty={<EmptyState title={outboxFilter ? 'No failed or dead jobs 🎉' : 'No events yet'} />}>
          {(outbox ?? []).map((e) => (
            <tr key={e.id}>
              <td className="td text-sm">{fmtDate(e.created_at, true)}</td>
              <td className="td"><span className="mono text-sm">{e.event_type}</span><div className="text-xs text-muted">{e.aggregate_type}</div></td>
              <td className="td"><StatusBadge status={e.status} tone={e.status === 'dead' || e.status === 'failed' ? 'red' : e.status === 'done' ? 'green' : undefined} /></td>
              <td className="td mono">{e.attempts}</td>
              <td className="td text-sm text-bad max-w-[320px] truncate" title={e.last_error ?? ''}>{e.last_error ?? '—'}</td>
              <td className="td text-right">{edit && (e.status === 'failed' || e.status === 'dead') && <RunButton className="btn btn-primary btn-sm" confirm={`Retry ${e.event_type}? Attempts reset to 0.`} action={retryOutbox.bind(null, e.id)}>Retry</RunButton>}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Webhook deliveries">
          <Table head={['Time', 'Event', 'Endpoint', 'Response', 'Attempts']} empty={<EmptyState title="No webhook deliveries yet" />}>
            {(deliveries ?? []).map((d) => {
              const ep = d.webhook_endpoints as unknown as { url: string } | null;
              const okStatus = d.response_status != null && d.response_status < 300;
              return (
                <tr key={d.id}>
                  <td className="td text-sm">{fmtDate(d.created_at, true)}</td>
                  <td className="td mono text-sm">{d.event_type}</td>
                  <td className="td mono text-xs max-w-[200px] truncate" title={ep?.url}>{ep?.url ?? '—'}</td>
                  <td className="td"><StatusBadge status={okStatus ? 'delivered' : d.response_status ? 'failed' : 'pending'} label={d.response_status ? String(d.response_status) : 'Pending'} /></td>
                  <td className="td mono">{d.attempts}</td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <Card title="Integration logs">
          <Table head={['Time', 'Connection', 'Direction', 'Status', 'Summary']} empty={<EmptyState title="No integration calls logged yet" />}>
            {(logs ?? []).map((l) => (
              <tr key={l.id}>
                <td className="td text-sm">{fmtDate(l.created_at, true)}</td>
                <td className="td mono text-sm">{l.integration_code}</td>
                <td className="td text-sm">{l.direction}</td>
                <td className="td"><StatusBadge status={l.status && l.status < 300 ? 'completed' : 'failed'} label={String(l.status ?? '—')} /></td>
                <td className="td text-sm max-w-[280px]">{l.summary}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Platform events">
        <p className="px-6 text-sm text-muted">Every business change writes an outbox event in the same transaction; workers deliver it to email, PDF, carriers and customer webhooks with retries (1 min → 6 h), then dead-letter here.</p>
        <div className="px-6 py-4 flex flex-wrap gap-2">
          {EVENTS.map((e) => <span key={e} className="mono text-xs rounded-md bg-surface border border-line px-2 py-1">{e}</span>)}
        </div>
      </Card>
    </>
  );
}
