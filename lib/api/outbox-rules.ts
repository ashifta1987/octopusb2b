/** Pure outbox rules (unit tested): retry backoff, which consumers handle an event, and notification copy. */

/** SPEC §10.2: retries after 1 min, 5 min, 30 min, 2 h, 6 h; when those 5 retries have failed too → dead letter. */
export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const MAX_ATTEMPTS = 5;

export function retryPlan(failuresSoFar: number, now = Date.now()): { status: 'pending' | 'dead'; attempts: number; availableAt: string } {
  const attempts = failuresSoFar + 1;
  if (attempts > MAX_ATTEMPTS) return { status: 'dead', attempts, availableAt: new Date(now).toISOString() };
  return { status: 'pending', attempts, availableAt: new Date(now + BACKOFF_SECONDS[attempts - 1] * 1000).toISOString() };
}

export type OutboxEvent = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  /** SPEC §21: trace id of the request that wrote the event (stamped by trigger). */
  trace_id?: string | null;
  created_at?: string;
};

const EMAIL_EVENTS = new Set(['quote.sent', 'rfq.reviewed', 'quote.approved', 'payment.confirmed', 'account_manager.assigned', 'pi.created', 'pool.balance_reminder']);

/** Service-request steps the customer is e-mailed about (SPEC §10.1 "service_request.paid → email receipt", §21.1 #5). */
const SERVICE_EMAIL_STEPS = new Set(['paid', 'report_ready', 'completed', 'rejected', 'refunded']);

export function wantsEmail(e: Pick<OutboxEvent, 'event_type' | 'payload'>) {
  if (EMAIL_EVENTS.has(e.event_type) || e.event_type.startsWith('order.')) return true;
  if (e.event_type === 'service_request.paid') return true;
  if (e.event_type === 'service_request.updated' && SERVICE_EMAIL_STEPS.has(String(e.payload?.to ?? ''))) return true;
  if (e.event_type === 'request.message') return e.payload?.from_staff === true; // the sourcing team asked the customer something
  return e.event_type === 'ticket.replied' && e.payload?.staff === true; // customer gets mail when support replies
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Customer-facing notification copy + link, or null when the event has no customer notification. */
export function notificationFor(e: Pick<OutboxEvent, 'event_type' | 'aggregate_id' | 'payload'>): { title: string; body: string; link: string } | null {
  const p = e.payload ?? {};
  const t = e.event_type;
  const id = e.aggregate_id ?? '';
  if (t === 'rfq.submitted') return { title: 'Sourcing request received', body: 'We are matching suppliers for your request.', link: `/account/sourcing/${id}` };
  if (t === 'rfq.reviewed') return { title: `${p.code ?? 'Your request'} is under review`, body: 'Our sourcing team is contacting matching factories. Quotes usually arrive within 24 hours.', link: `/account/sourcing/${id}` };
  if (t === 'quote.sent') return { title: 'New quote received', body: `A supplier quote${p.rfq_code ? ` for ${p.rfq_code}` : ''} is waiting for your review.`, link: `/account/sourcing/${p.rfq_id ?? ''}` };
  if (t === 'request.message') return p.from_staff === true ? { title: `Question from the sourcing team${p.code ? ` · ${p.code}` : ''}`, body: 'Our sourcing team asked you something about your request. Reply from your account.', link: `/account/sourcing/${id}` } : null;
  if (t === 'quote.approved') return { title: 'Proforma invoice issued', body: `${p.pi ?? 'Your proforma invoice'} is ready. Pay the deposit to confirm.`, link: `/account/orders/${id}` };
  // group buy settled: one PI per buyer (SPEC §18, §21.1 #6)
  if (t === 'pi.created') return { title: 'Group buy filled — proforma invoice issued', body: `${p.pi ?? 'Your proforma invoice'}${p.pool ? ` for pool ${p.pool}` : ''} is ready. Pay the balance to confirm your order.`, link: `/account/orders/${id}` };
  if (t === 'pool.balance_reminder') return { title: 'Group buy balance due', body: 'Your pool filled — please pay the balance before the deadline to keep your place.', link: '/account/pools' };
  if (t === 'payment.confirmed') return { title: 'Payment confirmed', body: 'Your payment was received and matched.', link: `/account/orders/${p.order_id ?? ''}` };
  if (t.startsWith('order.')) return { title: `Order ${titleCase(t.slice(6)).toLowerCase()}`, body: `Your order status changed to ${titleCase(t.slice(6)).toLowerCase()}.`, link: `/account/orders/${id}` };
  if (t === 'shipment.tracking') return { title: `Shipment: ${titleCase(String(p.status ?? 'update')).toLowerCase()}`, body: [p.description, p.location].filter(Boolean).join(' · '), link: `/account/orders/${p.order_id ?? ''}` };
  if (t.startsWith('service_request.')) {
    const to = String(p.to ?? t.split('.')[1]);
    return { title: `Service request ${titleCase(to).toLowerCase()}`, body: `Your service request is now ${titleCase(to).toLowerCase()}.`, link: id ? `/account/sourcing/${id}` : '/account/sourcing' };
  }
  if (t === 'wallet.updated') return { title: 'Wallet credited', body: 'Your wallet top-up was credited.', link: '/account/wallet' };
  if (t === 'ticket.replied' && p.staff === true) return { title: 'Support replied', body: 'There is a new reply on your ticket.', link: `/account/support/${id}` };
  if (t === 'account_manager.assigned') {
    const who = typeof p.manager_name === 'string' && p.manager_name ? p.manager_name : 'A dedicated account manager';
    return { title: 'Meet your account manager', body: `${who}${p.team ? ` (${p.team} team)` : ''} is now your dedicated contact for quotes, orders and shipping.`, link: '/account' };
  }
  if (t.startsWith('kyc.') && t !== 'kyc.submitted') return { title: `KYC ${titleCase(t.slice(4)).toLowerCase()}`, body: 'Your company verification status changed.', link: '/account/kyc' };
  return null;
}
