'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import {
  getPaymentProviderAdapter,
  type PaymentProviderName,
  type PaymentServiceCode,
  type PaymentTargetType,
} from '@/lib/payments';
import { createClient } from '@/lib/supabase/server';

export async function startOnlineCheckoutAction(input: {
  service: PaymentServiceCode;
  paymentOption: 'pay_now' | 'payment_protection';
  targetType: PaymentTargetType;
  targetId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
  methodKind?: 'card' | 'local_transfer';
  savePaymentMethod?: boolean;
  description?: string;
  returnUrl?: string;
}): Promise<{ ok: boolean; redirectUrl?: string; checkoutId?: string; error?: string }> {
  const s = await requireCustomer();
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };

  const sb = await createClient();
  const idempotencyKey = `chk:${input.paymentOption}:${input.targetType}:${input.targetId}:${input.amountCents}:${Date.now()}`;

  const { data, error } = await sb.rpc('create_payment_checkout', {
    p_org: s.org.id,
    p_service: input.service,
    p_payment_option: input.paymentOption,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_base_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_method_kind: input.methodKind ?? 'card',
    p_preferred_provider: null,
    p_save_payment_method: Boolean(input.savePaymentMethod),
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      error: /CREDIT_NOT_ELIGIBLE/.test(error.message) ? 'CREDIT_NOT_ELIGIBLE' : error.message,
    };
  }

  const res = data as {
    checkout_id: string;
    provider: PaymentProviderName;
    base_amount_cents: number;
    surcharge_cents: number;
    total_amount_cents: number;
    currency: 'USD' | 'CNY' | 'HKD';
  };

  const adapter = getPaymentProviderAdapter(res.provider);
  const defaultReturn =
    input.targetType === 'dropship_order' ? '/account/dropship/orders' : `/account/orders/${input.targetId}`;
  const returnUrl = input.returnUrl || defaultReturn;
  const checkoutOut = await adapter.createCheckout({
    checkoutId: res.checkout_id,
    orgId: s.org.id,
    service: input.service,
    paymentOption: input.paymentOption,
    targetType: input.targetType,
    targetId: input.targetId,
    amountCents: Number(res.total_amount_cents),
    baseAmountCents: Number(res.base_amount_cents),
    surchargeCents: Number(res.surcharge_cents),
    currency: res.currency,
    description: input.description ?? `${input.service} payment`,
    returnUrl,
    cancelUrl: returnUrl,
    savePaymentMethod: input.savePaymentMethod,
  });

  return {
    ok: true,
    checkoutId: res.checkout_id,
    redirectUrl: checkoutOut.redirectUrl,
  };
}

export async function payWithProtectionFromWalletAction(input: {
  service: PaymentServiceCode;
  targetType: PaymentTargetType;
  targetId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
}): Promise<{ ok: boolean; holdId?: string; error?: string }> {
  const s = await requireCustomer();
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('pay_with_protection_wallet', {
    p_service: input.service,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_idempotency_key: `prot-wallet:${input.targetType}:${input.targetId}:${input.amountCents}`,
  });

  if (error) {
    return {
      ok: false,
      error: /WALLET_INSUFFICIENT/.test(error.message)
        ? 'Your wallet balance is lower than the amount due. Top up your wallet or pay online.'
        : error.message,
    };
  }

  revalidatePath(`/account/orders/${input.targetId}`);
  revalidatePath('/account/dropship/orders');
  revalidatePath('/account/orders');
  revalidatePath('/account/invoices');
  revalidatePath('/account/wallet');
  const res = data as { hold_id?: string };
  return { ok: true, holdId: res.hold_id };
}

export async function confirmPayLaterAction(input: {
  service: PaymentServiceCode;
  targetType: PaymentTargetType;
  targetId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
}): Promise<{ ok: boolean; status?: string; invoiceNumber?: string | null; netDays?: number; error?: string }> {
  const s = await requireCustomer();
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('checkout_pay_later', {
    p_org: s.org.id,
    p_service: input.service,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_idempotency_key: `paylater:${input.targetType}:${input.targetId}:${input.amountCents}`,
  });

  if (error) {
    return {
      ok: false,
      error: /CREDIT_NOT_ELIGIBLE/.test(error.message)
        ? 'CREDIT_NOT_ELIGIBLE'
        : /NO_CREDIT_TERMS/.test(error.message)
          ? 'NO_CREDIT_TERMS'
          : /CREDIT_LIMIT_EXCEEDED/.test(error.message)
            ? 'This order exceeds your available credit limit.'
            : /KYC_NOT_VERIFIED/.test(error.message)
              ? 'Pay later requires verified company KYC.'
              : /CREDIT_OVERDUE_BLOCKED/.test(error.message)
                ? 'Pay-later is paused because an invoice is overdue past the grace period.'
                : error.message,
    };
  }

  revalidatePath(`/account/orders/${input.targetId}`);
  revalidatePath('/account/orders');
  revalidatePath('/account/invoices');
  const res = data as { status?: string; invoice_number?: string | null; net_days?: number };
  return {
    ok: true,
    status: res.status,
    invoiceNumber: res.invoice_number ?? null,
    netDays: res.net_days,
  };
}

export async function openPaymentProtectionDisputeAction(input: {
  holdId: string;
  reason: string;
  orderId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireCustomer();
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'Please enter the reason for your dispute.' };

  const sb = await createClient();
  const { error } = await sb.rpc('open_escrow_dispute', {
    p_hold_id: input.holdId,
    p_reason: reason,
  });

  if (error) {
    return {
      ok: false,
      error: /CREDIT_NOT_ELIGIBLE/.test(error.message) ? 'CREDIT_NOT_ELIGIBLE' : error.message,
    };
  }

  if (input.orderId) revalidatePath(`/account/orders/${input.orderId}`);
  revalidatePath('/account/orders');
  revalidatePath('/account/invoices');
  return { ok: true };
}

export async function subscribeSaasPlanAction(input: {
  planCode: string;
  paymentOption: 'pay_now' | 'pay_later';
  methodKind: 'card' | 'wallet';
}): Promise<{ ok: boolean; redirectUrl?: string; invoiceNumber?: string; error?: string }> {
  const s = await requireCustomer('/account/services');
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('subscribe_saas_plan', {
    p_org: s.org.id,
    p_plan_code: input.planCode,
    p_payment_option: input.paymentOption,
    p_method_kind: input.methodKind,
    p_idempotency_key: `saas:${s.org.id}:${input.planCode}:${Date.now()}`,
  });

  if (error) {
    return {
      ok: false,
      error: /CREDIT_NOT_ELIGIBLE/.test(error.message) ? 'CREDIT_NOT_ELIGIBLE' : error.message,
    };
  }

  const res = data as {
    checkout_id?: string;
    provider?: PaymentProviderName;
    invoice_number?: string;
  };

  revalidatePath('/account/services');
  revalidatePath('/account/invoices');

  if (res.checkout_id) {
    return {
      ok: true,
      redirectUrl: `/pay/mock/${res.checkout_id}`,
    };
  }
  return {
    ok: true,
    invoiceNumber: res.invoice_number,
  };
}
