import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_VIEWS,
  DEFAULT_RFQ_QUERY,
  RFQ_TABS,
  TAB_STATUSES,
  acceptsQuotes,
  ageInfo,
  closedNote,
  isRecordTab,
  lineSummary,
  linesForRecord,
  parseRfqQuery,
  queryFromView,
  quoteFormGate,
  quoteStatusName,
  quoteSummary,
  rfqPerms,
  rfqQueryHref,
  rfqStatusName,
  rfqSteps,
  supplierCell,
  tabAscending,
  tabCounts,
} from '@/app/ods/office/rfqs/_lib/rfq-core';

describe('status mapping (Appendix C request names)', () => {
  it('maps every rfqs.status to an Appendix C name', () => {
    expect(rfqStatusName('draft')).toBe('Draft');
    expect(rfqStatusName('submitted')).toBe('Sent');
    expect(rfqStatusName('assigned')).toBe('Sent');
    expect(rfqStatusName('quoting')).toBe('Quoting');
    expect(rfqStatusName('quoted')).toBe('Quote ready');
    expect(rfqStatusName('accepted')).toBe('Accepted');
    expect(rfqStatusName('expired')).toBe('Closed');
    expect(rfqStatusName('cancelled')).toBe('Closed');
  });
  it('keeps today’s filter lists for open / to_quote / accepted / closed', () => {
    expect(TAB_STATUSES.open).toEqual(['submitted', 'assigned', 'quoting', 'quoted']);
    expect(TAB_STATUSES.to_quote).toEqual(['submitted', 'assigned', 'quoting']);
    expect(TAB_STATUSES.accepted).toEqual(['accepted']);
    expect(TAB_STATUSES.closed).toEqual(['expired', 'cancelled']);
  });
  it('each Appendix C tab only holds statuses with that name', () => {
    const named: [keyof typeof TAB_STATUSES, string][] = [['sent', 'Sent'], ['quoting', 'Quoting'], ['quote_ready', 'Quote ready'], ['accepted', 'Accepted'], ['closed', 'Closed']];
    for (const [tab, name] of named) for (const s of TAB_STATUSES[tab]) expect(rfqStatusName(s)).toBe(name);
    expect(RFQ_TABS.map(([, l]) => l)).toEqual(['Open', 'To quote', 'Sent', 'Quoting', 'Quote ready', 'Accepted', 'Closed', 'All']);
  });
  it('tab counts sum raw status counts', () => {
    const c = tabCounts({ submitted: 2, assigned: 1, quoting: 3, quoted: 4, accepted: 5, expired: 1, cancelled: 2, draft: 9 });
    expect(c).toMatchObject({ open: 10, to_quote: 6, sent: 3, quoting: 3, quote_ready: 4, accepted: 5, closed: 3, all: 18 });
  });
  it('order: open tabs oldest first, accepted / closed / all newest first (today)', () => {
    expect(tabAscending('open')).toBe(true);
    expect(tabAscending('to_quote')).toBe(true);
    expect(tabAscending('accepted')).toBe(false);
    expect(tabAscending('closed')).toBe(false);
  });
  it('stepper Sent → Quoting → Quote ready → Accepted → Ordered', () => {
    const st = (raw: string, o = { hasOrder: false, quotes: 0 }) => rfqSteps(raw, o).map((s) => s.status);
    expect(rfqSteps('quoted', { hasOrder: false, quotes: 1 }).map((s) => s.label)).toEqual(['Sent', 'Quoting', 'Quote ready', 'Accepted', 'Ordered']);
    expect(st('submitted')).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(st('quoted')).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(st('accepted', { hasOrder: true, quotes: 2 })).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(st('expired', { hasOrder: false, quotes: 1 })).not.toContain('current');
    expect(closedNote('expired')).toMatch(/expired/);
    expect(closedNote('quoted')).toBeNull();
  });
  it('quote statuses → words, list summary', () => {
    expect(quoteStatusName('approved')).toBe('Accepted');
    expect(quoteStatusName('viewed')).toBe('Sent');
    expect(quoteSummary([])).toEqual({ text: 'No quotes', status: null });
    expect(quoteSummary(['sent', 'viewed'])).toEqual({ text: '2 sent · viewed', status: 'Sent' });
    expect(quoteSummary(['rejected', 'approved'])).toEqual({ text: 'Accepted', status: 'Accepted' });
    expect(quoteSummary(['expired'])).toEqual({ text: 'Expired', status: 'Closed' });
  });
  it('today’s red age rule: > 48 h, no quote, not accepted', () => {
    const now = Date.parse('2026-11-27T10:00:00Z');
    expect(ageInfo('2026-11-27T07:00:00Z', now, 0, 'submitted')).toEqual({ text: '3 h', late: false });
    expect(ageInfo('2026-11-24T10:00:00Z', now, 0, 'assigned')).toEqual({ text: '3 d', late: true });
    expect(ageInfo('2026-11-24T10:00:00Z', now, 1, 'quoted').late).toBe(false);
    expect(ageInfo('2026-11-24T10:00:00Z', now, 0, 'accepted').late).toBe(false);
  });
});

