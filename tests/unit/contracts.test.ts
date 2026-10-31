import { describe, expect, it } from 'vitest';
import { ApproveQuote, ProductQuery, ServiceRequest, SubmitRfq, TokenRequest, TopUp, WebhookEndpointCreate, WebhookEndpointUpdate } from '@/lib/contracts';

const uuid = '3f0c1a52-8f5e-4c6b-9b7a-2d1e0f9a8b7c';

describe('Zod contracts', () => {
  it('SubmitRfq: valid input with defaults and normalisation', () => {
    const r = SubmitRfq.parse({ title: 'Gloves', quantity: 5000, destinationCountry: 'nl' });
    expect(r.details).toBe('');
    expect(r.destinationCountry).toBe('NL');
  });
  it('SubmitRfq: rejects bad quantity, short title, bad incoterm, fractional price', () => {
    expect(SubmitRfq.safeParse({ title: 'Gloves', quantity: 0 }).success).toBe(false);
    expect(SubmitRfq.safeParse({ title: 'Gl', quantity: 10 }).success).toBe(false);
    expect(SubmitRfq.safeParse({ title: 'Gloves', quantity: 10, incoterm: 'XYZ' }).success).toBe(false);
    expect(SubmitRfq.safeParse({ title: 'Gloves', quantity: 10, targetPriceCents: 1.5 }).success).toBe(false);
    expect(SubmitRfq.safeParse({ title: 'Gloves', quantity: 10, productId: 'nope' }).success).toBe(false);
  });
  it('ApproveQuote: uuid required, terms optional', () => {
    expect(ApproveQuote.safeParse({ quoteId: uuid }).success).toBe(true);
    expect(ApproveQuote.safeParse({ quoteId: uuid, acceptTermsVersionId: uuid }).success).toBe(true);
    expect(ApproveQuote.safeParse({ quoteId: 'x' }).success).toBe(false);
  });
  it('ServiceRequest + TopUp', () => {
    expect(ServiceRequest.parse({ serviceCode: 'qc' }).details).toEqual({});
    expect(TopUp.parse({ amountCents: 5000 }).method).toBe('bank_transfer');
    expect(TopUp.safeParse({ amountCents: 99 }).success).toBe(false);
    expect(TopUp.safeParse({ amountCents: 100.5 }).success).toBe(false);
  });
  it('ProductQuery coerces query-string numbers and caps per_page', () => {
    const q = ProductQuery.parse({ page: '2', per_page: '50', q: ' bolts ' });
    expect(q).toMatchObject({ page: 2, per_page: 50, q: 'bolts' });
    expect(ProductQuery.parse({}).page).toBe(1);
    expect(ProductQuery.safeParse({ per_page: '500' }).success).toBe(false);
  });
  it('Webhook endpoints: https only (http for localhost), known events', () => {
    expect(WebhookEndpointCreate.safeParse({ url: 'https://example.com/hook', events: ['order.updated'] }).success).toBe(true);
    expect(WebhookEndpointCreate.safeParse({ url: 'http://localhost:3000/hook' }).success).toBe(true);
    expect(WebhookEndpointCreate.safeParse({ url: 'http://example.com/hook' }).success).toBe(false);
    expect(WebhookEndpointCreate.safeParse({ url: 'https://example.com', events: ['order.deleted'] }).success).toBe(false);
    expect(WebhookEndpointUpdate.safeParse({}).success).toBe(false);
    expect(WebhookEndpointUpdate.safeParse({ active: false }).success).toBe(true);
  });
  it('TokenRequest requires client_credentials', () => {
    expect(TokenRequest.safeParse({ grant_type: 'client_credentials', client_id: 'cli_1', client_secret: 'oct_test_x' }).success).toBe(true);
    expect(TokenRequest.safeParse({ grant_type: 'password', client_id: 'cli_1', client_secret: 'x' }).success).toBe(false);
  });
});
