/**
 * Octopus Dropship · Release 4 · Step 10 — pure labels for order problems and support (shared by the order detail page,
 * the Support page, the staff Order problems page and the unit tests). Wording follows screens/OrderDetail.html,
 * screens/Support.html, states/States-Orders.html, states/States-Money.html and staff/StaffQueue.html (Exceptions).
 * Money is integer US cents, always shown as US$ with two decimals.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export type CaseKind = 'lost' | 'damaged' | 'return';
export type CaseStatus =
  | 'reported' | 'carrier_claim' | 'awaiting_return' | 'received' | 'awaiting_approval' | 'reshipped' | 'refunded' | 'rejected' | 'closed';

export const usd = (c: number | null | undefined) =>
  c == null ? 'Not known yet' : `US$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "12.50" / "12" → 1250; anything else → null */
export function centsFromInput(v: string): number | null {
  const t = v.trim().replace(/^US\$/i, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const CASE_KIND_LABEL: Record<CaseKind, string> = { lost: 'Lost parcel', damaged: 'Damaged parcel', return: 'Return' };

export const OPEN_STATUSES: CaseStatus[] = ['reported', 'carrier_claim', 'awaiting_return', 'received', 'awaiting_approval'];
export const isOpen = (s: CaseStatus) => OPEN_STATUSES.includes(s);

export function caseStatusLabel(s: CaseStatus, kind: CaseKind): { label: string; tone: Tone } {
  switch (s) {
    case 'reported': return { label: kind === 'return' ? 'Reported' : 'Claim reported', tone: 'info' };
    case 'carrier_claim': return { label: 'Claim with the carrier', tone: 'warn' };
    case 'awaiting_return': return { label: 'Waiting for the parcel', tone: 'info' };
    case 'received': return { label: 'At the warehouse, being checked', tone: 'info' };
    case 'awaiting_approval': return { label: 'Refund waiting for approval', tone: 'warn' };
    case 'reshipped': return { label: 'Reshipped', tone: 'ok' };
    case 'refunded': return { label: 'Refunded', tone: 'ok' };
    case 'rejected': return { label: 'Not accepted', tone: 'bad' };
    case 'closed': return { label: 'Closed', tone: 'neutral' };
  }
}

/** Who the case is waiting on (staff Exceptions table, design column "Waiting on"). */
export function waitingOn(s: CaseStatus): string {
  switch (s) {
    case 'carrier_claim': return 'Carrier claim';
    case 'awaiting_return': return 'Buyer return';
    case 'received': return 'Warehouse check';
    case 'awaiting_approval': return 'Finance';
    case 'reported': return 'Octopus';
    default: return '—';
  }
}

export type StepState = 'done' | 'current' | 'upcoming';
export type Step = { label: string; detail?: string; state: StepState };

/** The claim / return stepper (States-Orders "Lost parcel claim": Reported → Claim with carrier → Carrier decision → Reship or refund). */
export function caseSteps(c: { kind: CaseKind; status: CaseStatus; carrier_claim_ref: string | null; merchant_choice: 'reship' | 'refund' | null; return_to: 'merchant' | 'warehouse' | null }): Step[] {
  const final = ['reshipped', 'refunded', 'rejected', 'closed'].includes(c.status);
  const st = (doneWhen: boolean, currentWhen: boolean): StepState => (doneWhen ? 'done' : currentWhen ? 'current' : 'upcoming');
  if (c.kind === 'return') {
    if (c.return_to === 'merchant') return [{ label: 'Reported', state: 'done' }, { label: 'Buyer sends it to your return address', state: 'done' }];
    const atWh = ['received', 'awaiting_approval'].includes(c.status) || final;
    return [
      { label: 'Reported', state: 'done' },
      { label: 'Buyer sends it to the warehouse', state: st(atWh, c.status === 'awaiting_return') },
      { label: 'Warehouse checks it', state: st(final || c.status === 'awaiting_approval', c.status === 'received') },
      { label: 'Refund by the return rules', state: st(final, c.status === 'awaiting_approval') },
    ];
  }
  const carrierDone = Boolean(c.carrier_claim_ref) || final;
  return [
    { label: 'Reported', state: 'done' },
    { label: 'Claim opened with the carrier', detail: c.carrier_claim_ref ?? undefined, state: st(carrierDone, c.status === 'reported') },
    { label: 'Carrier decision', state: st(final, c.status === 'carrier_claim' || c.status === 'awaiting_approval') },
    { label: 'Reship or refund', detail: c.merchant_choice ? `Your choice: ${c.merchant_choice}` : undefined, state: st(final, false) },
  ];
}

export type TicketStatus = 'new' | 'open' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'closed' | 'reopened';

/** Merchant-facing ticket status (Support.html: Waiting on you / Resolved …). SLA timers are staff-only. */
export function ticketStatusLabel(s: TicketStatus): { label: string; tone: Tone } {
  switch (s) {
    case 'waiting_customer': return { label: 'Waiting on you', tone: 'warn' };
    case 'resolved': case 'closed': return { label: 'Resolved', tone: 'ok' };
    case 'waiting_internal': return { label: 'With Octopus', tone: 'info' };
    default: return { label: 'Open', tone: 'info' };
  }
}

export const TICKET_CATEGORIES = [
  { value: 'order_problem', label: 'Order problem' },
  { value: 'product_request', label: 'Product request' },
  { value: 'billing', label: 'Billing' },
  { value: 'store_connection', label: 'Store connection' },
  { value: 'other', label: 'Other' },
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['value'];
export const categoryLabel = (c: string) => TICKET_CATEGORIES.find((x) => x.value === c)?.label ?? c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

export const RETURN_REASONS = [
  { value: 'changed_mind', label: 'Buyer changed their mind' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'other', label: 'Other' },
] as const;

/** Progress list of the design (Received → Paid → Address checked → Packing → Shipped → Delivered). */
export function orderProgress(d: {
  created_at: string; charged_at: string | null; payment_option: string | null; address_ok: boolean; packing_started: boolean; packed: boolean;
  handed_over: boolean; delivered: boolean; cancelled: boolean; channel: string;
}): Step[] {
  const paid = Boolean(d.charged_at);
  const steps: { label: string; done: boolean; detail?: string }[] = [
    { label: d.channel === 'shopify' ? 'Order received from Shopify' : 'Order received', done: true },
    { label: d.payment_option === 'protection' ? 'Paid with payment protection' : d.payment_option === 'pay_later' ? 'On invoice' : 'Paid from wallet', done: paid },
    { label: 'Address checked', done: paid && d.address_ok },
    { label: 'Packing', done: d.packed || d.handed_over, detail: !d.packing_started && !d.cancelled ? 'You can still change the address or cancel until it is packed' : undefined },
    { label: 'Shipped', done: d.handed_over },
    { label: 'Delivered', done: d.delivered },
  ];
  let currentGiven = d.cancelled;
  return steps.map((s) => {
    if (s.done) return { label: s.label, detail: s.detail, state: 'done' as const };
    if (!currentGiven) { currentGiven = true; return { label: s.label, detail: s.detail, state: 'current' as const }; }
    return { label: s.label, detail: s.detail, state: 'upcoming' as const };
  });
}

export function addressLines(a: Record<string, string | undefined> | null | undefined, countryName?: string): string[] {
  if (!a) return [];
  return [a.line1, a.line2, [a.city, a.region, a.postcode].filter(Boolean).join(', '), countryName ?? a.country].filter((x): x is string => Boolean(x && x.trim()));
}

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtStamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';

/** ds-claims path for an evidence photo: <org>/<store order>/<uuid>.<ext> */
export function claimPhotoPath(org: string, storeOrder: string, uuid: string, mime: string): string | null {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : null;
  return ext ? `${org}/${storeOrder}/${uuid}.${ext}` : null;
}