describe('URL state', () => {
  it('?f= keeps today’s keys; unknown → open', () => {
    expect(parseRfqQuery({ f: 'to_quote' }).f).toBe('to_quote');
    expect(parseRfqQuery({ f: 'nope' })).toEqual(DEFAULT_RFQ_QUERY);
    expect(rfqQueryHref('/office/rfqs', { f: 'to_quote', q: '', view: null })).toBe('/office/rfqs?f=to_quote');
    expect(rfqQueryHref('/office/rfqs', DEFAULT_RFQ_QUERY)).toBe('/office/rfqs');
    expect(rfqQueryHref('/x', { f: 'closed', q: 'mug', view: 'v1' }, { state: 'list' })).toBe('/x?state=list&f=closed&q=mug&view=v1');
  });
  it('views → query', () => {
    expect(BUILTIN_VIEWS.map((v) => v.filters.f)).toEqual(['open', 'to_quote']);
    expect(queryFromView({ f: 'quote_ready', q: 'lagos' }, 'sv')).toEqual({ f: 'quote_ready', q: 'lagos', view: 'sv' });
    expect(queryFromView({ f: 42 }, null).f).toBe('open');
  });
  it('record tabs', () => {
    expect(isRecordTab('lines')).toBe(true);
    expect(isRecordTab('notes')).toBe(false);
  });
});

describe('line summary (audit C4: all lines, not only line 1)', () => {
  const lines = [
    { line_no: 2, title: 'Coaster', quantity: 10, unit: 'sets' },
    { line_no: 1, title: 'Mug', quantity: 10, unit: 'pcs' },
    { line_no: 3, title: 'Box', quantity: 10, unit: 'pcs' },
  ];
  it('counts every line and names the first by line number', () => {
    expect(lineSummary(lines, { title: 'Mug' })).toEqual({ count: 3, firstTitle: 'Mug', more: 2, text: 'Mug +2 more', fromLines: true });
  });
  it('no readable lines → line 1 = the RFQ (today’s view)', () => {
    expect(lineSummary(null, { title: 'Pan' })).toEqual({ count: 1, firstTitle: 'Pan', more: 0, text: 'Pan', fromLines: false });
    expect(lineSummary([], { title: 'Pan' }).fromLines).toBe(false);
  });
  it('record lines carry quantity, target price and customisation', () => {
    const r = linesForRecord(
      [
        { line_no: 2, title: 'B', quantity: 5, unit: 'sets', target_price_minor: null, customisation: [], notes: null, product_id: null },
        { line_no: 1, title: 'A', quantity: 9, unit: null, target_price_minor: 120, customisation: ['logo_print', ''], notes: 'n', product_id: 'p' },
      ],
      { title: 'A', quantity: 9, unit: 'pcs', target_price_cents: 120 },
    );
    expect(r.fromLines).toBe(true);
    expect(r.rows.map((x) => x.lineNo)).toEqual([1, 2]);
    expect(r.rows[0]).toMatchObject({ unit: 'pcs', targetMinor: 120, customisation: ['logo_print'], notes: 'n', productId: 'p' });
    const f = linesForRecord(null, { title: 'Solo', quantity: 3, unit: 'boxes', target_price_cents: null });
    expect(f).toEqual({ fromLines: false, rows: [{ lineNo: 1, title: 'Solo', quantity: 3, unit: 'boxes', targetMinor: null, customisation: [], notes: null, productId: null }] });
  });
});

