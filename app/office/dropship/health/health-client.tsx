'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsInput, DsNotice, DsPageHeader, type DsBadgeTone } from '@/components/dropship-ui';
import type { HealthPageData } from '@/lib/dropship-ds12';
import { fmtDateTime } from '@/lib/dropship-ds12-shared';
import { notifyMerchantAction, retryJobAction, stopJobAction } from './actions';

/**
 * Staff › System health screen (staff/StaffHealth.html): status tiles, failed jobs with plain reasons and Retry / Stop, store
 * token failures with Notify merchant, webhook failures, sync errors and scheduled jobs. Times are UTC.
 */

const ageMin = (iso: string | null, now: string) => (iso ? Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60000)) : null);
const KIND: Record<string, string> = { domain_event: 'Event between divisions', outbox: 'Outbox', push_job: 'Push product' };

function Tile({ name, tone, state, line, testId }: { name: string; tone: DsBadgeTone; state: string; line: string; testId: string }) {
  return (
    <div className="ds-card !py-3 flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2"><strong className="text-[14px] text-[#1A174A]">{name}</strong><DsBadge tone={tone} icon={tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : tone === 'bad' ? 'stop' : 'info'}>{state}</DsBadge></div>
      <span className="text-[13px] text-[#5B6478]">{line}</span>
    </div>
  );
}

