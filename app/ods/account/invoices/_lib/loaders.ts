import 'server-only';
/**
 * ODS /account/invoices data — TODAY's query (app/account/invoices/page.tsx): documents of the company, types
 * proforma_invoice · commercial_invoice · receipt · credit_note · statement (never supplier documents), newest first,
 * ≤ 200; plus getAmountsDue() for the proformas that can be paid from the wallet. Read-only.
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getAmountsDue } from '@/lib/core/amounts-due';
import { nowMs } from '@/components/account/order-utils';
import { resolveActiveOnlineProvider, type PaymentProviderSettingRow } from '@/lib/payments';
import { requireAccount } from '../../_lib/loaders';
import type { SaasVM, SaasPlanVM, SaasSubscriptionVM } from '../_components/saas-plans';
import { DOC_TYPE_LABEL } from '../../orders/_lib/commerce-format';
import { docStatusName, invoiceService, type InvoiceRowVM } from './invoice-logic';

export type InvoiceRowWithKey = InvoiceRowVM & { idempotencyKey: string | null };

export async function loadInvoices(): Promise<InvoiceRowWithKey[]> {
  const s = await requireAccount('/account/invoices');
  const sb = await createClient();
  const [{ data, error }, due] = await Promise.all([
    sb
      .from('documents')
      .select('id, doc_type, number, amount_cents, currency, status, due_at, data, created_at, orders(code)')
      .eq('org_id', s.org!.id)
      .in('doc_type', ['proforma_invoice', 'commercial_invoice', 'receipt', 'credit_note', 'statement'])
      .order('created_at', { ascending: false })
      .limit(200),
    getAmountsDue(s.org!.id),
  ]);
  if (error) throw new Error('documents');
  const now = nowMs();
  return (data ?? []).map((d) => {
    const orderCode = (d.orders as unknown as { code: string } | null)?.code ?? null;
    const svc = invoiceService({ doc_type: d.doc_type as string, data: d.data, orderCode });
    const payable = due.docDue.get(d.id as string) ?? 0;
    return {
      id: d.id as string,
      type: d.doc_type as string,
      typeLabel: DOC_TYPE_LABEL[d.doc_type as keyof typeof DOC_TYPE_LABEL] ?? String(d.doc_type),
      number: d.number as string,
      service: svc.service,
      forRef: svc.ref,
      createdAt: d.created_at as string,
      dueAt: (d.due_at as string | null) ?? null,
      amountCents: d.amount_cents == null ? null : Number(d.amount_cents),
      currency: (d.currency as string) ?? 'USD',
      statusName: docStatusName(d.doc_type as string, d.status as string | null, d.due_at as string | null, now),
      payableCents: payable,
      // one idempotency key per page view, as today: a double click or a retried request is charged once
      idempotencyKey: payable > 0 ? `wallet:${d.id}:${randomUUID()}` : null,
    };
  });
}

/**
 * SaaS plans panel data — TODAY's queries on /account/invoices: active saas_plans, the company's saas_subscriptions,
 * get_customer_credit_status (division null) and the enabled payment providers. Throws on a failed read (the panel
 * fails on its own).
 */
export async function loadSaas(): Promise<SaasVM> {
  const s = await requireAccount('/account/invoices');
  const sb = await createClient();
  const [plans, subs, credit, providers] = await Promise.all([
    sb.from('saas_plans').select('code, service, name, description, billing_interval, price_cents, currency').eq('active', true).order('sort_order', { ascending: true }),
    sb.from('saas_subscriptions').select('id, plan_code, status, payment_option, current_period_start, current_period_end').eq('org_id', s.org!.id).order('created_at', { ascending: false }),
    sb.rpc('get_customer_credit_status', { p_org: s.org!.id, p_division: null }),
    sb.from('payment_provider_settings').select('provider, display_name, enabled, methods, priority, legal_entity_id, fee_mode, fee_bp, fee_fixed_cents').eq('enabled', true).order('priority', { ascending: true }),
  ]);
  if (plans.error || subs.error) throw new Error('saas');
  const c = (credit.data as { eligible?: boolean; available_cents?: number; net_days?: number } | null) ?? null;
  return {
    plans: ((plans.data ?? []) as unknown as SaasPlanVM[]).map((p) => ({ ...p, price_cents: Number(p.price_cents) })),
    subscriptions: (subs.data ?? []) as unknown as SaasSubscriptionVM[],
    creditEligible: Boolean(c?.eligible),
    creditAvailableCents: Number(c?.available_cents ?? 0),
    netDays: Number(c?.net_days ?? 30),
    hasOnlineProvider: Boolean(resolveActiveOnlineProvider(((providers.data ?? []) as unknown) as PaymentProviderSettingRow[])),
  };
}
