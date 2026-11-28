import 'server-only';
/**
 * ODS /account/orders data (RLS client: a customer only ever reads their own organisation's rows). Queries are TODAY's
 * (app/account/orders/page.tsx and app/account/orders/[id]/page.tsx) with explicit, customer-safe columns — no supplier,
 * factory, cost or margin columns. No writes here.
 */
import { unstable_rethrow } from 'next/navigation';
import { requireAccount } from '../../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { humanize } from '@/lib/format';
import { serviceName } from '@/lib/service-names';
import { customerCarrierLabel } from '@/lib/carrier-label';
import { bankLines } from '@/lib/bank-accounts';
import { resolveActiveOnlineProvider, type PaymentProviderSettingRow } from '@/lib/payments';
import { getSettings, getWalletFunds } from '@/components/account/data';
import { getCompanyBankAccount } from '@/components/account/bank-data';
import { CANCELLABLE, dueNow, nowMs } from '@/components/account/order-utils';
import { DOC_TYPE_LABEL, CUSTOMER_DOC_TYPES, UUID_RE, dateText, isCustomerDocType, moneyText } from './commerce-format';
import { docStatusName } from '../../invoices/_lib/invoice-logic';
import {
  currentStepIndex,
  holdStatusName,
  isDisputed,
  orderStatusName,
  paymentChoices,
  paymentMethodLabel,
  paymentPurposeLabel,
  paymentStatusName,
  payLaterChoice,
  serviceFromDivision,
  stepsForService,
  toOrderRow,
  type CreditStatusLike,
  type OptionRow,
  type OrderRowVM,
  type OrderSource,
} from './order-logic';
import type { OrderDetailVM, OrderHoldVM, OrderPaymentPanelVM } from './order-types';

async function divisionCodes(sb: Awaited<ReturnType<typeof createClient>>): Promise<Map<string, string>> {
  const { data } = await sb.from('divisions').select('id, code');
  return new Map((data ?? []).map((d) => [d.id as string, d.code as string]));
}

/** Every order of the signed-in customer's company (newest first, ≤ 500), mapped for the list. Throws on a failed read. */
export async function loadOrderRows(): Promise<OrderRowVM[]> {
  const s = await requireAccount('/account/orders');
  const sb = await createClient();
  const [{ data, error }, divs] = await Promise.all([
    sb
      .from('orders')
      .select('id, code, title, quantity, status, total_cents, paid_cents, deposit_cents, currency, created_at, updated_at, delivered_at, division_id, pool_id')
      .eq('org_id', s.org!.id)
      .order('updated_at', { ascending: false })
      .limit(500),
    divisionCodes(sb),
  ]);
  if (error) throw new Error('orders');
  const ids = (data ?? []).map((o) => o.id as string);
  const { data: ships } = ids.length ? await sb.from('shipments').select('order_id').in('order_id', ids) : { data: [] as { order_id: string }[] };
  const shipped = new Set((ships ?? []).map((x) => x.order_id as string));
  return (data ?? []).map((o) =>
    toOrderRow({
      id: o.id as string,
      code: o.code as string,
      title: o.title as string,
      quantity: Number(o.quantity),
      status: o.status as string,
      total_cents: Number(o.total_cents),
      paid_cents: Number(o.paid_cents),
      deposit_cents: Number(o.deposit_cents),
      currency: (o.currency as string) ?? 'USD',
      created_at: o.created_at as string,
      updated_at: o.updated_at as string,
      delivered_at: (o.delivered_at as string | null) ?? null,
      service: serviceFromDivision(o.division_id ? divs.get(o.division_id as string) : null),
      pool: !!o.pool_id,
      hasShipment: shipped.has(o.id as string),
    } satisfies OrderSource),
  );
}

type Sb = Awaited<ReturnType<typeof createClient>>;
const safe = async <T,>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
  try {
    const { data, error } = await p;
    return error ? null : data;
  } catch {
    return null;
  }
};

