'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getCarrier, type RateQuote } from '@/lib/adapters';
import { toCents, money } from '@/lib/format';
import { actionSession, fail, ok, type Result } from '@/components/backoffice/server-utils';

/* ───────── KYC ───────── */
export async function reviewKyc(submissionId: string, to: 'in_review' | 'verified' | 'rejected' | 'more_info', note: string): Promise<Result> {
  const g = await actionSession('customers', 'approve');
  if ('error' in g) return fail(g.error);
  if ((to === 'rejected' || to === 'more_info') && !note.trim()) return fail('Add a note for the customer.');
  const sb = await createClient();
  const { error } = await sb.rpc('review_kyc', { p_submission: submissionId, p_to: to, p_note: note.trim() || null });
  if (error) return fail(error);
  revalidatePath('/office/kyc'); revalidatePath(`/office/kyc/${submissionId}`); revalidatePath('/office');
  return ok(undefined, 'KYC updated');
}

/* ───────── Supplier applications (ADDON-36 C5) ───────── */
export async function reviewSupplierApplication(id: string, to: 'in_review' | 'approved' | 'rejected', note: string): Promise<Result> {
  const g = await actionSession('suppliers', 'approve');
  if ('error' in g) return fail(g.error);
  if (to === 'rejected' && !note.trim()) return fail('Add a reason for the rejection.');
  const sb = await createClient();
  const { error } = await sb.rpc('review_supplier_application', { p_id: id, p_status: to, p_note: note.trim() || null });
  if (error) return fail(/FORBIDDEN/.test(error.message) ? 'You do not have permission to review supplier applications.' : error);
  revalidatePath('/office/kyc'); revalidatePath(`/office/kyc/supplier/${id}`);
  return ok(undefined, to === 'approved' ? 'Application approved. Create the supplier in Admin → Suppliers.' : to === 'rejected' ? 'Application rejected' : 'Review started');
}