export function HealthClient({ data }: { data: HealthPageData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState('');
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
    setMsg(null);
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.message ?? 'Not done.' }); router.refresh(); });
  };
  const de = data.domain_events;
  const delay = ageMin(de.oldest_pending, data.checked_at);
  const evTone: DsBadgeTone = de.dead > 0 ? 'bad' : delay != null && delay > 5 ? 'warn' : 'ok';
  const noAct = data.can_act ? undefined : 'Retry needs Dropship edit rights or an admin.';
  const carrierAge = ageMin(data.carrier_last_event, data.checked_at);

  return (
    <div className="flex flex-col gap-5" data-testid="ds-health-page">
      <DsPageHeader title="System health" icon="activity" subtitle="Jobs, webhooks, events between divisions and store connections."
        actions={<DsButton variant="secondary" icon="refresh" onClick={() => router.refresh()} testId="health-refresh">Refresh</DsButton>} />
      <p className="m-0 -mt-3 text-[13px] text-[#5B6478]">Checked {fmtDateTime(data.checked_at)}</p>
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Not done'} testId="health-notice">{msg.text}</DsNotice>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="health-tiles">
        <Tile testId="tile-shopify" name="Shopify API" tone="neutral" state={data.stores_active ? 'Connected' : 'Not connected'} line={data.stores_active ? `${data.stores_active} store(s) connected` : 'No store is connected yet (Shopify connection comes last).'} />
        <Tile testId="tile-webhooks" name="Order webhooks" tone={data.webhooks.store_failed.length ? 'bad' : 'neutral'} state={data.webhooks.store_failed.length ? `${data.webhooks.store_failed.length} failed` : data.webhooks.store_received_24h ? 'Working' : 'No webhooks yet'} line={`Received today: ${data.webhooks.store_received_24h} · payment events waiting: ${data.webhooks.payment_unprocessed}`} />
        <Tile testId="tile-order-check" name="Hourly order check" tone="neutral" state="Not running" line="Starts with the store connection (catch-up for missed webhooks)." />
        <Tile testId="tile-sync" name="Stock and price sync" tone={data.links_failed ? 'bad' : 'neutral'} state={data.links_failed ? `${data.links_failed} failed` : 'Not running'} line={data.links_failed ? 'Some live products failed to sync.' : 'Starts with the auto-sync engine and a connected store.'} />
        <Tile testId="tile-events" name="Events between divisions" tone={evTone} state={de.dead > 0 ? `${de.dead} stopped` : evTone === 'warn' ? 'Delayed' : 'Working'}
          line={`${de.pending} waiting · ${de.retry} retrying${delay != null ? ` · oldest ${delay} min` : ''} · ${de.processed_24h} delivered today`} />
        <Tile testId="tile-carrier" name="Carrier events" tone={data.carrier_last_event ? 'ok' : 'neutral'} state={data.carrier_last_event ? 'Working' : 'No events yet'} line={data.carrier_last_event ? `Last event ${carrierAge} min ago` : 'Tracking events appear after the first hand-over.'} />
      </div>

      <section aria-labelledby="failed-h" className="ds-card !p-0 overflow-hidden" data-testid="health-failed">
        <h2 id="failed-h" className="m-0 px-5 pt-4 pb-3 text-[17px] font-semibold text-[#1A174A]">Failed jobs</h2>
        {data.failed.length === 0 ? <p className="m-0 px-5 pb-5 text-[14px] text-[#5B6478]" data-testid="failed-empty">No failed jobs.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Failed jobs">
            <table className="w-full min-w-[760px] text-[14px] border-collapse">
              <thead className="bg-[#F7F9FC] text-left text-[#5B6478]"><tr><th scope="col" className="px-5 py-2.5 font-medium">Time</th><th scope="col" className="px-3 py-2.5 font-medium">Job</th><th scope="col" className="px-3 py-2.5 font-medium">Merchant</th><th scope="col" className="px-3 py-2.5 font-medium">Reason</th><th scope="col" className="px-3 py-2.5 font-medium">Tries</th><th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.failed.map((f) => (
                  <tr key={`${f.kind}-${f.id}`} className="border-t border-[#EEF0F4] align-top" data-testid={`failed-${f.id}`}>
                    <td className="px-5 py-2.5 whitespace-nowrap">{fmtDateTime(f.at)}</td>
                    <td className="px-3 py-2.5">{KIND[f.kind]}: {f.job}</td>
                    <td className="px-3 py-2.5">{f.merchant ?? '—'}</td>
                    <td className="px-3 py-2.5">{f.reason}</td>
                    <td className="px-3 py-2.5">{f.attempts}{f.status === 'retry' ? ' · retrying' : f.status === 'dead' ? ' · stopped' : ''}</td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <DsButton variant="secondary" loading={pending} disabled={!data.can_act} disabledReason={noAct} onClick={() => run(() => retryJobAction(f.kind, f.id), 'Queued again with the same idempotency key.')} testId={`retry-${f.id}`}>{f.status === 'retry' ? 'Retry now' : 'Retry'}</DsButton>
                        {f.kind !== 'push_job' && f.status !== 'dead' && data.can_act && (stopId === f.id ? (
                          <div className="flex flex-col items-end gap-1">
                            <DsInput id={`stop-${f.id}`} label="Why stop it?" value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
                            <DsButton variant="danger" disabled={stopReason.trim().length < 3} disabledReason={stopReason.trim().length < 3 ? 'Write the reason first.' : undefined}
                              onClick={() => run(async () => { const r = await stopJobAction(f.kind, f.id, stopReason); if (r.ok) { setStopId(null); setStopReason(''); } return r; }, 'Stopped (dead letter).')}>Stop job</DsButton>
                          </div>
                        ) : <DsButton variant="link" onClick={() => setStopId(f.id)}>Stop<span className="sr-only"> {f.job}</span></DsButton>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section aria-labelledby="tok-h" className="ds-card" data-testid="health-tokens">
          <h2 id="tok-h" className="m-0 mb-2 text-[17px] font-semibold text-[#1A174A]">Store access (token refresh)</h2>
          {data.token_failures.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">No store needs reconnecting.{data.stores_active ? '' : ' No store is connected yet.'}</p> : (
            <ul className="m-0 p-0 list-none flex flex-col gap-2 text-[14px]">
              {data.token_failures.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2"><span className="flex-1">{t.merchant} · {t.shop_domain}: {t.reason ?? 'Refresh token rejected: store must reconnect'}</span>
                  <DsButton variant="secondary" disabled={!data.can_act} disabledReason={noAct} onClick={() => run(() => notifyMerchantAction(t.id), 'The merchant was told to reconnect.')}>Notify merchant</DsButton></li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="wh-h" className="ds-card" data-testid="health-webhooks">
          <h2 id="wh-h" className="m-0 mb-2 text-[17px] font-semibold text-[#1A174A]">Webhook failures</h2>
          {data.webhooks.store_failed.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">No failed webhooks.</p> : (
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14px]">
              {data.webhooks.store_failed.map((w, i) => <li key={i}>{fmtDateTime(w.received_at)} · {w.source} {w.topic ?? ''}: {w.error} ({w.attempts} tries)</li>)}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="sync-h" className="ds-card" data-testid="health-sync">
        <h2 id="sync-h" className="m-0 mb-2 text-[17px] font-semibold text-[#1A174A]">Sync errors</h2>
        {data.sync_errors.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">No sync errors.</p> : (
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14px]">
            {data.sync_errors.map((e, i) => <li key={i}>{fmtDateTime(e.at)} · {e.merchant} · {e.kind}: {e.change} → {e.result}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="jobs-h" className="ds-card !p-0 overflow-hidden" data-testid="health-jobs">
        <h2 id="jobs-h" className="m-0 px-5 pt-4 pb-3 text-[17px] font-semibold text-[#1A174A]">Scheduled jobs</h2>
        {!data.cron_readable ? <p className="m-0 px-5 pb-5 text-[14px] text-[#5B6478]">The job scheduler can&rsquo;t be read here.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scheduled jobs">
            <table className="w-full min-w-[640px] text-[14px] border-collapse">
              <thead className="bg-[#F7F9FC] text-left text-[#5B6478]"><tr><th scope="col" className="px-5 py-2.5 font-medium">Job</th><th scope="col" className="px-3 py-2.5 font-medium">When</th><th scope="col" className="px-3 py-2.5 font-medium">Last run</th><th scope="col" className="px-5 py-2.5 font-medium">Result</th></tr></thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.name} className="border-t border-[#EEF0F4]" data-testid={`job-${j.name}`}>
                    <td className="px-5 py-2.5 text-[#1A174A]">{j.name.replace(/^octopus-/, '').replace(/-/g, ' ')}</td>
                    <td className="px-3 py-2.5 font-mono text-[13px]">{j.schedule}{j.active ? '' : ' (off)'}</td>
                    <td className="px-3 py-2.5">{j.last_start ? fmtDateTime(j.last_start) : 'Not run yet'}</td>
                    <td className="px-5 py-2.5">{j.last_status == null ? '—' : <DsBadge tone={j.last_status === 'succeeded' ? 'ok' : j.last_status === 'failed' ? 'bad' : 'info'}>{j.last_status === 'succeeded' ? 'OK' : j.last_status === 'failed' ? 'Failed' : j.last_status}</DsBadge>}
                      {j.failed_24h > 0 ? <span className="ml-2 text-[13px] text-[#B42318]">{j.failed_24h} failed in 24 h</span> : null}
                      {j.last_message ? <span className="block text-[13px] text-[#5B6478]">{j.last_message}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
