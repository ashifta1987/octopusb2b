import crypto from 'node:crypto';
import Stripe from 'stripe';
import { describe, expect, it, afterEach } from 'vitest';
import {
  airwallexProviderAdapter,
  getPaymentProviderAdapter,
  mockProviderAdapter,
  resolveActiveOnlineProvider,
  signMockWebhookPayload,
  stripeProviderAdapter,
  validateAirwallexEnvironment,
  validateStripeEnvironmentKeys,
  type PaymentProviderSettingRow,
} from '@/lib/payments';
import { POST as mockWebhookPost } from '@/app/api/webhooks/payments/mock/route';

describe('Payments Security Guards & Provider Adapters', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('1. Fail closed on environment: mock provider and /api/webhooks/payments/mock work ONLY when APP_ENVIRONMENT === "staging"', async () => {
    process.env.PAYMENT_MOCK_WEBHOOK_SECRET = 'mock_secret_1234567890';

    for (const badEnv of ['production', 'development', 'test', '']) {
      process.env.APP_ENVIRONMENT = badEnv;
      expect(mockProviderAdapter.isConfigured()).toBe(false);
      expect(() => getPaymentProviderAdapter('mock')).toThrow(/MOCK_PROVIDER_REQUIRES_STAGING_ENV/);

      const res = await mockWebhookPost(new Request('http://localhost:3000/api/webhooks/payments/mock', { method: 'POST', body: '{}' }));
      expect(res.status).toBe(404);
    }

    process.env.APP_ENVIRONMENT = 'staging';
    expect(mockProviderAdapter.isConfigured()).toBe(true);
    expect(getPaymentProviderAdapter('mock').name).toBe('mock');
  });

  it('2. Reverse production guard: refuses Stripe test keys (sk_test_/pk_test_) and AIRWALLEX_ENV=demo on production, and refuses live keys on staging', () => {
    // On production: refuse test/demo keys
    expect(() => validateStripeEnvironmentKeys('sk_test_123', 'pk_test_123', 'production')).toThrow(
      /STRIPE_TEST_KEY_REFUSED_ON_PRODUCTION/,
    );
    expect(() => validateStripeEnvironmentKeys('sk_live_123', 'pk_test_123', 'production')).toThrow(
      /STRIPE_TEST_KEY_REFUSED_ON_PRODUCTION/,
    );
    expect(() => validateAirwallexEnvironment('demo', 'production')).toThrow(
      /AIRWALLEX_DEMO_REFUSED_ON_PRODUCTION/,
    );
    expect(() => validateAirwallexEnvironment('', 'production')).toThrow(
      /AIRWALLEX_DEMO_REFUSED_ON_PRODUCTION/,
    );

    // On staging: refuse live/prod keys
    expect(() => validateStripeEnvironmentKeys('sk_live_123', 'pk_live_123', 'staging')).toThrow(
      /STRIPE_LIVE_KEY_REFUSED_ON_STAGING/,
    );
    expect(() => validateAirwallexEnvironment('prod', 'staging')).toThrow(
      /AIRWALLEX_PROD_REFUSED_ON_STAGING/,
    );

    // Valid pairs pass
    expect(() => validateStripeEnvironmentKeys('sk_test_123', 'pk_test_123', 'staging')).not.toThrow();
    expect(() => validateStripeEnvironmentKeys('sk_live_123', 'pk_live_123', 'production')).not.toThrow();
    expect(validateAirwallexEnvironment('demo', 'staging')).toBe('demo');
    expect(validateAirwallexEnvironment('prod', 'production')).toBe('prod');
  });

  it('3. Mock webhook secret: requires its own PAYMENT_MOCK_WEBHOOK_SECRET and never derives from BACKUP_CALLBACK_SECRET', () => {
    process.env.APP_ENVIRONMENT = 'staging';
    process.env.BACKUP_CALLBACK_SECRET = 'backup_secret_must_never_be_used';
    delete process.env.PAYMENT_MOCK_WEBHOOK_SECRET;

    expect(mockProviderAdapter.isConfigured()).toBe(false);
    expect(() => signMockWebhookPayload('{"test":true}')).toThrow(/PAYMENT_MOCK_WEBHOOK_SECRET_NOT_CONFIGURED/);

    process.env.PAYMENT_MOCK_WEBHOOK_SECRET = 'dedicated_mock_webhook_secret_64_chars';
    expect(mockProviderAdapter.isConfigured()).toBe(true);
    const sig = signMockWebhookPayload('{"test":true}');
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('4. Signature verification: Stripe uses official SDK constructEvent on rawBody; Airwallex uses crypto.timingSafeEqual on rawBody', async () => {
    process.env.APP_ENVIRONMENT = 'staging';
    process.env.STRIPE_SECRET_KEY = 'sk_test_51MockKeyForUnitVerification';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe_secret_key';

    const stripeRawBody = JSON.stringify({
      id: 'evt_stripe_test_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          client_reference_id: '00000000-0000-0000-0000-000000000099',
          metadata: { checkout_id: '00000000-0000-0000-0000-000000000099' },
          amount_total: 45000,
          currency: 'usd',
          payment_intent: 'pi_test_999',
          customer: 'cus_test_888',
        },
      },
    });

    const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    const validStripeHeader = stripeClient.webhooks.generateTestHeaderString({
      payload: stripeRawBody,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });

    const verifiedStripe = await stripeProviderAdapter.verifyWebhook(
      stripeRawBody,
      new Headers({ 'stripe-signature': validStripeHeader }),
    );
    expect(verifiedStripe.provider).toBe('stripe');
    expect(verifiedStripe.eventId).toBe('evt_stripe_test_1');
    expect(verifiedStripe.checkoutId).toBe('00000000-0000-0000-0000-000000000099');
    expect(verifiedStripe.amountCents).toBe(45000);
    expect(verifiedStripe.providerPaymentId).toBe('pi_test_999');

    // Tampered raw body must be rejected by Stripe constructEvent
    await expect(
      stripeProviderAdapter.verifyWebhook(
        stripeRawBody.replace('45000', '100'),
        new Headers({ 'stripe-signature': validStripeHeader }),
      ),
    ).rejects.toThrow();

    // Airwallex raw body verification via crypto.timingSafeEqual
    process.env.AIRWALLEX_CLIENT_ID = 'awx_client_demo';
    process.env.AIRWALLEX_API_KEY = 'awx_key_demo';
    process.env.AIRWALLEX_WEBHOOK_SECRET = 'awx_whsec_demo';
    process.env.AIRWALLEX_ENV = 'demo';

    const awxRawBody = JSON.stringify({
      id: 'evt_awx_1',
      name: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'int_awx_999',
          merchant_order_id: '00000000-0000-0000-0000-000000000088',
          amount: 250.5,
          currency: 'USD',
        },
      },
    });
    const ts = String(Date.now());
    const awxSig = crypto
      .createHmac('sha256', process.env.AIRWALLEX_WEBHOOK_SECRET)
      .update(`${ts}${awxRawBody}`)
      .digest('hex');

    const verifiedAwx = await airwallexProviderAdapter.verifyWebhook(
      awxRawBody,
      new Headers({ 'x-timestamp': ts, 'x-signature': awxSig }),
    );
    expect(verifiedAwx.provider).toBe('airwallex');
    expect(verifiedAwx.amountCents).toBe(25050);

    await expect(
      airwallexProviderAdapter.verifyWebhook(
        awxRawBody.replace('250.5', '1.0'),
        new Headers({ 'x-timestamp': ts, 'x-signature': awxSig }),
      ),
    ).rejects.toThrow(/AIRWALLEX_SIGNATURE_INVALID/);
  });

  it('5. No provider = no "Pay online": resolveActiveOnlineProvider returns null when no real provider is enabled/configured and never falls back to mock on production', () => {
    const rows: PaymentProviderSettingRow[] = [
      {
        provider: 'mock',
        display_name: 'Mock',
        enabled: true,
        methods: ['card'],
        priority: 1,
        legal_entity_id: '00000000-0000-0000-0000-000000000001',
        fee_mode: 'absorb',
        fee_bp: 290,
        fee_fixed_cents: 30,
      },
      {
        provider: 'stripe',
        display_name: 'Stripe',
        enabled: false,
        methods: ['card'],
        priority: 10,
        legal_entity_id: '00000000-0000-0000-0000-000000000001',
        fee_mode: 'absorb',
        fee_bp: 290,
        fee_fixed_cents: 30,
      },
    ];

    process.env.APP_ENVIRONMENT = 'production';
    process.env.PAYMENT_MOCK_WEBHOOK_SECRET = 'secret';
    expect(resolveActiveOnlineProvider(rows)).toBeNull();
  });
});
