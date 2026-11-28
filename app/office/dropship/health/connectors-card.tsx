import { DsBadge, DsNotice } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getConnectorHealth, type ConnectorHealth } from '@/lib/dropship-c0';
import { connectorStatuses } from '@/lib/connectors/registry';
import { platformName } from '@/lib/connectors/platforms';
import { fmtDateTime } from '@/lib/dropship-ds12-shared';
import { TrackingNamesEditor } from './tracking-names';

/**
 * C0 · Staff › System health › Store connectors: per platform (connected, connecting, needs reconnect, failures in 24 h, last error,
 * merchants asking for it, server configuration = env NAMES only), the CSV file connector, the requested-platforms list, the
 * carrier → store tracking company names (editable by Dropship editors and admins) and the carrier tracking poll.
 */
export async function ConnectorHealthCard() {
  let data: ConnectorHealth | null = null;
  let error: string | null = null;
  try { data = await getConnectorHealth(); } catch (e) { error = rpcMessage(e); }
  if (!data) return <DsNotice tone="bad" title="Store connectors could not be loaded" testId="connector-health-error">{error}</DsNotice>;
  const conf = new Map(connectorStatuses().map((c) => [c.id as string, c]));
  const confLabel = (id: string) => {
    const c = conf.get(id);
    if (!c) return { text: '—', tone: 'neutral' as const };
    if (c.status === 'ready') return { text: 'Ready', tone: 'ok' as const };
    if (c.status === 'not_built') return { text: 'Keys set · not built yet', tone: 'info' as const };
    return { text: 'Not configured', tone: 'neutral' as const };
  };
  return (
    <section aria-labelledby="conn-h" className="ds-card !p-0 overflow-hidden" data-testid="connector-health">
      <div className="px-5 pt-4 pb-3">
        <h2 id="conn-h" className="m-0 text-[17px] font-semibold text-ink">Store connectors</h2>
        <p className="m-0 mt-1 text-[13px] text-muted">A platform connects once its connector is switched on (Server column); the others need the owner&rsquo;s app or test store first. The CSV file connector works for every store. Checked {fmtDateTime(data.checked_at)} (UTC).</p>
      </div>
      <div className="ds-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Store connectors per platform">
        <table className="w-full min-w-[820px] text-[14px] border-collapse">
          <thead className="bg-pearl text-left text-muted">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Platform</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Server</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Connected</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Needs reconnect</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Failures (24 h)</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Last error</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Requested by</th>
            </tr>
          </thead>
          <tbody>
            {data.platforms.map((p) => {
              const c = confLabel(p.platform);
              const missing = conf.get(p.platform)?.missingEnv ?? [];
              return (
                <tr key={p.platform} className="border-t border-divider" data-testid={`connector-${p.platform}`}>
                  <td className="px-5 py-2.5 text-ink font-semibold">{platformName(p.platform)}</td>
                  <td className="px-3 py-2.5"><DsBadge tone={c.tone}>{c.text}</DsBadge>{missing.length > 0 && <span className="block text-[12px] text-muted mt-1 font-mono break-all">needs {missing.join(', ')}</span>}</td>
                  <td className="px-3 py-2.5">{p.connected}{p.connecting ? <span className="text-muted"> (+{p.connecting} connecting)</span> : null}</td>
                  <td className="px-3 py-2.5">{p.needs_reconnect ? <DsBadge tone="bad">{p.needs_reconnect}</DsBadge> : 0}</td>
                  <td className="px-3 py-2.5">{p.failures_24h ? <span className="text-bad font-semibold">{p.failures_24h}</span> : 0}</td>
                  <td className="px-3 py-2.5 text-[13px]">{p.last_error ? <>{p.last_error}{p.last_error_at ? <span className="block text-muted">{fmtDateTime(p.last_error_at)}</span> : null}</> : '—'}</td>
                  <td className="px-5 py-2.5">{p.requested} merchant{p.requested === 1 ? '' : 's'}</td>
                </tr>
              );
            })}
            <tr className="border-t border-divider" data-testid="connector-csv">
              <td className="px-5 py-2.5 text-ink font-semibold">CSV file</td>
              <td className="px-3 py-2.5"><DsBadge tone="ok">Ready</DsBadge></td>
              <td className="px-3 py-2.5">{data.csv.merchants_30d} merchant{data.csv.merchants_30d === 1 ? '' : 's'} (30 days)</td>
              <td className="px-3 py-2.5">—</td>
              <td className="px-3 py-2.5">{data.csv.failed_rows_24h ? <span className="text-bad font-semibold">{data.csv.failed_rows_24h} order{data.csv.failed_rows_24h === 1 ? '' : 's'}</span> : 0}<span className="block text-[12px] text-muted">{data.csv.imports_24h} file{data.csv.imports_24h === 1 ? '' : 's'}, {data.csv.orders_24h} order{data.csv.orders_24h === 1 ? '' : 's'} in</span></td>
              <td className="px-3 py-2.5 text-[13px]">{data.csv.last_error ?? '—'}</td>
              <td className="px-5 py-2.5">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5 border-t border-divider">
        <div data-testid="requested-platforms">
          <h3 className="m-0 mb-2 text-[15px] font-semibold text-ink">Requested platforms</h3>
          {data.requested.length === 0 ? <p className="m-0 text-[14px] text-muted">No merchant has asked for a platform yet.</p> : (
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14px]">
              {data.requested.map((r) => (
                <li key={r.platform} className="flex flex-wrap gap-2 items-baseline">
                  <span className="font-semibold">{platformName(r.platform)}</span>
                  <span>{r.merchants} merchant{r.merchants === 1 ? '' : 's'}</span>
                  <span className="text-[13px] text-muted">last {fmtDateTime(r.last_at)}</span>
                  {r.names && r.names.length > 0 && <span className="w-full text-[13px] text-muted">Named: {r.names.filter(Boolean).slice(0, 20).join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="m-0 mt-4 mb-2 text-[15px] font-semibold text-ink">Carrier tracking poll</h3>
          <p className="m-0 text-[14px]" data-testid="carrier-poll">
            {data.poll.targets} live label{data.poll.targets === 1 ? '' : 's'} on the way.{' '}
            {data.poll.last_run ? <>Last run {fmtDateTime(data.poll.last_run.at)}: {data.poll.last_run.summary}</> : 'Not run yet (runs every 30 minutes once a live carrier label is on the way).'}
          </p>
        </div>
        <TrackingNamesEditor rows={data.tracking_names} canEdit={data.can_edit} />
      </div>
    </section>
  );
}