/* ───────── Products ───────── */
export async function moderateProduct(productId: string, to: 'in_review' | 'live' | 'rejected', reason: string): Promise<Result> {
  const g = await actionSession('products', 'approve');
  if ('error' in g) return fail(g.error);
  if (to === 'rejected' && !reason.trim()) return fail('A rejection reason is required.');
  const sb = await createClient();
  const { error } = await sb.rpc('transition_product', { p_product: productId, p_to: to, p_reason: reason.trim() || null });
  if (error) {
    const m = /^(SUBMIT_BLOCKED|IMPORT_PUBLISH_BLOCKED|MODERATION_HOLD): (.*)$/.exec(error.message);
    return fail(m ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.' : error);
  }
  revalidatePath('/office/products'); revalidatePath('/office');
  revalidateTag('products', 'max');
  return ok(undefined, to === 'live' ? 'Published' : to === 'rejected' ? 'Rejected' : 'In review');
}

/* ───────── Service requests ───────── */
export async function transitionService(id: string, to: string, reason: string): Promise<Result> {
  const g = await actionSession();
  if ('error' in g) return fail(g.error);
  if (to === 'rejected' && !reason.trim()) return fail('A reason is required to reject.');
  const sb = await createClient();
  const { error } = await sb.rpc('transition_service_request', { p_id: id, p_to: to, p_reason: reason.trim() || null });
  if (error) return fail(error);
  revalidatePath('/office/services'); revalidatePath('/office');
  return ok();
}

/* ───────── Orders ───────── */
export async function transitionOrder(orderId: string, to: string, reason: string): Promise<Result> {
  const g = await actionSession('orders', 'edit');
  if ('error' in g) return fail(g.error);
  if ((to === 'cancelled' || to === 'disputed') && !reason.trim()) return fail('A reason is required.');
  const sb = await createClient();
  const { error } = await sb.rpc('transition_order', { p_order: orderId, p_to: to, p_reason: reason.trim() || null });
  if (error) return fail(error);
  revalidatePath('/office/orders'); revalidatePath(`/office/orders/${orderId}`); revalidatePath('/office/shipping');
  return ok(undefined, 'Order updated');
}

const Payment = z.object({ amount: z.string().min(1), method: z.enum(['bank_transfer', 'card', 'other']), reference: z.string().trim().min(3, 'Bank reference required').max(120) });
export async function recordPayment(orderId: string, fd: FormData): Promise<Result> {
  const g = await actionSession('finance', 'approve');
  if ('error' in g) return fail(g.error);
  const p = Payment.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the form');
  const cents = toCents(p.data.amount);
  if (!Number.isFinite(cents) || cents <= 0) return fail('Amount must be greater than 0.');
  const sb = await createClient();
  const { error } = await sb.rpc('record_payment', { p_order: orderId, p_amount: cents, p_method: p.data.method, p_reference: p.data.reference, p_provider_event: null });
  if (error) return fail(error);
  revalidatePath(`/office/orders/${orderId}`); revalidatePath('/office/orders');
  return ok(undefined, 'Payment recorded');
}

/* ───────── Shipping (YunExpress via CarrierAdapter) ───────── */
/** CarrierAdapter rates (RateQuote.priceCents) are quoted in USD; shipments.currency records it (SPEC §15.1). */
const CARRIER_RATE_CURRENCY = 'USD';
export async function priceTrial(input: { toCountry: string; fromCountry: string; weightKg: number; parcels: number }): Promise<Result<RateQuote[]>> {
  const g = await actionSession('orders', 'view');
  if ('error' in g) return fail(g.error);
  if (!(input.weightKg > 0) || !(input.parcels > 0)) return fail('Enter the weight and number of pieces.');
  try {
    const rates = await getCarrier().priceTrial({ fromCountry: input.fromCountry || 'CN', toCountry: input.toCountry || 'US', weightKg: input.weightKg, parcels: Math.round(input.parcels) });
    return ok(rates);
  } catch (e) { return fail((e as Error).message); }
}

export async function createShipment(orderId: string, input: { service: string; rateCents: number; weightKg: number; parcels: number; days?: string }): Promise<Result<{ trackingNo: string; labelUrl: string }>> {
  const g = await actionSession('orders', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data: o } = await sb.from('orders').select('id, code, org_id, status, organizations(city, country)').eq('id', orderId).maybeSingle();
  if (!o) return fail('Order not found');
  if (o.status !== 'ready_to_ship') return fail('Only orders in “ready to ship” can be shipped.');
  const org = (Array.isArray(o.organizations) ? o.organizations[0] : o.organizations) as { city: string | null; country: string | null } | null;
  const carrier = getCarrier();
  let res;
  try {
    res = await carrier.createShipment({ orderCode: o.code, toCountry: org?.country ?? 'US', toCity: org?.city ?? undefined, weightKg: input.weightKg, parcels: input.parcels, service: input.service });
  } catch (e) { return fail(`YunExpress: ${(e as Error).message}`); }
  const { error } = await sb.from('shipments').insert({
    order_id: o.id, org_id: o.org_id, carrier_code: carrier.code, service_code: input.service, tracking_no: res.trackingNo, label_url: res.labelUrl,
    status: 'label_ready', weight_kg: input.weightKg, parcels: input.parcels, rate_cents: Math.round(input.rateCents), currency: CARRIER_RATE_CURRENCY, last_event_at: new Date().toISOString(),
  }).select('id').single();
  if (error) return fail(error);
  await createAdminClient().rpc('system_record_tracking', {
    p_tracking_no: res.trackingNo, p_provider_event: `created-${res.trackingNo}`, p_status: 'created',
    p_description: `Shipment created with ${input.service}. Label ready.`, p_location: 'Origin', p_occurred_at: new Date().toISOString(),
  });
  try { await carrier.subscribeTracking(res.trackingNo); } catch { /* cron fallback picks it up */ }
  const { error: te } = await sb.rpc('transition_order', { p_order: o.id, p_to: 'shipped', p_reason: `${carrier.code} ${res.trackingNo}` });
  if (te) return fail(`Shipment created (${res.trackingNo}) but the order could not be marked shipped: ${te.message}`);
  revalidatePath('/office/shipping'); revalidatePath(`/office/orders/${o.id}`);
  return ok({ trackingNo: res.trackingNo, labelUrl: res.labelUrl }, 'Shipment created');
}

const NEXT_SHIP: Record<string, { status: string; text: string; loc: string }> = {
  label_ready: { status: 'picked_up', text: 'Parcel picked up by YunExpress', loc: 'Shenzhen, CN' },
  created: { status: 'picked_up', text: 'Parcel picked up by YunExpress', loc: 'Shenzhen, CN' },
  picked_up: { status: 'in_transit', text: 'Departed origin hub — in transit', loc: 'Shenzhen hub, CN' },
  in_transit: { status: 'out_for_delivery', text: 'Out for delivery', loc: 'Destination city' },
  out_for_delivery: { status: 'delivered', text: 'Delivered — signed by consignee', loc: 'Destination city' },
};

/** Sandbox only: append the next tracking event (or an exception) to a shipment. */
export async function simulateTracking(shipmentId: string, kind: 'next' | 'exception'): Promise<Result> {
  const g = await actionSession('orders', 'edit');
  if ('error' in g) return fail(g.error);
  if (getCarrier().mode !== 'sandbox') return fail('Simulation is only available in sandbox mode.');
  const sb = await createClient();
  const { data: s } = await sb.from('shipments').select('id, org_id, order_id, status, tracking_no').eq('id', shipmentId).maybeSingle();
  if (!s) return fail('Shipment not found');
  const step = kind === 'exception'
    ? { status: 'exception', text: 'Delivery exception — address issue, carrier will retry', loc: 'Destination hub' }
    : s.status === 'exception' ? { status: 'in_transit', text: 'Exception resolved — back in transit', loc: 'Destination hub' } : NEXT_SHIP[s.status];
  if (!step) return fail(`No further sandbox events after “${s.status}”.`);
  if (!s.tracking_no) return fail('This shipment has no tracking number yet.');
  // SPEC §5/§11.3 golden path 3: a simulated event runs through the same path as the YunExpress webhook
  // (system_record_tracking: tracking event + shipment status + status_history + `shipment.tracking` outbox event
  // + order → delivered), never a direct status update. That RPC is service-role only, so call it with the admin
  // client after the staff permission check above.
  const { error } = await createAdminClient().rpc('system_record_tracking', {
    p_tracking_no: s.tracking_no, p_provider_event: `sim-${s.id}-${Date.now()}`, p_status: step.status,
    p_description: step.text, p_location: step.loc, p_occurred_at: new Date().toISOString(),
  });
  if (error) return fail(error);
  revalidatePath('/office/shipping'); revalidatePath(`/office/orders/${s.order_id}`);
  return ok(undefined, `Event added: ${step.status}`);
}

/* ───────── Support desk ───────── */
const TICKET_STATUSES = ['new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'reopened'];
export async function replyTicket(ticketId: string, fd: FormData): Promise<Result> {
  const g = await actionSession('support', 'edit');
  if ('error' in g) return fail(g.error);
  const body = String(fd.get('body') ?? '').trim();
  const internal = fd.get('internal') === 'on';
  const status = String(fd.get('status') ?? '');
  if (!body) return fail('Write a reply or note first.');
  const sb = await createClient();
  const { error } = await sb.rpc('reply_ticket', { p_ticket: ticketId, p_body: body, p_internal: internal, p_status: TICKET_STATUSES.includes(status) ? status : null });
  if (error) return fail(error);
  revalidatePath('/office/support');
  return ok(undefined, internal ? 'Internal note added' : 'Reply sent');
}

export async function setTicketStatus(ticketId: string, status: string): Promise<Result> {
  const g = await actionSession('support', 'edit');
  if ('error' in g) return fail(g.error);
  if (!TICKET_STATUSES.includes(status)) return fail('Unknown status');
  const sb = await createClient();
  const { error } = await sb.rpc('reply_ticket', { p_ticket: ticketId, p_body: `Status changed to ${status.replace(/_/g, ' ')}.`, p_internal: true, p_status: status });
  if (error) return fail(error);
  revalidatePath('/office/support');
  return ok(undefined, 'Status updated');
}

export async function updateTicket(ticketId: string, fields: { assign_to_me?: boolean; priority?: string }): Promise<Result> {
  const g = await actionSession('support', 'edit');
  if ('error' in g) return fail(g.error);
  const patch: Record<string, unknown> = {};
  if (fields.assign_to_me) patch.assigned_to = g.s.userId;
  if (fields.priority) {
    if (!['low', 'normal', 'high', 'urgent'].includes(fields.priority)) return fail('Unknown priority');
    patch.priority = fields.priority;
  }
  const sb = await createClient();
  const { error, data } = await sb.from('tickets').update(patch).eq('id', ticketId).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('Ticket not found');
  revalidatePath('/office/support');
  return ok(undefined, 'Ticket updated');
}

export async function saveMacro(fd: FormData): Promise<Result> {
  const g = await actionSession('support', 'edit');
  if ('error' in g) return fail(g.error);
  const title = String(fd.get('title') ?? '').trim();
  const body = String(fd.get('body') ?? '').trim();
  if (title.length < 2 || body.length < 5) return fail('Give the macro a title and some text.');
  const sb = await createClient();
  const { error } = await sb.from('support_macros').insert({ title, body });
  if (error) return fail(error);
  revalidatePath('/office/support');
  return ok(undefined, 'Macro saved');
}

const Escalation = z.object({ kind: z.enum(['refund', 'credit_note']), amount: z.string().min(1), reason: z.string().trim().min(5, 'Explain the reason (5+ characters)') });
export async function escalateToFinance(ticketId: string, orgId: string, orderId: string | null, fd: FormData): Promise<Result> {
  const g = await actionSession();
  if ('error' in g) return fail(g.error);
  const p = Escalation.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the form');
  const cents = toCents(p.data.amount);
  if (!Number.isFinite(cents) || cents <= 0) return fail('Amount must be greater than 0.');
  const sb = await createClient();
  const { data: tk } = await sb.from('tickets').select('code').eq('id', ticketId).maybeSingle();
  // request_finance_approval uses the order currency, else the platform currency (SPEC §15.1)
  const [{ data: ord }, { data: plat }] = await Promise.all([
    orderId ? sb.from('orders').select('currency').eq('id', orderId).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc('current_platform_currency'),
  ]);
  const cur = (ord?.currency as string | undefined) ?? (plat as string | null) ?? 'USD';
  const { error } = await sb.rpc('request_finance_approval', {
    p_kind: p.data.kind, p_amount: cents, p_reason: `${tk?.code ?? 'Ticket'}: ${p.data.reason}`, p_org: orgId, p_order: orderId, p_supplier: null,
  });
  if (error) return fail(error);
  await sb.rpc('reply_ticket', { p_ticket: ticketId, p_body: `Escalated to finance: ${p.data.kind.replace('_', ' ')} of ${money(cents, cur)} — ${p.data.reason}`, p_internal: true, p_status: 'waiting_internal' });
  revalidatePath('/office/support');
  return ok(undefined, 'Sent to Finance for approval (maker–checker)');
}

export async function ticketStatusForm(ticketId: string, fd: FormData): Promise<Result> {
  return setTicketStatus(ticketId, String(fd.get('status') ?? ''));
}
export async function ticketPriorityForm(ticketId: string, fd: FormData): Promise<Result> {
  return updateTicket(ticketId, { priority: String(fd.get('priority') ?? '') });
}
