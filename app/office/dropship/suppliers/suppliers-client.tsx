'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTableCard } from '@/components/dropship-ui';
import { ORDER_STATUS, carrierLabel, countryName, fmtDay } from '@/lib/dropship-ds14-shared';
import type { StaffSuppliers } from '@/lib/dropship-ds14';
import { assignPartnerAction, cancelPartnerOrderAction, createSupplierAccountAction } from '../ds14-actions';

export function SuppliersClient({ data, canEdit }: { data: StaffSuppliers; canEdit: boolean }) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(data.link_candidates[0]?.id ?? '');
  const [email, setEmail] = useState(data.link_candidates[0]?.email ?? '');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const done = (r: { ok: boolean; message?: string }, okText: string) => { setMsg(r.ok ? { ok: true, text: r.message ?? okText } : { ok: false, text: r.message ?? 'Could not save.' }); if (r.ok) router.refresh(); };
  return (
    <div className="flex flex-col gap-5" data-testid="staff-suppliers-page">
      <DsPageHeader title="Suppliers" subtitle="Manage where products and stock come from." icon="users"
        actions={<><DsLinkButton href="/office/kyc?f=suppliers" variant="secondary" icon="file">Applications</DsLinkButton><DsLinkButton href="/admin/suppliers" variant="secondary" icon="link">All supplier records</DsLinkButton></>} />
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Could not do that'} testId="suppliers-msg">{msg.text}</DsNotice>}

      <DsTableCard title="Partner suppliers" subtitle="Suppliers with a portal account or products in the Dropship catalog." headers={['Supplier', 'Portal', 'Linked products', 'Open orders', 'In review']} minWidth={640} testId="partner-suppliers">
        {data.suppliers.length === 0 ? <tr><td colSpan={5}>No partner suppliers yet. Approve an application, then create the supplier and its portal account.</td></tr> : data.suppliers.map((s) => (
          <tr key={s.id} data-testid="partner-supplier-row">
            <td className="font-semibold">{s.code}<div className="text-[12px] text-[#5B6478] font-normal">{s.name}</div></td>
            <td>{s.portal_user ? <DsBadge tone={s.portal_on ? 'ok' : 'warn'}>{s.portal_on ? 'Portal on' : 'Portal off'}</DsBadge> : <DsBadge tone="neutral">No account</DsBadge>}{s.portal_user && <div className="text-[12px] text-[#5B6478]">{s.portal_user}</div>}</td>
            <td>{s.products}</td><td>{s.open_orders}</td><td>{s.in_review}</td>
          </tr>
        ))}
      </DsTableCard>

      <DsCard title="Create a portal account" subtitle="Only verified suppliers. The supplier gets an email to set a password. Use an address that is not a staff or merchant login." icon="user">
        {data.link_candidates.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">Every verified supplier already has a portal account.</p> : (
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <DsSelect label="Supplier" value={supplier} onChange={(e) => { setSupplier(e.target.value); setEmail(data.link_candidates.find((c) => c.id === e.target.value)?.email ?? ''); }}>
              {data.link_candidates.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </DsSelect>
            <DsInput label="Contact email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div><DsButton onClick={() => start(async () => done(await createSupplierAccountAction(supplier, email), 'Account created.'))} loading={pending} disabled={!canEdit} disabledReason={!canEdit ? 'Needs Dropship division access' : undefined} icon="send">Send invitation</DsButton></div>
          </div>
        )}
      </DsCard>

      <DsTableCard title="Paid orders waiting for a partner supplier" subtitle="Items from a partner supplier ship straight from that supplier to the buyer. Assigning cancels the automatic warehouse hand-over for the order." headers={['Order', 'Supplier', 'Country', 'Paid', '']} minWidth={640} testId="unassigned-orders">
        {data.unassigned.length === 0 ? <tr><td colSpan={5}>No paid partner orders are waiting.</td></tr> : data.unassigned.map((o) => (
          <tr key={o.id} data-testid="unassigned-row">
            <td className="font-semibold">{o.order}</td><td>{o.suppliers ?? '—'}</td><td>{countryName(o.country)}</td><td>{fmtDay(o.created_at)}</td>
            <td>{o.mixed ? <DsBadge tone="neutral">Warehouse items: use the warehouse path</DsBadge>
              : <DsButton variant="secondary" onClick={() => start(async () => done(await assignPartnerAction(o.id), 'Order sent to the supplier.'))} loading={pending} disabled={!canEdit} disabledReason={!canEdit ? 'Needs Dropship division access' : undefined} aria-label={`Send order ${o.order} to the supplier`}>Send to supplier</DsButton>}</td>
          </tr>
        ))}
      </DsTableCard>

      <DsTableCard title="Partner orders" headers={['Order', 'Supplier', 'Status', 'Tracking', 'Ship by', '']} minWidth={760} testId="partner-orders">
        {data.partner_orders.length === 0 ? <tr><td colSpan={6}>No orders have gone to a partner supplier yet.</td></tr> : data.partner_orders.map((p) => {
          const st = ORDER_STATUS[p.status];
          const open = p.status === 'to_ship' || p.status === 'problem';
          return (
            <tr key={p.id}>
              <td className="font-semibold">{p.order}</td><td>{p.supplier_code}</td>
              <td><DsBadge tone={st.tone}>{p.status === 'cancelled' ? 'Taken back' : st.label}</DsBadge>{p.problem_note && <div className="text-[12px] text-[#8A5300]">{p.problem_note}</div>}</td>
              <td>{p.tracking_no ? `${carrierLabel(p.carrier)} · ${p.tracking_no}` : '—'}</td><td>{p.ship_by ? fmtDay(p.ship_by) : '—'}</td>
              <td>{open && canEdit && (
                <div className="flex gap-2 items-end">
                  <DsInput label="Reason" aria-label={`Reason to take back ${p.order}`} value={reasons[p.id] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))} containerClassName="w-[200px]" />
                  <DsButton variant="secondary" onClick={() => start(async () => done(await cancelPartnerOrderAction(p.id, reasons[p.id] ?? ''), 'Order taken back.'))} loading={pending}>Take back</DsButton>
                </div>)}</td>
            </tr>
          );
        })}
      </DsTableCard>

      <DsCard title="Sources" subtitle="Where products and stock come from" icon="layers">
        <DsEmptyState title="DSers and Alibaba are not connected yet" description="Marketplace and order-forwarding connections open in the store-connection release. Nothing is synced and no credentials are stored. Partner suppliers above work through the supplier portal." icon="link" />
        <p className="text-[12px] text-[#5B6478] mt-3 mb-0">Merchants never see supplier or source names. Full supplier details: <Link className="text-[#2A6FD1] underline" href="/admin/suppliers">Admin › Suppliers</Link>.</p>
      </DsCard>
    </div>
  );
}
