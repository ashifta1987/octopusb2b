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

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const REPLAY_TOLERANCE_SECONDS = 300;

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key) {
    throw new Error('STRIPE_NOT_CONFIGURED: set STRIPE_SECRET_KEY in environment variables');
  }
  if (process.env.APP_ENVIRONMENT === 'staging' && key.startsWith('sk_live_')) {
    throw new Error('STRIPE_LIVE_KEY_REFUSED_ON_STAGING: never use sk_live_ keys on staging');
  }
  return key;
}

function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED');
  }
  return secret;
}

export const stripeProviderAdapter: PaymentProviderAdapter = {
  name: 'stripe',

  isConfigured(): boolean {
    const key = process.env.STRIPE_SECRET_KEY ?? '';
    if (!key) return false;
    if (process.env.APP_ENVIRONMENT === 'staging' && key.startsWith('sk_live_')) return false;
    return true;
  },

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutOutput> {
    const secretKey = getStripeSecretKey();
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', input.returnUrl);
    params.set('cancel_url', input.cancelUrl);
    params.set('client_reference_id', input.checkoutId);
    params.set('metadata[checkout_id]', input.checkoutId);
    params.set('metadata[org_id]', input.orgId);
    params.set('metadata[service]', input.service);
    params.set('metadata[payment_option]', input.paymentOption);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
    params.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
    params.set('line_items[0][price_data][product_data][name]', input.description);
    if (input.savePaymentMethod) {
      params.set('payment_intent_data[setup_future_usage]', 'off_session');
    }

    const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `stripe-chk-${input.checkoutId}`,
      },
      body: params.toString(),
    });
    const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !data.id || !data.url) {
      throw new Error(`STRIPE_CHECKOUT_FAILED: ${data.error?.message ?? res.statusText}`);
    }
    return {
      provider: 'stripe',
      providerSessionId: data.id,
      redirectUrl: data.url,
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhookEvent> {
    const secret = getStripeWebhookSecret();
    const sigHeader = headers.get('stripe-signature') ?? '';
    const items = sigHeader.split(',').map((s) => s.trim().split('='));
    const tItem = items.find(([k]) => k === 't');
    const v1Items = items.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
    const ts = Number(tItem?.[1]);
    if (!Number.isFinite(ts) || v1Items.length === 0) {
      throw new Error('STRIPE_SIGNATURE_MISSING');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > REPLAY_TOLERANCE_SECONDS) {
      throw new Error('STRIPE_TIMESTAMP_OUT_OF_TOLERANCE');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${rawBody}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const matched = v1Items.some((sig) => {
      const buf = Buffer.from(sig, 'utf8');
      return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
    });
    if (!matched) {
      throw new Error('STRIPE_SIGNATURE_INVALID');
    }

    const evt = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: {
        object?: {
          id?: string;
          client_reference_id?: string;
          metadata?: Record<string, string>;
          amount_total?: number;
          amount_received?: number;
          currency?: string;
          payment_intent?: string;
          customer?: string;
          payment_method?: string;
        };
      };
    };

    const obj = evt.data?.object ?? {};
    const checkoutId = obj.metadata?.checkout_id ?? obj.client_reference_id ?? '';
    const amountCents = Number(obj.amount_total ?? obj.amount_received ?? 0);
    const currency = String(obj.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD';

    return {
      provider: 'stripe',
      eventId: String(evt.id ?? ''),
      eventType:
        evt.type === 'checkout.session.completed' || evt.type === 'payment_intent.succeeded'
          ? 'payment.succeeded'
          : 'payment.failed',
      checkoutId,
      amountCents,
      currency,
      providerPaymentId: String(obj.payment_intent ?? obj.id ?? ''),
      providerCustomerId: obj.customer ? String(obj.customer) : null,
      providerPaymentMethodId: obj.payment_method ? String(obj.payment_method) : null,
      rawPayload: evt as unknown as Record<string, unknown>,
    };
  },

  async getPayment(providerPaymentId: string): Promise<PaymentStatusOutput> {
    const secretKey = getStripeSecretKey();
    const res = await fetch(`${STRIPE_API_BASE}/payment_intents/${encodeURIComponent(providerPaymentId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const data = (await res.json()) as { status?: string; amount?: number; currency?: string };
    return {
      provider: 'stripe',
      providerPaymentId,
      status: data.status === 'succeeded' ? 'succeeded' : 'pending',
      amountCents: Number(data.amount ?? 0),
      currency: String(data.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD',
    };
  },

  async refund(input: RefundInput): Promise<RefundOutput> {
    const secretKey = getStripeSecretKey();
    const params = new URLSearchParams();
    params.set('payment_intent', input.providerPaymentId);
    params.set('amount', String(input.amountCents));
    params.set('metadata[reason]', input.reason);

    const res = await fetch(`${STRIPE_API_BASE}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: params.toString(),
    });
    const data = (await res.json()) as { id?: string; status?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
      throw new Error(`STRIPE_REFUND_FAILED: ${data.error?.message ?? res.statusText}`);
    }
    return {
      provider: 'stripe',
      providerRefundId: data.id,
      status: data.status === 'succeeded' ? 'succeeded' : 'pending',
    };
  },
};
