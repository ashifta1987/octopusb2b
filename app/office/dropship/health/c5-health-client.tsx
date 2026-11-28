'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsNotice } from '@/components/dropship-ui';
import { CONNECTION_STATUS, platformName } from '@/lib/connectors/platforms';
import { fmtDateTime } from '@/lib/dropship-ds12-shared';
import { TASK_LABEL, type StoreCarrierHealth } from '@/lib/dropship-c5-shared';
import { contactMerchantAction, retryConnectionAction, retryStoreTaskAction, type C5Result } from './c5-actions';

const CARRIER: Record<string, string> = { yunexpress: 'YunExpress', '4px': '4PX' };
const th = 'px-3 py-2.5 font-medium';
const td = 'px-3 py-2.5';

/**
 * CONN S5 · the three health lists with their actions. The last action's result is held here (above the lists), so it stays
 * visible when the row leaves the refreshed list. Finance / Support read only (the database refuses their actions too).
 */
export function StoreCarrierHealthClient({ data }: { data: StoreCarrierHealth }) {
  const [msg, setMsg] = useState<C5Result | null>(null);
  const [pending, start] = useTransition();
  const run = (f: () => Promise<C5Result>) => start(async () => setMsg(await f()));
  const noEdit = data.can_edit ? undefined : 'Dropship editors and admins only';
  return (
    <section aria-labelledby="c5-h" className="ds-card !p-0 overflow-hidden" data-testid="c5-health">
      <div className="px-5 pt-4 pb-3">
        <h2 id="c5-h" className="m-0 text-[17px] font-semibold text-ink">Stores and carriers needing attention</h2>
        <p className="m-0 mt-1 text-[13px] text-muted">Checked {fmtDateTime(data.checked_at)} (UTC). Keys are never shown here.</p>
      </div>
      {msg && <div className="px-5 pb-3"><DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Not done'} testId="c5-health-msg">{msg.message}</DsNotice></div>}

      <h3 className="m-0 px-5 pt-2 pb-2 text-[15px] font-semibold text-ink">Store connections in error</h3>
      {data.connections.length === 0 ? <p className="m-0 px-5 pb-4 text-[14px] text-muted" data-testid="c5-connections-empty">No store connection has a problem.</p> : (
        <div className="ds-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Store connections in error">
          <table className="w-full min-w-[860px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted"><tr>
              <th scope="col" className={`${th} pl-5`}>Merchant</th><th scope="col" className={th}>Store</th><th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Problem</th><th scope="col" className={`${th} pr-5`}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {data.connections.map((c) => {
                const st = CONNECTION_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const };
                return (
                  <tr key={c.id} className="border-t border-divider" data-testid={`c5-conn-${c.id}`}>
                    <td className={`${td} pl-5 font-semibold text-ink`}>{c.merchant}</td>
                    <td className={td}>{platformName(c.platform)} · <span className="break-all">{c.shop}</span></td>
                    <td className={td}><DsBadge tone={st.tone}>{st.label}</DsBadge></td>
                    <td className={`${td} text-[13px]`}>{c.last_error ?? 'The connection did not finish.'}{c.at && <span className="block text-muted">{fmtDateTime(c.at)}</span>}</td>
                    <td className={`${td} pr-5`}>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <DsButton variant="secondary" icon="refresh" loading={pending} disabled={!data.can_edit} disabledReason={noEdit} onClick={() => run(() => retryConnectionAction(c.id))} testId={`c5-retry-${c.id}`}>Retry<span className="sr-only"> {c.shop}</span></DsButton>
                        <DsButton variant="secondary" icon="send" loading={pending} disabled={!data.can_edit} disabledReason={noEdit} onClick={() => run(() => contactMerchantAction(c.id))} testId={`c5-contact-${c.id}`}>Contact merchant<span className="sr-only"> {c.merchant}</span></DsButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="m-0 px-5 pt-4 pb-2 text-[15px] font-semibold text-ink">Store updates that failed</h3>
      {data.failed_tasks.length === 0 ? <p className="m-0 px-5 pb-4 text-[14px] text-muted" data-testid="c5-tasks-empty">No tracking or cancellation update failed.</p> : (
        <div className="ds-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Store updates that failed">
          <table className="w-full min-w-[820px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted"><tr>
              <th scope="col" className={`${th} pl-5`}>Merchant</th><th scope="col" className={th}>Order</th><th scope="col" className={th}>Update</th>
              <th scope="col" className={th}>Tries</th><th scope="col" className={th}>Last error</th><th scope="col" className={`${th} pr-5`}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {data.failed_tasks.map((t) => (
                <tr key={t.id} className="border-t border-divider" data-testid={`c5-task-${t.id}`}>
                  <td className={`${td} pl-5 font-semibold text-ink`}>{t.merchant}</td>
                  <td className={td}>{t.external_order_name ?? t.order_number} <span className="text-muted">· {platformName(t.platform)}</span></td>
                  <td className={td}>{TASK_LABEL[t.action] ?? t.action}</td>
                  <td className={td}>{t.attempts}</td>
                  <td className={`${td} text-[13px]`}>{t.last_error ?? '—'}</td>
                  <td className={`${td} pr-5 text-right`}>
                    <DsButton variant="secondary" icon="refresh" loading={pending} disabled={!data.can_edit} disabledReason={noEdit} onClick={() => run(() => retryStoreTaskAction(t.id))} testId={`c5-task-retry-${t.id}`}>Retry<span className="sr-only"> {t.order_number}</span></DsButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="m-0 px-5 pt-4 pb-2 text-[15px] font-semibold text-ink">Carrier accounts</h3>
      {data.carriers.length === 0 ? <p className="m-0 px-5 pb-5 text-[14px] text-muted">No carrier account yet.</p> : (
        <div className="ds-scroll overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Carrier accounts">
          <table className="w-full min-w-[820px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted"><tr>
              <th scope="col" className={`${th} pl-5`}>Account</th><th scope="col" className={th}>Warehouse</th><th scope="col" className={th}>Last connection test</th>
              <th scope="col" className={th}>Failures (24 h)</th><th scope="col" className={`${th} pr-5`}>Last carrier error</th>
            </tr></thead>
            <tbody>
              {data.carriers.map((a) => (
                <tr key={a.id} className="border-t border-divider" data-testid={`c5-carrier-${a.id}`}>
                  <td className={`${td} pl-5`}><span className="font-semibold text-ink">{a.name}</span> <span className="text-muted">· {CARRIER[a.carrier] ?? a.carrier}</span>
                    {a.mode === 'sandbox' && <DsBadge tone="warn" className="ml-2">Sandbox</DsBadge>}{!a.active && <DsBadge tone="neutral" className="ml-2">Off</DsBadge>}</td>
                  <td className={td}>{a.warehouse_code}</td>
                  <td className={td}>{a.last_check_at ? <><DsBadge tone={a.last_check_ok ? 'ok' : 'bad'}>{a.last_check_ok ? 'Worked' : 'Failed'}</DsBadge><span className="block text-[12px] text-muted">{fmtDateTime(a.last_check_at)}</span></> : <span className="text-muted">Not tested yet</span>}</td>
                  <td className={td}>{a.failures_24h ? <span className="text-bad font-semibold">{a.failures_24h}</span> : 0}</td>
                  <td className={`${td} pr-5 text-[13px]`}>{a.last_error ? <>{a.last_error}{a.last_error_at && <span className="block text-muted">{fmtDateTime(a.last_error_at)}</span>}</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