describe('permission visibility (white-label)', () => {
  const as = (perms: string[], admin = false) => rfqPerms((a, act = 'view') => admin || perms.includes(`${a}:${act}`));
  it('sourcing agent (seed role) sees suppliers and may quote + reply', () => {
    expect(as(['requests:view', 'requests:create', 'requests:edit', 'suppliers:view'])).toEqual({ canQuote: true, canReply: true, canSeeSuppliers: true, canOpenCustomer: false });
  });
  it('without suppliers:view nothing about the supplier is kept', () => {
    const p = as(['requests:view', 'requests:create']);
    expect(p.canSeeSuppliers).toBe(false);
    expect(supplierCell(p, { code: 'SUP-1', legal_name: 'Factory Ltd', country: 'CN' })).toEqual({ hidden: true });
    expect(JSON.stringify(supplierCell(p, { code: 'SUP-1', legal_name: 'Factory Ltd', country: 'CN' }))).not.toContain('Factory');
  });
  it('with suppliers:view the supplier is shown', () => {
    expect(supplierCell(as(['suppliers:view']), { code: 'SUP-1', legal_name: 'Factory Ltd', country: 'CN' })).toEqual({ hidden: false, code: 'SUP-1', name: 'Factory Ltd', country: 'CN' });
  });
  it('admin sees everything', () => {
    expect(Object.values(as([], true)).every(Boolean)).toBe(true);
  });
  it('quote form gate = today’s texts (closed RFQ, no requests:create)', () => {
    expect(acceptsQuotes('quoted')).toBe(true);
    expect(acceptsQuotes('accepted')).toBe(false);
    expect(quoteFormGate('expired', { canQuote: true })).toEqual({ ok: false, reason: 'This RFQ is expired and no longer accepts quotes.' });
    expect(quoteFormGate('quoting', { canQuote: false })).toEqual({ ok: false, reason: 'You don’t have permission to send quotes.' });
    expect(quoteFormGate('submitted', { canQuote: true })).toEqual({ ok: true });
  });
});

describe('static guards', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  it('both pages are ODS T9 screens behind today’s Requests guard', () => {
    for (const p of ['app/ods/office/rfqs/page.tsx', 'app/ods/office/rfqs/[id]/page.tsx']) {
      const src = read(p);
      expect(src.startsWith('// ODS T9')).toBe(true);
      expect(src).toContain("requireStaff('requests', 'view'");
    }
  });
  it('the record uses today’s actions (sendQuote, MessageForm) and adds no write of its own', () => {
    const page = read('app/ods/office/rfqs/[id]/page.tsx');
    expect(page).toContain("import { sendQuote } from '@/components/backoffice/quote-actions'");
    expect(page).toContain("import { MessageForm } from '@/components/account/sourcing-forms'");
    const grids = read('app/ods/office/rfqs/_components/rfq-grids.tsx');
    expect(grids).toContain("import { QuoteForm } from '@/components/backoffice/quote-form'");
    for (const p of ['app/ods/office/rfqs/_lib/rfq-data.ts', 'app/ods/office/rfqs/[id]/page.tsx', 'app/ods/office/rfqs/page.tsx']) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
  });
  it('suppliers are read only behind suppliers:view', () => {
    const data = read('app/ods/office/rfqs/_lib/rfq-data.ts');
    expect(data).toContain('perms.canSeeSuppliers\n    ? await withSuppliers(');
    const page = read('app/ods/office/rfqs/[id]/page.tsx');
    expect(page).toContain('gate.ok && perms.canSeeSuppliers ? loadSupplierOptions()');
  });
});
