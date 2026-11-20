import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
import { renderDocumentHtml, type DocBundle } from '@/components/account/doc-html';

/** Customer invoice/receipt copies never show the supplier code; staff copies do. */
const bundle = (): DocBundle => ({
  doc: { id: '00000000-0000-0000-0000-000000000001', doc_type: 'invoice', number: 'INV-1', amount_cents: 10000, currency: 'USD', status: 'issued', data: null, created_at: '2026-11-01T00:00:00Z', order_id: 'o1', org_id: 'g1' },
  org: { name: 'Buyer Co' },
  order: { id: 'o1', code: 'ORD-1', title: 'Steel bottles', quantity: 100, unit_price_cents: 100, shipping_cents: 0, total_cents: 10000, currency: 'USD', deposit_pct: 30, deposit_cents: 3000, paid_cents: 0, created_at: '2026-11-01T00:00:00Z' },
  company: { legal_name: 'Octopus B2B' },
  kyc: null,
  rfq: { code: 'RFQ-7' },
  quote: null,
  supplier: { code: 'OCT-1234', country: 'CN' },
  hsCode: null,
  bank: null,
  settings: { deposit_pct: 30, claim_visible_days: 7, claim_hidden_days: 30, quote_validity_days: 14 },
});

describe('document supplier code', () => {
  it('is hidden on the customer copy (request code kept)', () => {
    const html = renderDocumentHtml(bundle(), { origin: 'https://x.test' });
    expect(html).not.toContain('OCT-1234');
    expect(html).not.toMatch(/Supplier OCT/);
    expect(html).toContain('RFQ-7');
  });
  it('is shown on the staff copy', () => {
    const html = renderDocumentHtml(bundle(), { origin: 'https://x.test', showSupplier: true });
    expect(html).toContain('Supplier OCT-1234');
  });
});
