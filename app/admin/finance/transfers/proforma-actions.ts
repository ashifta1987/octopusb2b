'use server';
import { revalidatePath } from 'next/cache';
import { guard, fail, ok, str, requireFresh, type Result } from '@/components/admin/server';

const PAGE = '/admin/finance/transfers';

/**
 * A customer paid a service proforma (PF-…) by bank transfer: finance records the amount that arrived with the bank
 * statement reference. The reference is the idempotency key, so recording the same transfer twice (double click,
 * second person) never pays it twice. Fully paid → the database issues the OCT- tax invoice (migration 201).
 */
export async function recordProformaTransfer(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('finance', 'approve');
  if ('error' in g) return g.error;
  const number = str(fd, 'number').toUpperCase();
  const ref = str(fd, 'bank_ref');
  const amount = Math.round(Number(str(fd, 'amount').replace(/,/g, '')) * 100);
  if (!/^(PF|PI)-[\w-]+$/.test(number)) return fail('Enter the proforma number, e.g. PF-2026-000012.');
  if (!ref) return fail('Enter the bank statement reference.');
  if (!(amount > 0)) return fail('Enter the amount that arrived.');
  const stale = await requireFresh(g.sb, PAGE);
  if (stale) return stale;
  const { data: doc } = await g.sb.from('documents').select('id, number, amount_cents, paid_cents, currency, status, order_id')
    .eq('number', number).eq('doc_type', 'proforma_invoice').maybeSingle();
  if (!doc) return fail(`Proforma ${number} not found.`);
  if (doc.order_id) return fail(`${number} belongs to an order: record it on the order instead.`);
  const { data, error } = await g.sb.rpc('pay_service_proforma', { p_document: doc.id, p_amount: amount, p_method: 'bank_transfer', p_reference: ref, p_idempotency_key: null });
  if (error) {
    const m = error.message;
    return fail(/ALREADY_PAID/.test(m) ? `${number} is already paid.` : /INVALID_AMOUNT/.test(m) ? `The amount is more than the ${((Number(doc.amount_cents) - Number(doc.paid_cents ?? 0)) / 100).toFixed(2)} ${doc.currency} still to pay.` : m);
  }
  const r = data as { fully_paid?: boolean; repeated?: boolean };
  revalidatePath(PAGE);
  return ok(r.repeated ? `This bank transfer (${ref}) was already recorded — nothing changed.` : r.fully_paid ? `${number} fully paid — tax invoice issued.` : `Part payment recorded on ${number} (customer deposit until fully paid).`);
}