/** One order by code (OCT-…) or id (today's links). null = not found / not visible (RLS). */
export async function loadOrderDetail(ref: string, opts: { created?: boolean } = {}): Promise<OrderDetailVM | null> {
  const s = await requireAccount(`/account/orders/${encodeURIComponent(ref)}`);
  const sb: Sb = await createClient();
  const { data: o } = await sb
    .from('orders')
    .select('id, code, org_id, division_id, rfq_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, incoterm, delivered_at, claim_visible_until, claim_hidden_until, created_at, updated_at, currency, pool_id')
    .eq(UUID_RE.test(ref) ? 'id' : 'code', ref)
    .eq('org_id', s.org!.id)
    .maybeSingle();
  if (!o) return null;
  const id = o.id as string;
  const cur = ((o.currency as string) ?? 'USD').trim() || 'USD';
  const now = nowMs();

  const [docs, events, shipments, pi, divRow, holdRow, resRow, providerRows, payRows, tickets, rfq, settings, funds, content, creditData] = await Promise.all([
    safe(sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, due_at, created_at').eq('order_id', id).in('doc_type', [...CUSTOMER_DOC_TYPES]).order('created_at')),
    safe(sb.from('order_events').select('id, kind, title, body, created_at').eq('order_id', id).order('created_at', { ascending: false })),
    safe(sb.from('shipments').select('id, code, service_code, tracking_no, status, weight_kg, parcels, eta, last_event_at, created_at').eq('order_id', id).order('created_at', { ascending: false })),
    safe(sb.from('proforma_invoices').select('number').eq('order_id', id).maybeSingle()),
    o.division_id ? safe(sb.from('divisions').select('code').eq('id', o.division_id).maybeSingle()) : Promise.resolve(null),
    safe(sb.from('escrow_holds').select('id, amount_cents, released_cents, refunded_cents, currency, release_rule, milestone_label, status, dispute_reason').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()),
    safe(sb.from('credit_reservations').select('id, status, net_days, invoice_trigger, amount_cents').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()),
    safe(sb.from('payment_provider_settings').select('provider, display_name, enabled, methods, priority, legal_entity_id, fee_mode, fee_bp, fee_fixed_cents').eq('enabled', true).order('priority', { ascending: true })),
    safe(sb.from('payments').select('id, purpose, method, amount_cents, currency, reference, status, created_at, confirmed_at').eq('order_id', id).order('created_at')),
    safe(sb.from('tickets').select('id, code, subject, status, updated_at').eq('order_id', id).order('updated_at', { ascending: false })),
    o.rfq_id ? safe(sb.from('rfqs').select('code').eq('id', o.rfq_id).maybeSingle()) : Promise.resolve(null),
    getSettings(),
    getWalletFunds(cur),
    getSiteContent(),
    // today's order page: Pay later eligibility per company + division
    safe(sb.rpc('get_customer_credit_status', { p_org: o.org_id, p_division: o.division_id ?? null })),
  ]);

  const service = serviceFromDivision((divRow as { code?: string } | null)?.code ?? null);
  const raw = o.status as string;
  const money = { status: raw, total_cents: Number(o.total_cents), deposit_cents: Number(o.deposit_cents), paid_cents: Number(o.paid_cents) };
  const due = dueNow(money);
  const balanceCents = money.total_cents - money.paid_cents;
  const depositLeft = Math.max(0, money.deposit_cents - money.paid_cents);

  // ── payment panel (today's data; the buttons call today's actions) ──
  let payment: OrderPaymentPanelVM | null = null;
  const showPayment = raw !== 'cancelled' && (!!due || depositLeft > 0 || !!holdRow || !!resRow);
  try {
    const { data: optionRows } = await sb
      .from('payment_option_settings')
      .select('service, option, enabled, min_amount_cents, max_amount_cents, release_rule, auto_release_days, pay_later_invoice_trigger')
      .eq('service', service);
    const provider = resolveActiveOnlineProvider(((providerRows ?? []) as unknown) as PaymentProviderSettingRow[]);
    const acct = await getCompanyBankAccount(cur);
    const bankBlock = content.blocks['payment.bank_details'] ?? content.blocks['bank.details'] ?? null;
    const h = holdRow as { id: string; amount_cents: number; released_cents: number; refunded_cents: number; currency: string; milestone_label: string; status: string; dispute_reason: string | null } | null;
    const held = h ? Number(h.amount_cents) - Number(h.released_cents) - Number(h.refunded_cents) : 0;
    const hold: OrderHoldVM | null = h
      ? {
          id: h.id,
          heldCents: held,
          currency: (h.currency ?? '').trim() || 'USD',
          milestone: h.milestone_label,
          statusName: holdStatusName(h.status),
          disputed: h.status === 'disputed',
          disputeReason: h.dispute_reason ?? null,
          canDispute: (h.status === 'held' || h.status === 'partially_released') && held > 0,
        }
      : null;
    const r = resRow as { status: string; net_days: number; invoice_trigger: string; amount_cents: number } | null;
    const amountCents = due?.amount ?? (depositLeft > 0 ? Math.max(0, balanceCents) : 0);
    const options = ((optionRows ?? []) as unknown) as OptionRow[];
    const credit = (creditData as CreditStatusLike | null) ?? null;
    const later = payLaterChoice({ amountCents, options, credit, hasHold: !!hold, reservationReserved: r?.status === 'reserved', cancelled: raw === 'cancelled' });
    payment = {
      service,
      currencyCode: (cur as 'USD' | 'CNY' | 'HKD') ?? 'USD',
      amountCents,
      duePurpose: due?.purpose ?? null,
      choices: paymentChoices({
        dueAmount: due?.amount ?? null,
        amountCents,
        walletEnabled: Boolean(settings.wallet_enabled),
        hasHold: !!hold,
        hasReservation: !!r,
        options,
        hasProvider: !!provider,
        cancelled: raw === 'cancelled',
      }),
      walletBalanceCents: funds.balance,
      walletCreditCents: funds.credit,
      reference: (pi as { number?: string } | null)?.number ?? (o.code as string),
      bankLines: acct ? bankLines(acct) : [['Account name', content.company?.legal_name ?? 'Shenzhen Octopus Trading Co., Ltd.']],
      bankNotes: acct?.notes ?? bankBlock,
      providerName: provider?.display_name ?? null,
      providerSurcharge: provider?.fee_mode === 'surcharge',
      hold,
      payLater:
        later.show && credit
          ? {
              allowed: later.allowed,
              netDays: Number(credit.net_days),
              availableCents: Number(credit.available_cents),
              limitCents: Number(credit.credit_limit_cents),
              unpaidCents: Number(credit.unpaid_invoices_cents),
              reservedCents: Number(credit.reserved_cents),
              disabledReason: later.allowed ? null : `Insufficient available credit (${moneyText(Number(credit.available_cents), cur)} available)`,
            }
          : null,
      reservation: r && r.status === 'reserved' ? { netDays: Number(r.net_days), trigger: r.invoice_trigger.replace('_', ' '), amountCents: Number(r.amount_cents) } : null,
    };
  } catch (e) {
    unstable_rethrow(e);
    payment = null;
  }

  // ── stepper with dates from today's data ──
  const steps = stepsForService(service);
  const current = currentStepIndex(steps, raw, o.delivered_at as string | null);
  const pays = (payRows ?? []) as { id: string; purpose: string; method: string; amount_cents: number; currency: string; reference: string | null; status: string; created_at: string; confirmed_at: string | null }[];
  const paidOn = (purpose: string) => pays.find((p) => p.purpose === purpose && paymentStatusName(p.status) === 'Paid');
  const docList = ((docs ?? []) as { id: string; doc_type: string; number: string; amount_cents: number | null; currency: string | null; status: string | null; due_at: string | null; created_at: string }[]).filter((d) =>
    isCustomerDocType(d.doc_type),
  );
  const qcDoc = [...docList].reverse().find((d) => d.doc_type === 'qc_report') ?? null;
  const ship = ((shipments ?? []) as { id: string; code: string; service_code: string; tracking_no: string | null; status: string; weight_kg: number | null; parcels: number | null; eta: string | null; last_event_at: string | null; created_at: string }[])[0] ?? null;
  const detailFor = (key: string): string | undefined => {
    const dep = paidOn('deposit');
    const bal = paidOn('balance');
    switch (key) {
      case 'quote':
      case 'pool':
        return `Accepted ${dateText(o.created_at as string)}`;
      case 'deposit':
      case 'payment':
        return dep ? `Paid ${dateText(dep.confirmed_at ?? dep.created_at)}` : due?.purpose === 'deposit' ? 'Due now' : undefined;
      case 'qc':
        return qcDoc ? `Report ${dateText(qcDoc.created_at)}` : undefined;
      case 'balance':
        return bal ? `Paid ${dateText(bal.confirmed_at ?? bal.created_at)}` : due?.purpose === 'balance' ? 'Due now' : undefined;
      case 'shipping':
        return ship?.eta ? `Arrives about ${dateText(ship.eta)}` : ship ? 'Booked' : undefined;
      case 'delivered':
        return o.delivered_at ? dateText(o.delivered_at as string) : undefined;
      default:
        return undefined;
    }
  };

  // ── shipping ──
  let tracking: OrderDetailVM['tracking'] = [];
  let shippingFailed = shipments === null;
  if (ship) {
    const t = await safe(sb.from('tracking_events').select('id, status, description, location, occurred_at').eq('shipment_id', ship.id).order('occurred_at', { ascending: false }));
    if (t === null) shippingFailed = true;
    tracking = ((t ?? []) as { id: string; status: string; description: string | null; location: string | null; occurred_at: string }[]).map((x) => ({
      id: x.id,
      title: x.description || humanize(x.status),
      location: x.location,
      at: x.occurred_at,
    }));
  }

  const timeline =
    events === null
      ? null
      : [
          ...tracking.map((t) => ({ id: `t-${t.id}`, title: t.title, body: [t.location, 'Tracking'].filter(Boolean).join(' · '), at: t.at })),
          ...((events ?? []) as { id: string; title: string; body: string | null; created_at: string }[]).map((e) => ({ id: `e-${e.id}`, title: e.title, body: e.body ?? null, at: e.created_at })),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // ── items: today's single order line (quote price × quantity) + shipping line when charged ──
  const unit = Number(o.unit_price_cents ?? 0);
  const shipCents = Number(o.shipping_cents ?? 0);
  const items = [
    { title: o.title as string, quantity: Number(o.quantity), unit: 'units', unitCents: unit || null, totalCents: unit ? unit * Number(o.quantity) : null },
    ...(shipCents > 0 ? [{ title: 'Shipping', quantity: 1, unit: '', unitCents: shipCents, totalCents: shipCents }] : []),
  ];

  return {
    id,
    ref: o.code as string,
    title: o.title as string,
    quantity: Number(o.quantity),
    currency: cur,
    service,
    statusName: orderStatusName(raw, { delivered_at: o.delivered_at as string | null }),
    rawStatus: raw,
    dispute: isDisputed(raw),
    createdAt: o.created_at as string,
    incoterm: (o.incoterm as string | null) ?? null,
    piNumber: (pi as { number?: string } | null)?.number ?? null,
    rfqRef: (rfq as { code?: string } | null)?.code ?? null,
    money: { totalCents: money.total_cents, depositCents: money.deposit_cents, depositPct: Number(o.deposit_pct ?? 0), paidCents: money.paid_cents, balanceCents, due },
    steps: steps.map((st) => ({ key: st.key, label: st.label, detail: detailFor(st.key) })),
    current,
    payment,
    showPayment,
    items,
    documents:
      docs === null
        ? null
        : docList.map((d) => ({
            id: d.id,
            type: d.doc_type,
            typeLabel: DOC_TYPE_LABEL[d.doc_type as keyof typeof DOC_TYPE_LABEL] ?? humanize(d.doc_type),
            number: d.number,
            amountCents: d.amount_cents == null ? null : Number(d.amount_cents),
            currency: d.currency ?? cur,
            statusName: docStatusName(d.doc_type, d.status, d.due_at, now),
            createdAt: d.created_at,
          })),
    qc: qcDoc ? { docId: qcDoc.id, number: qcDoc.number, date: qcDoc.created_at } : null,
    qcReached: current >= 0 && steps.findIndex((st) => st.key === 'qc') > -1 && current > steps.findIndex((st) => st.key === 'qc'),
    payments:
      payRows === null
        ? null
        : pays.map((p) => ({
            id: p.id,
            purpose: paymentPurposeLabel(p.purpose),
            method: paymentMethodLabel(p.method),
            amountCents: Number(p.amount_cents),
            currency: p.currency ?? cur,
            statusName: paymentStatusName(p.status),
            at: p.confirmed_at ?? p.created_at,
            reference: p.reference,
          })),
    shipment: ship
      ? {
          code: ship.code,
          method: serviceName(ship.service_code),
          trackingNo: ship.tracking_no,
          status: humanize(ship.status),
          eta: ship.eta,
          parcels: ship.parcels,
          weightKg: ship.weight_kg,
          carrier: customerCarrierLabel(settings.raw),
          location: tracking[0]?.location ?? null,
          updatedAt: ship.last_event_at ?? tracking[0]?.at ?? ship.created_at,
        }
      : null,
    tracking,
    shippingFailed,
    tickets:
      tickets === null
        ? null
        : ((tickets ?? []) as { id: string; code: string; subject: string; status: string; updated_at: string }[]).map((t) => ({
            id: t.id,
            code: t.code,
            subject: t.subject,
            open: !['closed', 'resolved'].includes(t.status),
            updatedAt: t.updated_at,
          })),
    timeline,
    cancellable: CANCELLABLE.includes(raw),
    claim: o.delivered_at ? { deliveredAt: o.delivered_at as string, visibleUntil: (o.claim_visible_until as string | null) ?? null, hiddenUntil: (o.claim_hidden_until as string | null) ?? null } : null,
    justCreated: !!opts.created,
  };
}
