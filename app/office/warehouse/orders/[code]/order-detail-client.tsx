'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsLinkButton, DsNotice, DsSelect, DsTableCard, DsTimeline } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { DG_LABEL, HISTORY_TEXT, SCAN_RESULT, SOURCE_TEXT, addressText, grams, type OrderDetail } from '@/lib/warehouse-orders';
import { cancelOrderStaffAction, resolveExceptionAction, retryAllocationAction, unlockOverrideAction } from '../../order-actions';
import { MsgLine, useRun } from '../../wh-run';
import { DgBadge, EvidenceGallery, OrderStatusBadge } from '../order-bits';

/** Volumetric weight in grams at the common ÷5000 divisor (cm³ / 5000 = kg); carriers' own divisors come with dispatch rules. */
const volumetric = (b: { length_mm: number | null; width_mm: number | null; height_mm: number | null } | null) =>
  b && b.length_mm && b.width_mm && b.height_mm ? Math.ceil(((b.length_mm / 10) * (b.width_mm / 10) * (b.height_mm / 10)) / 5) : null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="text-muted">{label}</dt><dd className="m-0">{children}</dd></>;
}

export function OrderDetailClient({ detail: d }: { detail: OrderDetail }) {
  const o = d.order;
  const act = useRun();
  const [action, setAction] = useState<'retry' | 'ship_short' | 'cancel'>('retry');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const diff = o.expected_weight_g != null && o.measured_weight_g != null ? o.measured_weight_g - o.expected_weight_g : null;
  const within = diff != null && o.tolerance_g != null ? Math.abs(diff) <= o.tolerance_g : null;
  const vol = volumetric(o.box);
  const canCancel = d.can_resolve && ['new', 'allocated', 'picking'].includes(o.status) && o.picked === 0;
  return (
    <div className="flex flex-col gap-4">
      <DsCard title={o.code} icon="cart" testId="wh-order-summary" actions={<><OrderStatusBadge status={o.status} testId="wh-order-status" /><DgBadge kinds={o.dg_kinds} /></>}>
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <Row label="Owner">{o.owner}</Row>
          <Row label="Source">{SOURCE_TEXT[o.source] ?? o.source}{o.store_order ? ` · ${o.store_order}` : ''}{o.external_ref ? ` · ref ${o.external_ref}` : ''}</Row>
          <Row label="Ship to">{o.ship_name}{o.ship_phone ? ` · ${o.ship_phone}` : ''}<div className="text-muted">{addressText(o.ship_address, o.ship_country)}</div></Row>
          <Row label="Warehouse">{o.warehouse_code}</Row>
          <Row label="Received">{fmtWh(o.created_at)}{o.created_by_name ? ` · ${o.created_by_name}` : ''}</Row>
          {o.allocated_at && <Row label="Stock reserved">{fmtWh(o.allocated_at)}</Row>}
          {o.picked_at && <Row label="Picked">{fmtWh(o.picked_at)}</Row>}
          {o.packed_at && <Row label="Packed">{fmtWh(o.packed_at)}{o.packed_by_name ? ` · ${o.packed_by_name}` : ''}</Row>}
          {o.exception_reason && <Row label="Exception"><span className="text-bad">{o.exception_reason}</span></Row>}
          {o.cancel_reason && <Row label="Cancelled">{o.cancel_reason}</Row>}
        </dl>
        {o.store_order_cancelled && !['cancelled', 'packed'].includes(o.status) && (
          <div className="mt-3"><DsNotice tone="bad" title="The Dropship order was cancelled">Don’t pick or pack it. A supervisor cancels this warehouse order to release the stock.</DsNotice></div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {d.can_pick && ['allocated', 'picking'].includes(o.status) && <DsLinkButton href={`/office/warehouse/pick?order=${o.code}`} icon="list" testId="wh-order-go-pick">Pick this order</DsLinkButton>}
          {d.can_pack && ['picked', 'packing'].includes(o.status) && <DsLinkButton href={`/office/warehouse/pack?order=${o.code}`} icon="package" testId="wh-order-go-pack">Pack this order</DsLinkButton>}
          {['packed', 'labelled', 'shipped'].includes(o.status) && <DsLinkButton href={`/office/warehouse/evidence/${o.code}`} variant="secondary" icon="image" testId="wh-order-go-evidence">Packing evidence</DsLinkButton>}
          {o.status === 'new' && <DsButton variant="secondary" icon="refresh" disabled={act.pending} onClick={() => act.run(() => retryAllocationAction(o.id, o.code))} testId="wh-order-retry">Check stock again</DsButton>}
        </div>
        {d.can_resolve && o.status === 'exception' && (
          <form className="mt-4 grid grid-cols-1 sm:grid-cols-[200px_1fr_auto] gap-3 items-end" data-testid="wh-resolve-form"
            onSubmit={(e) => { e.preventDefault(); act.run(() => resolveExceptionAction(o.id, o.code, action, reason), () => setReason('')); }}>
            <DsSelect label="Resolution" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
              <option value="retry">Pick again</option>
              <option value="ship_short" disabled={o.picked === 0}>Pack what was picked (ship short)</option>
              <option value="cancel" disabled={o.picked > 0}>Cancel the order</option>
            </DsSelect>
            <DsInput label="What was decided" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <DsButton type="submit" disabled={act.pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter the resolution' : undefined} testId="wh-resolve-submit">Resolve</DsButton>
          </form>
        )}
        {canCancel && (
          <form className="mt-4 flex flex-wrap gap-2 items-end" data-testid="wh-cancel-form"
            onSubmit={(e) => { e.preventDefault(); act.run(() => cancelOrderStaffAction(o.id, o.code, cancelReason)); }}>
            <DsInput label="Cancel this order — why?" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
            <DsButton type="submit" variant="danger" disabled={act.pending || !cancelReason.trim()}>Cancel order</DsButton>
          </form>
        )}
        <div className="mt-2"><MsgLine msg={act.msg} testId="wh-order-msg" /></div>
      </DsCard>

      <DsCard title="Box and weight" icon="scale" testId="wh-order-weight">
        <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <Row label="Box">{o.box ? `${o.box.name} (${o.box.code}) · empty ${grams(o.box.tare_g)}${o.box.length_mm ? ` · ${o.box.length_mm}×${o.box.width_mm}×${o.box.height_mm} mm` : ''}` : 'Not chosen yet'}</Row>
          <Row label="Expected weight">{o.box ? (o.expected_weight_g == null ? 'Unknown — a product has no weight' : `${grams(o.expected_weight_g)} ± ${o.tolerance_g} g`) : '—'}</Row>
          <Row label="Measured weight"><span data-testid="wh-order-measured">{grams(o.measured_weight_g)}</span>{o.weighed_by_name ? ` · weighed by ${o.weighed_by_name}` : ''}
            {within === true && <span className="ml-2"><DsBadge tone="ok">Inside tolerance</DsBadge></span>}
            {within === false && <span className="ml-2"><DsBadge tone="bad">{diff! > 0 ? '+' : ''}{diff} g · outside tolerance</DsBadge></span>}
          </Row>
          <Row label="Volumetric (÷5000)">{vol == null ? '—' : grams(vol)}</Row>
          <Row label="Tolerance rule">{d.settings.tolerance_g} g or {d.settings.tolerance_pct} %, whichever is larger</Row>
          {o.override_by_name && <Row label="Supervisor approval">{o.override_by_name} · {grams(o.override_weight_g)} · “{o.override_reason}” · {fmtWh(o.override_at)}</Row>}
          {o.has_dangerous_goods && <Row label="Battery mark">{o.battery_mark ? 'Applied' : 'Not yet'}</Row>}
        </dl>
        {o.override_locked_at && (
          <div className="mt-3 flex flex-col gap-3" data-testid="wh-override-locked">
            <DsNotice tone="bad" title="Override locked">Three wrong PINs at {fmtWh(o.override_locked_at)}. A warehouse admin unlocks it.</DsNotice>
            {d.can_unlock && (
              <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); act.run(() => unlockOverrideAction(o.id, o.code, unlockReason), () => setUnlockReason('')); }}>
                <DsInput label="Why unlock?" value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} maxLength={300} />
                <DsButton type="submit" variant="secondary" icon="lock" disabled={act.pending || !unlockReason.trim()} testId="wh-unlock-submit">Unlock override</DsButton>
              </form>
            )}
          </div>
        )}
        {d.attempts.length > 0 && (
          <ul className="mt-3 mb-0 pl-5 text-[13px]" data-testid="wh-override-attempts">
            {d.attempts.map((a, i) => (
              <li key={i}>{fmtWh(a.at)} · {a.supervisor_name ?? 'supervisor'} · {a.ok ? 'PIN accepted' : 'wrong PIN'}{a.reason ? ` · “${a.reason}”` : ''}{a.by_name ? ` · at ${a.by_name}’s station` : ''}</li>
            ))}
          </ul>
        )}
      </DsCard>

      <DsTableCard title="Lines" icon="box" testId="wh-order-lines" minWidth={720} headers={['SKU', 'Product', 'Ordered', 'Picked', 'Short', 'Packed', 'Unit weight', 'Dangerous goods']}>
        {d.lines.map((l) => (
          <tr key={l.id} data-testid={`wh-order-line-${l.sku}`}>
            <td className="font-mono">{l.sku}</td><td>{l.name}</td><td>{l.qty}</td><td>{l.picked}</td><td>{l.short || '—'}</td><td>{l.packed}</td>
            <td>{grams(l.unit_weight_g)}</td><td>{l.dg.length ? l.dg.map((k) => DG_LABEL[k] ?? k).join(', ') : '—'}</td>
          </tr>
        ))}
      </DsTableCard>

      {d.picks.length > 0 && (
        <DsTableCard title="Picked from" icon="list" testId="wh-order-picks" minWidth={640} headers={['SKU', 'Bin', 'Lot', 'Pallet', 'Units', 'By', 'When']}>
          {d.picks.map((p, i) => (
            <tr key={i}><td className="font-mono">{p.sku}</td><td className="font-mono">{p.bin}</td><td className="font-mono">{p.lot}</td><td>{p.pallet ?? '—'}</td><td>{p.qty}</td><td>{p.by_name ?? '—'}</td><td>{fmtWh(p.at)}</td></tr>
          ))}
        </DsTableCard>
      )}

      <DsCard title="Packing photos" icon="image" testId="wh-order-photos" actions={<Link href={`/office/warehouse/evidence/${o.code}`} className="text-[13px] font-semibold text-coral-text underline">Evidence view</Link>}>
        <EvidenceGallery items={d.evidence} />
      </DsCard>

      {d.scans.length > 0 && (
        <DsTableCard title="Scan log" icon="activity" testId="wh-order-scans" minWidth={600} headers={['When', 'Station', 'Scanned', 'Result', 'Units', 'By']}>
          {d.scans.map((s, i) => (
            <tr key={i}><td>{fmtWh(s.at)}</td><td>{s.station === 'pick' ? 'Picking' : 'Packing'}</td><td className="font-mono">{s.code}</td>
              <td>{s.result === 'ok' ? <DsBadge tone="ok">{SCAN_RESULT.ok}</DsBadge> : <DsBadge tone="bad">{SCAN_RESULT[s.result] ?? s.result}</DsBadge>}</td><td>{s.qty}</td><td>{s.by_name ?? '—'}</td></tr>
          ))}
        </DsTableCard>
      )}

      <DsCard title="History" icon="clock" testId="wh-order-history">
        <DsTimeline events={d.history.map((h) => ({
          title: HISTORY_TEXT[h.action] ?? h.action,
          timestamp: fmtWh(h.at),
          detail: [h.by_name, typeof h.details?.sku === 'string' ? `${h.details.sku} × ${h.details.qty}` : null, typeof h.details?.bin === 'string' ? `from ${h.details.bin}` : null,
            typeof h.details?.reason === 'string' ? `“${h.details.reason}”` : null, typeof h.details?.measured_g === 'number' ? `${h.details.measured_g} g` : null]
            .filter(Boolean).join(' · ') || undefined,
        }))} />
      </DsCard>
    </div>
  );
}
