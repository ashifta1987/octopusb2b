import crypto from 'node:crypto';
import type {
  CreateCheckoutInput,
  CreateCheckoutOutput,
  PaymentProviderAdapter,
  PaymentStatusOutput,
  RefundInput,
  RefundOutput,
  VerifiedWebhookEvent,
} from '../types';

const REPLAY_TOLERANCE_SECONDS = 300; // 5 minutes

export function getMockWebhookSecret(): string {
  if (process.env.APP_ENVIRONMENT === 'production') {
    throw new Error('MOCK_PROVIDER_FORBIDDEN_IN_PRODUCTION');
  }
  const secret =
    process.env.PAYMENT_MOCK_WEBHOOK_SECRET ||
    (process.env.BACKUP_CALLBACK_SECRET
      ? `mock_wh_${process.env.BACKUP_CALLBACK_SECRET}`
      : 'staging-only-mock-webhook-secret-octopus-b2b');
  return secret;
}

export function signMockWebhookPayload(rawBody: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const secret = getMockWebhookSecret();
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${sig}`;
}

export const mockProviderAdapter: PaymentProviderAdapter = {
  name: 'mock',

  isConfigured(): boolean {
    return process.env.APP_ENVIRONMENT !== 'production';
  },

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutOutput> {
    if (process.env.APP_ENVIRONMENT === 'production') {
      throw new Error('MOCK_PROVIDER_FORBIDDEN_IN_PRODUCTION');
    }
    const providerSessionId = `mock_sess_${input.checkoutId.replace(/-/g, '')}`;
    return {
      provider: 'mock',
      providerSessionId,
      redirectUrl: `/pay/mock/${input.checkoutId}`,
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhookEvent> {
    if (process.env.APP_ENVIRONMENT === 'production') {
      throw new Error('MOCK_PROVIDER_FORBIDDEN_IN_PRODUCTION');
    }
    const sigHeader = headers.get('x-mock-signature') ?? '';
    const parts = Object.fromEntries(
      sigHeader.split(',').map((kv) => {
        const [k, v] = kv.trim().split('=');
        return [k, v ?? ''];
      }),
    );
    const ts = Number(parts.t);
    const v1 = parts.v1 ?? '';
    if (!Number.isFinite(ts) || !v1) {
      throw new Error('WEBHOOK_SIGNATURE_MISSING');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > REPLAY_TOLERANCE_SECONDS) {
      throw new Error('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE');
    }
    const secret = getMockWebhookSecret();
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${rawBody}`)
      .digest('hex');

    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('WEBHOOK_SIGNATURE_INVALID');
    }

    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const eventId = String(parsed.event_id ?? '');
    const checkoutId = String(parsed.checkout_id ?? '');
    const amountCents = Number(parsed.amount_cents ?? 0);
    const currency = String(parsed.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD';
    if (!eventId || !checkoutId || !Number.isFinite(amountCents)) {
      throw new Error('WEBHOOK_PAYLOAD_INVALID');
    }

    return {
      provider: 'mock',
      eventId,
      eventType: (parsed.event_type as VerifiedWebhookEvent['eventType']) ?? 'payment.succeeded',
      checkoutId,
      amountCents,
      currency,
      providerPaymentId: String(parsed.provider_payment_id ?? `mock_pay_${checkoutId.slice(0, 8)}`),
      providerCustomerId: parsed.provider_customer_id ? String(parsed.provider_customer_id) : null,
      providerPaymentMethodId: parsed.provider_payment_method_id ? String(parsed.provider_payment_method_id) : null,
      rawPayload: parsed,
    };
  },

  async getPayment(providerPaymentId: string): Promise<PaymentStatusOutput> {
    return {
      provider: 'mock',
      providerPaymentId,
      status: 'succeeded',
      amountCents: 0,
      currency: 'USD',
    };
  },

  async refund(input: RefundInput): Promise<RefundOutput> {
    if (process.env.APP_ENVIRONMENT === 'production') {
      throw new Error('MOCK_PROVIDER_FORBIDDEN_IN_PRODUCTION');
    }
    return {
      provider: 'mock',
      providerRefundId: `mock_re_${crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16)}`,
      status: 'succeeded',
    };
  },
};
