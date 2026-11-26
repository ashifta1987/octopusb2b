'use client';

import { useState, useTransition } from 'react';
import { DsButton, DsCard, DsInput, DsNotice, DsPageHeader, DsSelect } from '@/components/dropship-ui';
import { createTestOrderAction } from './actions';

const COUNTRIES = ['AE', 'SA', 'US', 'GB', 'DE', 'FR', 'NL', 'AU', 'CA', 'SG', 'KW', 'QA', 'BH', 'OM'];

/** STAGING ONLY — a store order for a merchant, sent through the same intake as the store webhook. */
export function TestOrderClient({ merchants }: { merchants: { id: string; name: string; status: string }[] }) {
  const [f, setF] = useState({
    org_id: merchants[0]?.id ?? '', external_order_id: '', model_no: 'DS-000001-01', qty: '1', other_items: '0', risk: 'low', address_check: 'ok',
    address_issue: '', buyer_name: 'Test Buyer', line1: '12 Marina Walk', city: 'Dubai', postcode: '', country: 'AE',
  });
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setRes(null);
    start(async () => {
      setRes(await createTestOrderAction({
        ...f, qty: Number(f.qty), other_items: Number(f.other_items), risk: f.risk as 'low' | 'medium' | 'high', address_check: f.address_check as 'ok' | 'failed',
      }));
    });
  }
  return (
    <div className="flex flex-col gap-5" data-testid="ds-test-order">
      <DsPageHeader title="Test order (staging)" icon="cart"
        subtitle="Creates a store order for a merchant through the same intake the store connection will use. Staging only; the order is marked as a test." />
      {res && <DsNotice tone={res.ok ? 'ok' : 'bad'} title={res.ok ? 'Order sent to intake' : 'Not created'} testId="test-order-result">{res.message}</DsNotice>}
      <DsCard>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <DsSelect label="Merchant" value={f.org_id} onChange={set('org_id')} containerClassName="sm:col-span-2">
            {merchants.map((m) => <option key={m.id} value={m.id}>{`${m.name}${m.status !== 'on' ? ` (${m.status})` : ''}`}</option>)}
          </DsSelect>
          <DsInput label="Store order number (optional)" value={f.external_order_id} onChange={set('external_order_id')} hint="Same number twice = duplicate, ignored." />
          <DsInput label="DS variant model no." value={f.model_no} onChange={set('model_no')} />
          <DsInput label="Quantity" type="number" min={1} max={50} value={f.qty} onChange={set('qty')} />
          <DsInput label="Items not from Octopus" type="number" min={0} max={20} value={f.other_items} onChange={set('other_items')} />
          <DsSelect label="Store risk rating" value={f.risk} onChange={set('risk')}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </DsSelect>
          <DsSelect label="Store address check" value={f.address_check} onChange={set('address_check')}>
            <option value="ok">Passed</option><option value="failed">Failed</option>
          </DsSelect>
          <DsInput label="Address check message" value={f.address_issue} onChange={set('address_issue')} containerClassName="sm:col-span-2" />
          <DsInput label="Buyer name" value={f.buyer_name} onChange={set('buyer_name')} />
          <DsInput label="Street address" value={f.line1} onChange={set('line1')} />
          <DsInput label="City" value={f.city} onChange={set('city')} />
          <DsInput label="Postcode" value={f.postcode} onChange={set('postcode')} />
          <DsSelect label="Country" value={f.country} onChange={set('country')}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </DsSelect>
          <div className="sm:col-span-2">
            <DsButton type="submit" icon="send" loading={pending} disabled={pending || !f.org_id} disabledReason={!f.org_id ? 'No Dropship merchant yet.' : undefined} testId="test-order-submit">Send to intake</DsButton>
          </div>
        </form>
      </DsCard>
    </div>
  );
}
