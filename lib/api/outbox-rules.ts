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
};

const EMAIL_EVENTS = new Set(['quote.sent', 'quote.approved', 'payment.confirmed']);

export function wantsEmail(e: Pick<OutboxEvent, 'event_type' | 'payload'>) {
  if (EMAIL_EVENTS.has(e.event_type) || e.event_type.startsWith('order.')) return true;
  return e.event_type === 'ticket.replied' && e.payload?.staff === true; // customer gets mail when support replies
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Customer-facing notification copy + link, or null when the event has no customer notification. */
export function notificationFor(e: Pick<OutboxEvent, 'event_type' | 'aggregate_id' | 'payload'>): { title: string; body: string; link: string } | null {
  const p = e.payload ?? {};
  const t = e.event_type;
  const id = e.aggregate_id ?? '';
  if (t === 'rfq.submitted') return { title: 'RFQ received', body: 'We are matching suppliers for your request.', link: `/account/rfqs/${id}` };
  if (t === 'quote.sent') return { title: 'New quote received', body: 'A supplier quote is waiting for your review.', link: `/account/rfqs/${p.rfq_id ?? ''}` };
  if (t === 'quote.approved') return { title: 'Proforma invoice issued', body: `${p.pi ?? 'Your proforma invoice'} is ready. Pay the deposit to confirm.`, link: `/account/orders/${id}` };
  if (t === 'payment.confirmed') return { title: 'Payment confirmed', body: 'Your payment was received and matched.', link: `/account/orders/${p.order_id ?? ''}` };
  if (t.startsWith('order.')) return { title: `Order ${titleCase(t.slice(6)).toLowerCase()}`, body: `Your order status changed to ${titleCase(t.slice(6)).toLowerCase()}.`, link: `/account/orders/${id}` };
  if (t === 'shipment.tracking') return { title: `Shipment: ${titleCase(String(p.status ?? 'update')).toLowerCase()}`, body: [p.description, p.location].filter(Boolean).join(' · '), link: `/account/orders/${p.order_id ?? ''}` };
  if (t.startsWith('service_request.')) {
    const to = String(p.to ?? t.split('.')[1]);
    return { title: `Service request ${titleCase(to).toLowerCase()}`, body: `Your service request is now ${titleCase(to).toLowerCase()}.`, link: '/account/services' };
  }
  if (t === 'wallet.updated') return { title: 'Wallet credited', body: 'Your wallet top-up was credited.', link: '/account/wallet' };
  if (t === 'ticket.replied' && p.staff === true) return { title: 'Support replied', body: 'There is a new reply on your ticket.', link: `/account/support/${id}` };
  if (t.startsWith('kyc.') && t !== 'kyc.submitted') return { title: `KYC ${titleCase(t.slice(4)).toLowerCase()}`, body: 'Your company verification status changed.', link: '/account/kyc' };
  return null;
}
