'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsDialog, DsTableCard } from '@/components/dropship-ui';
import { CONNECTION_STATUS, platformName } from '@/lib/connectors/platforms';
import { fmtDate } from '@/lib/format';
import type { ChannelsPage } from '@/lib/dropship-ds14';
import { disconnectStoreAction, type C1Result } from './c1-actions';

type Conn = NonNullable<ChannelsPage['connections']>[number];

/**
 * CONN S1 · "Your stores": every connected / connecting store of any platform, with its last sync and last problem (never a key).
 * Disconnect asks first. The result message is held by the parent (IntegrationsClient), so it stays visible when the store leaves
 * the refreshed list.
 */
export function YourStoresCard({ connections, onResult }: { connections: Conn[]; onResult: (r: C1Result) => void }) {
  const [ask, setAsk] = useState<Conn | null>(null);
  const [pending, start] = useTransition();
  if (!connections.length) return null;
  const disconnect = (c: Conn) => start(async () => {
    setAsk(null);
    onResult(await disconnectStoreAction(c.id));
  });
  return (
    <>
      <DsTableCard title="Your stores" subtitle="Stores connected to your account. Orders come in and tracking goes out automatically." icon="link"
        headers={['Store', 'Platform', 'Status', 'Last order check', '']} minWidth={640} testId="your-stores">
        {connections.map((c) => {
          const st = CONNECTION_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const };
          return (
            <tr key={c.id} data-testid={`store-row-${c.id}`}>
              <td className="font-semibold break-all">{c.shop}{c.last_error && <span className="block text-[12px] font-normal text-bad" data-testid={`store-error-${c.id}`}>{c.last_error}</span>}</td>
              <td>{platformName(c.platform)}</td>
              <td><DsBadge tone={st.tone}>{st.label}</DsBadge></td>
              <td>{c.last_sync_at ? fmtDate(c.last_sync_at, true) : 'Not yet'}</td>
              <td className="text-right">
                {c.platform !== 'shopify' && (
                  <DsButton variant="secondary" icon="x" loading={pending} onClick={() => setAsk(c)} testId={`store-disconnect-${c.id}`}>Disconnect</DsButton>
                )}
              </td>
            </tr>
          );
        })}
      </DsTableCard>
      {ask && (
        <DsDialog title={`Disconnect ${ask.shop}?`} testId="store-disconnect-dialog"
          description="We stop reading new orders and sending tracking to this store, and delete its access keys. Orders already received stay in Octopus. You can connect it again later."
          confirmLabel="Disconnect" cancelLabel="Keep connected" onConfirm={() => disconnect(ask)} onCancel={() => setAsk(null)} />
      )}
    </>
  );
}
