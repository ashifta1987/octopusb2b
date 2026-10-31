import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS } from '@/components/backoffice/import-columns';
import {
  buildCms, buildCustomers, buildLedger, buildProducts, buildTickets, buildWallet, categoryPaths, dateBounds, PRODUCT_TEMPLATE_COLUMNS, rowCounts, sanitize, toCsv, toJson, toXlsx, withAmounts,
} from '@/lib/backup/export-builders';

const cats = [
  { id: 'c1', parent_id: null, name: 'Fasteners' },
  { id: 'c2', parent_id: 'c1', name: 'Bolts' },
  { id: 'c3', parent_id: 'c2', name: 'Hex bolts' },
];

describe('export builders', () => {
  it('builds category paths', () => {
    expect(categoryPaths(cats).get('c3')).toBe('Fasteners > Bolts > Hex bolts');
  });

  it('products sheet uses exactly the bulk-upload template columns, with tiers in the row currency', () => {
    const [tpl, details] = buildProducts(
      [{ id: 'p1', slug: 'bolt', title: 'Hex bolt', supplier_id: 's1', category_id: 'c3', status: 'published', unit: 'pcs', moq: 1000, incoterm: 'FOB', currency: 'CNY', octopus_dropship: false, ready_to_ship: true }],
      [{ product_id: 'p1', min_qty: 5000, unit_price_cents: 110, currency: 'CNY' }, { product_id: 'p1', min_qty: 1000, unit_price_cents: 130, currency: 'CNY' }],
      cats,
      [{ id: 's1', code: 'OCT-1101' }],
    );
    expect(tpl.columns).toEqual(IMPORT_COLUMNS.map((c) => c.key));
    expect(PRODUCT_TEMPLATE_COLUMNS).toEqual(tpl.columns);
    expect(tpl.rows[0]).toMatchObject({ category_path: 'Fasteners > Bolts > Hex bolts', supplier_code: 'OCT-1101', currency: 'CNY', tier1_qty: 1000, tier1_price: 1.3, tier2_qty: 5000, tier2_price: 1.1, tier3_qty: null, octopus_dropship: 'no', ready_to_ship: 'yes' });
    expect(details.rows[0].tiers).toBe('1000@1.30 CNY; 5000@1.10 CNY');
  });

  it('never exports secrets; adds decimal amounts next to minor units', () => {
    expect(sanitize({ name: 'x', key_hash: 'h', client_secret: 's', meta: { a: 1 } })).toEqual({ name: 'x', meta: '{"a":1}' });
    expect(withAmounts({ debit_cents: 1050, balance_minor: 7, currency: 'USD' })).toEqual({ debit_cents: 1050, debit_amount: 10.5, balance_minor: 7, balance_amount: 0.07, currency: 'USD' });
  });

  it('customers carry KYC status only; ledger + wallet keep each row currency', () => {
    const [c] = buildCustomers(
      [{ id: 'o1', name: 'Acme', kyc_status: 'approved' }],
      [{ org_id: 'o1', status: 'submitted', created_at: '2026-01-01' }, { org_id: 'o1', status: 'approved', created_at: '2026-02-01', reviewed_at: '2026-02-02' }],
    );
    expect(c.rows[0]).toMatchObject({ name: 'Acme', kyc_status: 'approved', kyc_submission_status: 'approved' });
    expect(c.columns.some((k) => k.includes('document'))).toBe(false);

    const [l] = buildLedger(
      [{ id: 1, journal_id: 'j1', account_id: 'a1', org_id: 'o1', debit_cents: 500, credit_cents: 0, currency: 'CNY', memo: 'top-up' }],
      [{ id: 'j1', number: 'JR-1', stream: 'wallet' }],
      [{ id: 'a1', code: '2100', name: 'Wallet', kind: 'liability' }],
      [{ id: 'o1', name: 'Acme' }],
    );
    expect(l.rows[0]).toMatchObject({ journal: 'JR-1', account_code: '2100', customer: 'Acme', currency: 'CNY', debit_amount: 5 });

    const w = buildWallet([{ org_id: 'o1', currency: 'USD ', balance_minor: 1999 }], [], [{ id: 'o1', name: 'Acme' }]);
    expect(w[0].rows[0]).toMatchObject({ currency: 'USD', balance_amount: 19.99 });
  });

  it('ticket messages count attachments but never include files', () => {
    const [, msgs] = buildTickets([{ id: 't1', code: 'TK-1', org_id: 'o1' }], [{ ticket_id: 't1', body: 'hi', attachments: [{ path: 'tickets/x.pdf' }] }], [{ id: 'o1', name: 'Acme' }], []);
    expect(msgs.rows[0]).toMatchObject({ ticket: 'TK-1', attachments: 1 });
    expect(JSON.stringify(msgs.rows)).not.toContain('x.pdf');
  });

  it('serialises CSV (RFC 4180 + BOM), JSON and XLSX', async () => {
    const sheets = buildCms([{ key: 'hero', value: 'Hello, "world"\nline2', status: 'published' }], [], [], [{ brand: 'Octopus' }], []);
    const csv = toCsv(sheets[0]);
    expect(csv.startsWith('\ufeffkey,value,status,updated_at\r\n')).toBe(true);
    expect(csv).toContain('"Hello, ""world""\nline2"');
    const json = JSON.parse(toJson(sheets, { export: 'EX-0001' }));
    expect(json._meta.export).toBe('EX-0001');
    expect(json.content_blocks[0].key).toBe('hero');
    expect(rowCounts(sheets)).toMatchObject({ content_blocks: 1, pages: 0, company: 1 });

    const buf = await toXlsx(sheets, { export: 'EX-0001' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['content_blocks', 'pages', 'terms_versions', 'company', 'branches', 'About']);
    expect(wb.getWorksheet('content_blocks')!.getRow(2).getCell(1).value).toBe('hero');
  });

  it('date range is inclusive of the end day', () => {
    expect(dateBounds('2026-10-01', '2026-10-31')).toEqual({ gte: '2026-10-01T00:00:00.000Z', lt: '2026-11-01T00:00:00.000Z' });
    expect(dateBounds(null, undefined)).toEqual({ gte: null, lt: null });
  });
});
