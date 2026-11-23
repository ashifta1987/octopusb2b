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

const REPLAY_TOLERANCE_MS = 5 * 60 * 1000;

function getAirwallexBaseUrl(): string {
  const env = (process.env.AIRWALLEX_ENV ?? 'demo').toLowerCase();
  if (process.env.APP_ENVIRONMENT === 'staging' && env === 'prod') {
    throw new Error('AIRWALLEX_PROD_REFUSED_ON_STAGING: set AIRWALLEX_ENV=demo on staging');
  }
  return env === 'prod' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com';
}

async function getAirwallexBearerToken(): Promise<string> {
  const clientId = process.env.AIRWALLEX_CLIENT_ID ?? '';
  const apiKey = process.env.AIRWALLEX_API_KEY ?? '';
  if (!clientId || !apiKey) {
    throw new Error('AIRWALLEX_NOT_CONFIGURED: set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY');
  }
  const base = getAirwallexBaseUrl();
  const res = await fetch(`${base}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'x-client-id': clientId,
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });
  const data = (await res.json()) as { token?: string; message?: string };
  if (!res.ok || !data.token) {
    throw new Error(`AIRWALLEX_AUTH_FAILED: ${data.message ?? res.statusText}`);
  }
  return data.token;
}

export const airwallexProviderAdapter: PaymentProviderAdapter = {
  name: 'airwallex',

  isConfigured(): boolean {
    const clientId = process.env.AIRWALLEX_CLIENT_ID ?? '';
    const apiKey = process.env.AIRWALLEX_API_KEY ?? '';
    const env = (process.env.AIRWALLEX_ENV ?? 'demo').toLowerCase();
    if (!clientId || !apiKey) return false;
    if (process.env.APP_ENVIRONMENT === 'staging' && env === 'prod') return false;
    return true;
  },

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutOutput> {
    const token = await getAirwallexBearerToken();
    const base = getAirwallexBaseUrl();
    const res = await fetch(`${base}/api/v1/pa/payment_intents/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: `awx_chk_${input.checkoutId}`,
        amount: Number((input.amountCents / 100).toFixed(2)),
        currency: input.currency,
        merchant_order_id: input.checkoutId,
        descriptor: input.description.slice(0, 32),
        return_url: input.returnUrl,
        metadata: {
          checkout_id: input.checkoutId,
          org_id: input.orgId,
          service: input.service,
          payment_option: input.paymentOption,
        },
      }),
    });
    const data = (await res.json()) as { id?: string; client_secret?: string; message?: string };
    if (!res.ok || !data.id) {
      throw new Error(`AIRWALLEX_CHECKOUT_FAILED: ${data.message ?? res.statusText}`);
    }
    return {
      provider: 'airwallex',
      providerSessionId: data.id,
      redirectUrl: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}awx_intent=${encodeURIComponent(data.id)}`,
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhookEvent> {
    const secret = process.env.AIRWALLEX_WEBHOOK_SECRET ?? '';
    if (!secret) {
      throw new Error('AIRWALLEX_WEBHOOK_SECRET_NOT_CONFIGURED');
    }
    const timestamp = headers.get('x-timestamp') ?? '';
    const signature = headers.get('x-signature') ?? '';
    const tsNum = Number(timestamp);
    if (!timestamp || !signature || !Number.isFinite(tsNum)) {
      throw new Error('AIRWALLEX_SIGNATURE_MISSING');
    }
    if (Math.abs(Date.now() - tsNum) > REPLAY_TOLERANCE_MS) {
      throw new Error('AIRWALLEX_TIMESTAMP_OUT_OF_TOLERANCE');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${rawBody}`)
      .digest('hex');
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('AIRWALLEX_SIGNATURE_INVALID');
    }

    const evt = JSON.parse(rawBody) as {
      id?: string;
      name?: string;
      data?: {
        object?: {
          id?: string;
          merchant_order_id?: string;
          metadata?: Record<string, string>;
          amount?: number;
          currency?: string;
          customer_id?: string;
          payment_consent_id?: string;
        };
      };
    };

    const obj = evt.data?.object ?? {};
    const checkoutId = obj.metadata?.checkout_id ?? obj.merchant_order_id ?? '';
    const amountCents = Math.round(Number(obj.amount ?? 0) * 100);
    const currency = String(obj.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD';

    return {
      provider: 'airwallex',
      eventId: String(evt.id ?? ''),
      eventType: evt.name === 'payment_intent.succeeded' ? 'payment.succeeded' : 'payment.failed',
      checkoutId,
      amountCents,
      currency,
      providerPaymentId: String(obj.id ?? ''),
      providerCustomerId: obj.customer_id ? String(obj.customer_id) : null,
      providerPaymentMethodId: obj.payment_consent_id ? String(obj.payment_consent_id) : null,
      rawPayload: evt as unknown as Record<string, unknown>,
    };
  },

  async getPayment(providerPaymentId: string): Promise<PaymentStatusOutput> {
    const token = await getAirwallexBearerToken();
    const base = getAirwallexBaseUrl();
    const res = await fetch(`${base}/api/v1/pa/payment_intents/${encodeURIComponent(providerPaymentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { status?: string; amount?: number; currency?: string };
    return {
      provider: 'airwallex',
      providerPaymentId,
      status: data.status === 'SUCCEEDED' ? 'succeeded' : 'pending',
      amountCents: Math.round(Number(data.amount ?? 0) * 100),
      currency: String(data.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD',
    };
  },

  async refund(input: RefundInput): Promise<RefundOutput> {
    const token = await getAirwallexBearerToken();
    const base = getAirwallexBaseUrl();
    const res = await fetch(`${base}/api/v1/pa/refunds/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: input.idempotencyKey,
        payment_intent_id: input.providerPaymentId,
        amount: Number((input.amountCents / 100).toFixed(2)),
        reason: input.reason,
      }),
    });
    const data = (await res.json()) as { id?: string; status?: string; message?: string };
    if (!res.ok || !data.id) {
      throw new Error(`AIRWALLEX_REFUND_FAILED: ${data.message ?? res.statusText}`);
    }
    return {
      provider: 'airwallex',
      providerRefundId: data.id,
      status: data.status === 'RECEIVED' || data.status === 'SUCCEEDED' ? 'succeeded' : 'pending',
    };
  },
};
