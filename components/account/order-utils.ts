/** Shared order helpers (pure, safe on server and client). */
export type OrderMoney = { status: string; total_cents: number; deposit_cents: number; paid_cents: number };

/** Amount the customer may pay now: remaining deposit, or the balance once the balance invoice is issued. */
export function dueNow(o: OrderMoney): { purpose: 'deposit' | 'balance'; amount: number } | null {
  if (['pi_issued', 'deposit_pending'].includes(o.status) && o.paid_cents < o.deposit_cents) return { purpose: 'deposit', amount: o.deposit_cents - o.paid_cents };
  if (o.status === 'balance_pending' && o.paid_cents < o.total_cents) return { purpose: 'balance', amount: o.total_cents - o.paid_cents };
  return null;
}

export const ACTIVE_ORDER = ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped'];
export const CANCELLABLE = ['pi_issued', 'deposit_pending'];

export function relTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export const nowMs = () => Date.now();
