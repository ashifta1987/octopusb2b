import { mockProviderAdapter, signMockWebhookPayload, assertExactStagingEnvironment } from './providers/mock';
import { stripeProviderAdapter, validateStripeEnvironmentKeys } from './providers/stripe';
import { airwallexProviderAdapter, validateAirwallexEnvironment } from './providers/airwallex';
import {
  PAYMENT_PROVIDER_ENV_VARS,
  type PaymentOptionCode,
  type PaymentProviderAdapter,
  type PaymentProviderName,
  type PaymentServiceCode,
  type PaymentTargetType,
} from './types';

export {
  mockProviderAdapter,
  signMockWebhookPayload,
  assertExactStagingEnvironment,
  stripeProviderAdapter,
  validateStripeEnvironmentKeys,
  airwallexProviderAdapter,
  validateAirwallexEnvironment,
  PAYMENT_PROVIDER_ENV_VARS,
  type PaymentOptionCode,
  type PaymentProviderAdapter,
  type PaymentProviderName,
  type PaymentServiceCode,
  type PaymentTargetType,
};

/**
 * Resolves the requested provider adapter without EVER falling back to `mock`.
 * - `stripe` → stripeProviderAdapter (throws if unconfigured or key/env mismatch)
 * - `airwallex` → airwallexProviderAdapter (throws if unconfigured or env mismatch)
 * - `mock` → mockProviderAdapter ONLY when `process.env.APP_ENVIRONMENT === 'staging'`
 */
export function getPaymentProviderAdapter(name: PaymentProviderName): PaymentProviderAdapter {
  switch (name) {
    case 'stripe':
      return stripeProviderAdapter;
    case 'airwallex':
      return airwallexProviderAdapter;
    case 'mock':
      if (process.env.APP_ENVIRONMENT !== 'staging') {
        throw new Error('MOCK_PROVIDER_REQUIRES_STAGING_ENV');
      }
      return mockProviderAdapter;
    default:
      throw new Error(`UNKNOWN_PAYMENT_PROVIDER: ${String(name)}`);
  }
}

/**
 * Picks the highest-priority enabled provider row that is ALSO configured and allowed in the current environment.
 * Never falls back to `mock` when `APP_ENVIRONMENT !== 'staging'` or when `mock` is disabled/unconfigured.
 * If no provider is enabled & configured (e.g. live today before Stripe/Airwallex keys are added), returns `null`
 * so the UI hides the "Pay online" buttons while Wallet and Bank transfer continue to work.
 */
export function resolveActiveOnlineProvider(
  rows: PaymentProviderSettingRow[] | null | undefined,
): PaymentProviderSettingRow | null {
  const isStagingEnv = process.env.APP_ENVIRONMENT === 'staging';
  for (const r of rows ?? []) {
    if (!r.enabled) continue;
    if (r.provider === 'mock') {
      if (!isStagingEnv) continue;
      if (!mockProviderAdapter.isConfigured()) continue;
      return r;
    }
    if (r.provider === 'stripe') {
      if (!stripeProviderAdapter.isConfigured()) continue;
      return r;
    }
    if (r.provider === 'airwallex') {
      if (!airwallexProviderAdapter.isConfigured()) continue;
      return r;
    }
  }
  return null;
}

export type PaymentOptionMatrixRow = {
  service: PaymentServiceCode;
  option: PaymentOptionCode;
  enabled: boolean;
  min_amount_cents: number;
  max_amount_cents: number | null;
  release_rule: string | null;
  auto_release_days: number | null;
  pay_later_invoice_trigger: string | null;
};

export type PaymentProviderSettingRow = {
  provider: PaymentProviderName;
  display_name: string;
  enabled: boolean;
  methods: string[];
  priority: number;
  legal_entity_id: string;
  fee_mode: 'absorb' | 'surcharge';
  fee_bp: number;
  fee_fixed_cents: number;
};

export type CustomerCreditStatus = {
  eligible: boolean;
  reason: string | null;
  terms_id?: string | null;
  credit_limit_cents: number;
  unpaid_invoices_cents: number;
  reserved_cents: number;
  available_cents: number;
  net_days: number;
  currency?: string;
};
