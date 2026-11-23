import Stripe from 'stripe';
import type {
  CreateCheckoutInput,
  CreateCheckoutOutput,
  PaymentProviderAdapter,
  PaymentStatusOutput,
  RefundInput,
  RefundOutput,
  VerifiedWebhookEvent,
} from '../types';

const REPLAY_TOLERANCE_SECONDS = 300;

export function validateStripeEnvironmentKeys(
  secretKey = process.env.STRIPE_SECRET_KEY ?? '',
  pubKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  appEnv = process.env.APP_ENVIRONMENT ?? '',
): void {
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED: set STRIPE_SECRET_KEY in environment variables');
  }
  // Staging guard: refuse live keys on staging
  if (appEnv === 'staging' && (secretKey.startsWith('sk_live_') || pubKey.startsWith('pk_live_'))) {
    throw new Error('STRIPE_LIVE_KEY_REFUSED_ON_STAGING: never use sk_live_ or pk_live_ keys on staging');
  }
  // Reverse production guard: on production (or any non-staging environment), refuse Stripe test keys (sk_test_ / pk_test_)
  if (appEnv !== 'staging' && (secretKey.startsWith('sk_test_') || pubKey.startsWith('pk_test_'))) {
    throw new Error('STRIPE_TEST_KEY_REFUSED_ON_PRODUCTION: never use sk_test_ or pk_test_ keys on production');
  }
}

function getStripeClient(): Stripe {
  const secretKey = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  const pubKey = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
  validateStripeEnvironmentKeys(secretKey, pubKey, process.env.APP_ENVIRONMENT ?? '');
  return new Stripe(secretKey);
}

function getStripeWebhookSecret(): string {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED');
  }
  return secret;
}

export const stripeProviderAdapter: PaymentProviderAdapter = {
  name: 'stripe',

  isConfigured(): boolean {
    const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
    const pub = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
    const wh = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
    if (!key || !wh) return false;
    try {
      validateStripeEnvironmentKeys(key, pub, process.env.APP_ENVIRONMENT ?? '');
      return true;
    } catch {
      return false;
    }
  },

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutOutput> {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        success_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.checkoutId,
        metadata: {
          checkout_id: input.checkoutId,
          org_id: input.orgId,
          service: input.service,
          payment_option: input.paymentOption,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: {
                name: input.description,
              },
            },
          },
        ],
        ...(input.savePaymentMethod
          ? { payment_intent_data: { setup_future_usage: 'off_session' } }
          : {}),
      },
      { idempotencyKey: `stripe-chk-${input.checkoutId}` },
    );

    if (!session.id || !session.url) {
      throw new Error('STRIPE_CHECKOUT_FAILED: missing session id or url');
    }

    return {
      provider: 'stripe',
      providerSessionId: session.id,
      redirectUrl: session.url,
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhookEvent> {
    const stripe = getStripeClient();
    const secret = getStripeWebhookSecret();
    const sigHeader = headers.get('stripe-signature') ?? '';
    if (!sigHeader) {
      throw new Error('STRIPE_SIGNATURE_MISSING');
    }

    // Official Stripe SDK constructEvent on the raw request body
    const evt = stripe.webhooks.constructEvent(rawBody, sigHeader, secret, REPLAY_TOLERANCE_SECONDS);

    const obj = (evt.data?.object ?? {}) as unknown as {
      id?: string;
      client_reference_id?: string | null;
      metadata?: Record<string, string>;
      amount_total?: number | null;
      amount_received?: number | null;
      currency?: string | null;
      payment_intent?: string | { id?: string } | null;
      customer?: string | { id?: string } | null;
      payment_method?: string | { id?: string } | null;
    };

    const checkoutId = obj.metadata?.checkout_id ?? obj.client_reference_id ?? '';
    const amountCents = Number(obj.amount_total ?? obj.amount_received ?? 0);
    const currency = String(obj.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD';
    const paymentIntentId =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : obj.payment_intent?.id ?? obj.id ?? '';
    const customerId =
      typeof obj.customer === 'string' ? obj.customer : obj.customer?.id ?? null;
    const pmId =
      typeof obj.payment_method === 'string'
        ? obj.payment_method
        : obj.payment_method?.id ?? null;

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
      providerPaymentId: String(paymentIntentId),
      providerCustomerId: customerId ? String(customerId) : null,
      providerPaymentMethodId: pmId ? String(pmId) : null,
      rawPayload: evt as unknown as Record<string, unknown>,
    };
  },

  async getPayment(providerPaymentId: string): Promise<PaymentStatusOutput> {
    const stripe = getStripeClient();
    const pi = await stripe.paymentIntents.retrieve(providerPaymentId);
    return {
      provider: 'stripe',
      providerPaymentId,
      status: pi.status === 'succeeded' ? 'succeeded' : 'pending',
      amountCents: Number(pi.amount ?? 0),
      currency: String(pi.currency ?? 'USD').toUpperCase() as 'USD' | 'CNY' | 'HKD',
    };
  },

  async refund(input: RefundInput): Promise<RefundOutput> {
    const stripe = getStripeClient();
    const re = await stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amountCents,
        metadata: { reason: input.reason },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      provider: 'stripe',
      providerRefundId: re.id,
      status: re.status === 'succeeded' ? 'succeeded' : 'pending',
    };
  },
};
