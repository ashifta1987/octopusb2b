import { mockProviderAdapter, signMockWebhookPayload } from './providers/mock';
import { stripeProviderAdapter } from './providers/stripe';
import { airwallexProviderAdapter } from './providers/airwallex';
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
  stripeProviderAdapter,
  airwallexProviderAdapter,
  PAYMENT_PROVIDER_ENV_VARS,
  type PaymentOptionCode,
  type PaymentProviderAdapter,
  type PaymentProviderName,
  type PaymentServiceCode,
  type PaymentTargetType,
};

export function getPaymentProviderAdapter(name: PaymentProviderName): PaymentProviderAdapter {
  switch (name) {
    case 'stripe':
      return stripeProviderAdapter.isConfigured() ? stripeProviderAdapter : mockProviderAdapter;
    case 'airwallex':
      return airwallexProviderAdapter.isConfigured() ? airwallexProviderAdapter : mockProviderAdapter;
    case 'mock':
    default:
      return mockProviderAdapter;
  }
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
