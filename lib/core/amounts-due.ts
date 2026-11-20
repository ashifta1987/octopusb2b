import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asCurrency, type Currency } from '@/lib/format';

/**
 * What this company has to pay now, per currency — ONE definition for the ledger "Due now" card and the
 * "Awaiting payment" total on Invoices and receipts:
 *   · orders: the unpaid deposit (pi_issued / deposit_pending) or the unpaid balance (balance_pending)
 *   · service proformas (not tied to an order) awaiting payment or part paid: what is still to pay
 */
export async function getAmountsDue(orgId: string) {
  const sb = await createClient();
  const [{ data: orders }, { data: docs }] = await Promise.all([
    sb.from('orders').select('id, code, status, total_cents, paid_cents, deposit_cents, currency').eq('org_id', orgId).not('status', 'in', '(cancelled,closed)'),
    sb.from('documents').select('id, number, amount_cents, paid_cents, currency').eq('org_id', orgId).eq('doc_type', 'proforma_invoice').is('order_id', null).in('status', ['awaiting_payment', 'part_paid']),
  ]);
  const byCurrency: Partial<Record<Currency, number>> = {};
  const add = (c: string | null, v: number) => { if (v > 0) { const k = asCurrency(c); byCurrency[k] = (byCurrency[k] ?? 0) + v; } };
  const orderDue = new Map<string, number>();
  for (const o of orders ?? []) {
    const paid = Number(o.paid_cents);
    const due = ['pi_issued', 'deposit_pending'].includes(o.status as string) ? Math.max(0, Number(o.deposit_cents) - paid)
      : o.status === 'balance_pending' ? Math.max(0, Number(o.total_cents) - paid) : 0;
    orderDue.set(o.id as string, due);
    add(o.currency as string, due);
  }
  const docDue = new Map<string, number>();
  for (const d of docs ?? []) { const left = Math.max(0, Number(d.amount_cents) - Number(d.paid_cents ?? 0)); docDue.set(d.id as string, left); add(d.currency as string, left); }
  return { byCurrency, orderDue, docDue };
}

