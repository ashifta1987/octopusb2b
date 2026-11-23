// Shared Payment Provider Adapter Interface & Environment Variable Names Catalog.
// Never store card numbers, CVVs, or bank logins; store only provider IDs (customer, payment, payment_method, refund).

export type PaymentProviderName = 'mock' | 'stripe' | 'airwallex';

export type PaymentServiceCode =
  | 'sourcing'
  | 'brand'
  | 'pools'
  | 'turnkey'
  | 'warehouse'
  | 'dropship'
  | 'advertising'
  | 'saas';

export type PaymentOptionCode = 'pay_now' | 'payment_protection' | 'pay_later';

export type PaymentTargetType =
  | 'order'
  | 'proforma'
  | 'pool_pledge'
  | 'service_request'
  | 'wallet_topup'
  | 'ad_campaign'
  | 'saas_subscription'
  | 'dropship_order';

export type CreateCheckoutInput = {
  checkoutId: string;
  orgId: string;
  service: PaymentServiceCode;
  paymentOption: 'pay_now' | 'payment_protection';
  targetType: PaymentTargetType;
  targetId: string;
  amountCents: number;
  baseAmountCents: number;
  surchargeCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
  description: string;
  returnUrl: string;
  cancelUrl: string;
  savePaymentMethod?: boolean;
};

export type CreateCheckoutOutput = {
  provider: PaymentProviderName;
  providerSessionId: string;
  redirectUrl: string;
};

export type VerifiedWebhookEvent = {
  provider: PaymentProviderName;
  eventId: string;
  eventType: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  checkoutId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
  providerPaymentId: string;
  providerCustomerId?: string | null;
  providerPaymentMethodId?: string | null;
  rawPayload: Record<string, unknown>;
};

export type PaymentStatusOutput = {
  provider: PaymentProviderName;
  providerPaymentId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
};

export type RefundInput = {
  providerPaymentId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
  reason: string;
  idempotencyKey: string;
};

export type RefundOutput = {
  provider: PaymentProviderName;
  providerRefundId: string;
  status: 'succeeded' | 'pending';
};

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName;
  isConfigured(): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutOutput>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhookEvent>;
  getPayment(providerPaymentId: string): Promise<PaymentStatusOutput>;
  refund(input: RefundInput): Promise<RefundOutput>;
}

/**
 * Exact environment variable NAMES required by each payment provider adapter.
 * Staging defaults to the Mock provider until sandbox/test keys are added to Vercel Preview.
 * Live keys (`sk_live_...`, `AIRWALLEX_ENV=prod`) are strictly refused when `APP_ENVIRONMENT === 'staging'`.
 */
export const PAYMENT_PROVIDER_ENV_VARS: Record<
  PaymentProviderName,
  { envVars: string[]; notes: string }
> = {
  mock: {
    envVars: ['PAYMENT_MOCK_WEBHOOK_SECRET'],
    notes: 'Staging sandbox only (refused on production). Falls back to a staging-only HMAC secret derived from BACKUP_CALLBACK_SECRET when unset on staging.',
  },
  stripe: {
    envVars: [
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ],
    notes: 'Use test keys (pk_test_..., sk_test_...) on staging/Vercel Preview; never sk_live_ on staging.',
  },
  airwallex: {
    envVars: [
      'AIRWALLEX_CLIENT_ID',
      'AIRWALLEX_API_KEY',
      'AIRWALLEX_WEBHOOK_SECRET',
      'AIRWALLEX_ENV',
    ],
    notes: 'Set AIRWALLEX_ENV=demo on staging/Vercel Preview and AIRWALLEX_ENV=prod on production.',
  },
};
