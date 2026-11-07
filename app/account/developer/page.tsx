import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, StatusBadge, Table } from '@/components/ui';
import { ActionButton } from '@/components/client';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { apiBaseUrl, WEBHOOK_EVENTS } from '@/components/account/dev-constants';
import { runInPostmanUrl, POSTMAN_WORKSPACE_URL, POSTMAN_DOWNLOADS, RUN_IN_POSTMAN_BADGE } from '@/lib/api/postman-links';
import { CopyField, CreateAppForm, CreateKeyButton, ScopesForm, WebhookForm, WebhookSecret, WebhookToggle } from '@/components/account/dev-client';
import { deleteWebhook, revokeApp, revokeKey } from './actions';

export const metadata = { title: 'API & integrations' };

type App = { id: string; name: string; client_id: string; scopes: string[]; created_at: string; revoked_at: string | null };
type Key = { id: string; client_id: string; mode: 'test' | 'live'; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Hook = { id: string; url: string; events: string[]; secret: string; active: boolean; created_at: string };
type Delivery = { id: string; endpoint_id: string | null; event_type: string | null; response_status: number | null; attempts: number | null; delivered_at: string | null; created_at: string };

export default async function DeveloperPage({ searchParams }: { searchParams: Promise<{ mode?: string; app?: string }> }) {
  const s = await requireCustomer('/account/developer');
  const sp = await searchParams;

  if (!s.org) {
    return (
      <>
        <PageHeader title="API & integrations" subtitle="Connect your Shopify or WooCommerce store to Octopus B2B (coming soon — upload orders as a sheet meanwhile)." />
        <Notice tone="amber">Complete your company profile first. <Link href="/account/kyc" className="underline font-semibold">Set up your company</Link></Notice>
      </>
    );
  }

  const sb = await createClient();
  const [{ data: org }, { data: appsRaw }, { data: keysRaw }, { data: hooksRaw }, { data: delRaw }] = await Promise.all([
    sb.from('organizations').select('kyc_status').eq('id', s.org.id).maybeSingle(),
    sb.from('api_clients').select('id, name, client_id, scopes, created_at, revoked_at').eq('org_id', s.org.id).order('created_at', { ascending: false }),
    sb.from('api_keys').select('id, client_id, mode, prefix, created_at, last_used_at, revoked_at').eq('org_id', s.org.id).order('created_at', { ascending: false }),
    sb.from('webhook_endpoints').select('id, url, events, secret, active, created_at').eq('org_id', s.org.id).order('created_at', { ascending: false }),
    sb.from('webhook_deliveries').select('id, endpoint_id, event_type, response_status, attempts, delivered_at, created_at').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(20),
  ]);
  const apps = (appsRaw ?? []) as App[];
  const keys = (keysRaw ?? []) as Key[];
  const hooks = (hooksRaw ?? []) as Hook[];
  const deliveries = (delRaw ?? []) as Delivery[];
  const hookUrl = new Map(hooks.map((h) => [h.id, h.url]));

  const verified = org?.kyc_status === 'verified';
  const mode: 'test' | 'live' = sp.mode === 'live' && verified ? 'live' : 'test';
  const activeApps = apps.filter((a) => !a.revoked_at);
  const app = apps.find((a) => a.id === sp.app) ?? activeApps[0] ?? apps[0] ?? null;
  const appKeys = app ? keys.filter((k) => k.client_id === app.id) : [];
  const modeKeys = appKeys.filter((k) => k.mode === mode);
  const base = apiBaseUrl();
  const href = (p: { mode?: string; app?: string }) => {
    const q = new URLSearchParams();
    const m = p.mode ?? (mode === 'live' ? 'live' : undefined);
    const a = p.app ?? app?.id;
    if (m && m !== 'sandbox') q.set('mode', m);
    if (a) q.set('app', a);
    const str = q.toString();
    return `/account/developer${str ? `?${str}` : ''}`;
  };
  const clientIdForDocs = app?.client_id ?? 'YOUR_CLIENT_ID';
  const lastUsed = keys.map((k) => k.last_used_at).filter(Boolean).sort().pop() ?? null;

  return (
    <>
      <PageHeader
        title="API & integrations"
        subtitle="Connect your Shopify or WooCommerce store to Octopus B2B (coming soon — upload orders as a sheet meanwhile). Use these credentials in your app, a plugin, or Postman."
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <div role="tablist" aria-label="Environment" className="inline-flex p-1 rounded-[10px] bg-[#E9ECF1] border border-line">
              <Link role="tab" aria-selected={mode === 'test'} href={href({ mode: 'sandbox' })}
                className={cn('min-w-[120px] text-center px-5 py-2.5 rounded-[8px] text-[15px] font-semibold', mode === 'test' ? 'bg-white shadow-sm text-navy' : 'text-muted')}>Sandbox</Link>
              {verified ? (
                <Link role="tab" aria-selected={mode === 'live'} href={href({ mode: 'live' })}
                  className={cn('min-w-[120px] text-center px-5 py-2.5 rounded-[8px] text-[15px] font-semibold', mode === 'live' ? 'bg-white shadow-sm text-navy' : 'text-muted')}>Live</Link>
              ) : (
                <span role="tab" aria-selected={false} aria-disabled="true" title="Live keys unlock after KYC is verified"
                  className="min-w-[120px] text-center px-5 py-2.5 rounded-[8px] text-[15px] font-semibold text-muted/60 cursor-not-allowed">Live 🔒</span>
              )}
            </div>
            {!verified && <p className="text-xs text-muted">Live keys unlock after <Link href="/account/kyc" className="underline text-blue">KYC verification</Link>.</p>}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ───────── Credentials ───────── */}
        <Card
          title="Credentials"
          action={mode === 'live'
            ? <StatusBadge status="live" label="Live · real orders" />
            : <StatusBadge status="sandbox" tone="blue" label="Sandbox · test data only" />}
        >
          {!app ? (
            <>
              <EmptyState title="No API apps yet" body="Create an app to get a Client ID, then generate a client secret. Sandbox secrets work immediately." />
              <CreateAppForm />
            </>
          ) : (
            <div className="px-6 pb-6 space-y-5">
              {apps.length > 1 && (
                <nav aria-label="Your apps" className="flex flex-wrap gap-2">
                  {apps.map((a) => (
                    <Link key={a.id} href={href({ app: a.id })} aria-current={a.id === app.id ? 'page' : undefined}
                      className={cn('btn btn-sm', a.id === app.id ? 'btn-dark' : 'btn-ghost')}>
                      {a.name}{a.revoked_at ? ' (revoked)' : ''}
                    </Link>
                  ))}
                </nav>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[17px]">{app.name}</div>
                  <div className="text-xs text-muted">Created {fmtDate(app.created_at)}</div>
                </div>
                {app.revoked_at ? (
                  <StatusBadge status="cancelled" label={`Revoked ${fmtDate(app.revoked_at)}`} />
                ) : (
                  <ActionButton action={revokeApp.bind(null, app.id)} className="btn btn-ghost btn-sm text-bad"
                    confirm={`Revoke the app “${app.name}”? All of its secrets stop working immediately. This cannot be undone.`}>Revoke app</ActionButton>
                )}
              </div>
              <CopyField label="Base URL" value={base} />
              <CopyField label="Client ID" value={app.client_id} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold">Client secret ({mode === 'live' ? 'live' : 'sandbox'})</span>
                {app.revoked_at ? (
                  <p className="text-sm text-muted">This app is revoked. Create a new app to get new credentials.</p>
                ) : (
                  <CreateKeyButton appId={app.id} mode={mode} allowed={mode === 'test' || verified} />
                )}
                <p className="text-xs text-muted">
                  Secrets start with <code className="mono">{mode === 'live' ? 'oct_live_' : 'oct_test_'}</code> and are shown only once. Use them as <code className="mono">client_secret</code> or directly as a Bearer token.
                </p>
              </div>

              <div>
                <div className="text-[13px] font-semibold mb-2">Secrets for this app</div>
                <div className="border border-line rounded-[10px] overflow-hidden">
                  <Table head={['Prefix', 'Mode', 'Created', 'Last used', 'Status', '']}
                    empty={<EmptyState title={`No ${mode === 'live' ? 'live' : 'sandbox'} secrets yet`} body="Generate one above. It is shown once — store it in your app's settings." />}>
                    {modeKeys.map((k) => (
                      <tr key={k.id}>
                        <td className="td mono text-sm">{k.prefix}…</td>
                        <td className="td"><StatusBadge status={k.mode === 'live' ? 'live' : 'sandbox'} label={k.mode === 'live' ? 'Live' : 'Sandbox'} /></td>
                        <td className="td text-sm">{fmtDate(k.created_at)}</td>
                        <td className="td text-sm">{k.last_used_at ? fmtDate(k.last_used_at, true) : 'Never'}</td>
                        <td className="td">{k.revoked_at ? <StatusBadge status="cancelled" label={`Revoked ${fmtDate(k.revoked_at)}`} /> : <StatusBadge status="active" />}</td>
                        <td className="td text-right">
                          {!k.revoked_at && (
                            <ActionButton action={revokeKey.bind(null, k.id)} className="btn btn-ghost btn-sm"
                              confirm={`Revoke secret ${k.prefix}…? Apps using it will stop working immediately.`}>Revoke</ActionButton>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </div>

              <ScopesForm key={app.id + app.scopes.join(',')} appId={app.id} initial={app.scopes ?? []} disabled={!!app.revoked_at} />

              <details className="border-t border-line pt-4">
                <summary className="cursor-pointer font-semibold text-sm">Create another app</summary>
                <div className="mt-4"><CreateAppForm compact /></div>
              </details>
            </div>
          )}
        </Card>

        {/* ───────── Right column ───────── */}
        <div className="space-y-6 lg:stick">
          <Card title="Test in Postman">
            <div className="px-6 pb-6 space-y-3">
              <p className="text-[15px] text-muted">Import the collection, add your Client ID and secret to the environment, and send your first request.</p>
              {runInPostmanUrl() && (
                <a href={runInPostmanUrl()!} target="_blank" rel="noopener" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={RUN_IN_POSTMAN_BADGE} alt="Run in Postman" height={32} />
                </a>
              )}
              {POSTMAN_WORKSPACE_URL && <a className="btn btn-ghost w-full" href={POSTMAN_WORKSPACE_URL} target="_blank" rel="noopener">Open the public Postman workspace</a>}
              <a className="btn btn-primary w-full" href={POSTMAN_DOWNLOADS.publicCollection} download>Download Postman collection</a>
              <a className="btn btn-ghost w-full" href={POSTMAN_DOWNLOADS.sandboxEnvironment} download>Sandbox environment</a>
              <a className="btn btn-ghost w-full" href="/api/v1/openapi.json" target="_blank" rel="noopener">OpenAPI spec (JSON)</a>
              <a className="inline-flex text-blue font-semibold text-[15px] hover:underline" href="/api/v1/openapi.json" target="_blank" rel="noopener">Read the API docs →</a>
            </div>
          </Card>
          <Card title="Usage">
            <dl className="px-6 pb-6 space-y-2 text-[15px]">
              <div className="flex justify-between"><dt className="text-muted">Active apps</dt><dd className="mono font-semibold">{activeApps.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Active secrets</dt><dd className="mono font-semibold">{keys.filter((k) => !k.revoked_at).length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Last API call</dt><dd className="mono text-sm">{lastUsed ? fmtDate(lastUsed, true) : 'Never'}</dd></div>
            </dl>
            <p className="px-6 pb-6 -mt-4 text-sm text-muted">Rate limit: 60 requests per minute per key. Access tokens are valid for 1 hour.</p>
          </Card>
        </div>
      </div>

      {/* ───────── Quick start ───────── */}
      <Card title="Quick start" className="mt-6">
        <div className="px-6 pb-6 space-y-4">
          <p className="text-[15px]">1. Get an access token (valid 1 hour)</p>
          <pre tabIndex={0} aria-label="Code example" className="m-0 bg-navy text-[#E4E8EE] rounded-[12px] p-[18px] mono text-[13px] leading-[1.7] overflow-x-auto whitespace-pre">{`curl -X POST ${base}/oauth/token \\
  -d grant_type=client_credentials \\
  -d client_id=${clientIdForDocs} \\
  -d client_secret=YOUR_CLIENT_SECRET`}</pre>
          <p className="text-[15px]">2. Call the API with the token</p>
          <pre tabIndex={0} aria-label="Code example" className="m-0 bg-navy text-[#E4E8EE] rounded-[12px] p-[18px] mono text-[13px] leading-[1.7] overflow-x-auto whitespace-pre">{`curl "${base}/products?limit=50" \\
  -H "Authorization: Bearer ACCESS_TOKEN"`}</pre>
        </div>
      </Card>

      {/* ───────── Webhooks ───────── */}
      <Card title="Webhooks" className="mt-6">
        <div className="px-6 pb-6 space-y-6">
          <p className="text-sm text-muted">
            We POST signed JSON to your endpoint for {WEBHOOK_EVENTS.map((e, i) => <span key={e}>{i > 0 && ', '}<code className="mono">{e}</code></span>)}. Verify the signature header with your endpoint secret.
          </p>
          <div className="border border-line rounded-[10px] overflow-hidden">
            <Table head={['Endpoint', 'Events', 'Secret', 'Status', '']}
              empty={<EmptyState title="No webhooks yet" body="Add an https endpoint below to receive order, shipment and quote updates." />}>
              {hooks.map((h) => (
                <tr key={h.id}>
                  <td className="td mono text-sm break-all max-w-[280px]">{h.url}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{h.events.map((e) => <span key={e} className="mono text-xs bg-surface border border-line rounded px-1.5 py-0.5">{e}</span>)}</div></td>
                  <td className="td"><WebhookSecret id={h.id} hint={h.secret.slice(-4)} /></td>
                  <td className="td"><WebhookToggle id={h.id} active={h.active} url={h.url} /></td>
                  <td className="td text-right">
                    <ActionButton action={deleteWebhook.bind(null, h.id)} className="btn btn-ghost btn-sm text-bad"
                      confirm={`Delete the webhook ${h.url}? Pending deliveries to it will stop.`}>Delete</ActionButton>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
          <div className="border-t border-line pt-5">
            <h3 className="font-semibold mb-3">Add webhook</h3>
            <WebhookForm />
          </div>
          <div className="border-t border-line pt-5">
            <h3 className="font-semibold mb-3">Recent deliveries</h3>
            <div className="border border-line rounded-[10px] overflow-hidden">
              <Table head={['Event', 'Endpoint', 'Response', 'Attempts', 'Delivered']}
                empty={<EmptyState title="No deliveries yet" body="Deliveries appear here once an event is sent to one of your endpoints." />}>
                {deliveries.map((d) => {
                  const ok = d.response_status != null && d.response_status >= 200 && d.response_status < 300;
                  return (
                    <tr key={d.id}>
                      <td className="td mono text-sm">{d.event_type ?? '—'}</td>
                      <td className="td mono text-xs text-muted break-all max-w-[240px]">{d.endpoint_id ? hookUrl.get(d.endpoint_id) ?? '—' : '—'}</td>
                      <td className="td">
                        {d.response_status == null
                          ? <StatusBadge status="pending" label="Pending" />
                          : <StatusBadge status={ok ? 'delivered' : 'failed'} label={`${d.response_status} ${ok ? 'OK' : 'Failed'}`} />}
                      </td>
                      <td className="td mono text-sm">{d.attempts ?? 0}</td>
                      <td className="td text-sm">{d.delivered_at ? fmtDate(d.delivered_at, true) : '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          </div>
        </div>
      </Card>

      {/* ───────── Connected stores ───────── */}
      <Card title="Connected stores" className="mt-6" action={<a href="#add-webhook" className="btn btn-ghost btn-sm">Add webhook</a>}>
        <div className="px-6 pb-6 grid gap-4 md:grid-cols-3">
          {[
            { name: 'Shopify', body: 'Store connection: coming soon. Upload orders as a sheet meanwhile.', status: 'soon' },
            { name: 'WooCommerce', body: 'Store connection: coming soon. Upload orders as a sheet meanwhile.', status: 'soon' },
            { name: 'Your own website or ERP', body: 'Connect with the REST API and webhooks above.', status: 'available' },
          ].map((c) => (
            <div key={c.name} className="border border-line rounded-[12px] p-4">
              <div className="font-semibold text-[17px]">{c.name}</div>
              <p className="mt-2 text-sm text-muted">{c.body}</p>
              <div className="mt-3">
                {c.status === 'available' ? <StatusBadge status="active" label="Available" /> : <StatusBadge status="draft" label="App coming soon" />}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
