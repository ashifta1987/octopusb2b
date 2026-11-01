import { describe, expect, it } from 'vitest';
import { detectEscalation, handoffReply, isHumanRequest, isVip, isWithinOfficeHours, matchSensitiveTopic, officeHoursLabel } from '@/lib/assistant/escalation';
import { redactObject, redactText } from '@/lib/assistant/redact';
import { clampConfidence, parseModelReply, sanitizeReply } from '@/lib/assistant/reply-parse';
import { TOOL_DEFINITIONS, TOOL_NAMES, validateToolArgs } from '@/lib/assistant/tool-schemas';

const TOPICS = ['refund', 'credit note', 'discount', 'dispute', 'qc failure', 'legal', 'tax', 'customs', 'complaint', 'cancel', 'data request'];
const HOURS = { timezone: 'Asia/Shanghai', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
// 2026-11-02 is a Monday. Shanghai = UTC+8.
const MON_10_SHA = new Date('2026-11-02T02:00:00Z');
const MON_20_SHA = new Date('2026-11-02T12:00:00Z');
const SAT_10_SHA = new Date('2026-11-07T02:00:00Z');

describe('escalation: explicit human request', () => {
  it.each(['Can I talk to someone?', 'I want a HUMAN', 'connect me with my account manager', 'please escalate this', 'get me an agent', 'speak with a real person'])('detects "%s"', (t) => {
    expect(isHumanRequest(t)).toBe(true);
  });
  it.each(['Where is my order ORD-2202?', 'Compare quotes on RFQ-1003', 'humanitarian shipment labels'])('ignores "%s"', (t) => {
    expect(isHumanRequest(t)).toBe(false);
  });
});

describe('escalation: sensitive topics (word match, case-insensitive)', () => {
  it('matches whole words and inflections', () => {
    expect(matchSensitiveTopic('I need a REFUND for the shipping', TOPICS)).toBe('refund');
    expect(matchSensitiveTopic('Can I get refunded?', TOPICS)).toBe('refund');
    expect(matchSensitiveTopic('Please issue a credit  note', TOPICS)).toBe('credit note');
    expect(matchSensitiveTopic('I want to cancel the order', TOPICS)).toBe('cancel');
    expect(matchSensitiveTopic('order cancellation please', TOPICS)).toBe('cancel');
    expect(matchSensitiveTopic('We had a QC failure on batch 2', TOPICS)).toBe('qc failure');
    expect(matchSensitiveTopic('import taxes to Germany?', TOPICS)).toBe('tax');
  });
  it('does not match substrings of other words', () => {
    expect(matchSensitiveTopic('Book a taxi to the port', TOPICS)).toBeNull();
    expect(matchSensitiveTopic('Is this illegal?', ['legal'])).toBeNull();
    expect(matchSensitiveTopic('Where is my shipment?', TOPICS)).toBeNull();
  });
  it('treats regex characters in topics literally and skips blanks', () => {
    expect(matchSensitiveTopic('price (adj.) please', ['(adj.)', ''])).toBeNull();
    expect(matchSensitiveTopic('a.b test', ['a.b'])).toBe('a.b');
    expect(matchSensitiveTopic('axb test', ['a.b'])).toBeNull();
  });
});

describe('escalation: VIP + office hours', () => {
  it('flags VIP orgs only', () => {
    expect(isVip('org-1', ['org-1', 'org-2'])).toBe(true);
    expect(isVip('org-3', ['org-1'])).toBe(false);
    expect(isVip(null, ['org-1'])).toBe(false);
  });
  it('computes office hours in the configured time zone', () => {
    expect(isWithinOfficeHours(HOURS, MON_10_SHA)).toBe(true);
    expect(isWithinOfficeHours(HOURS, MON_20_SHA)).toBe(false);
    expect(isWithinOfficeHours(HOURS, SAT_10_SHA)).toBe(false);
    expect(isWithinOfficeHours(null, MON_20_SHA)).toBe(true);
    expect(isWithinOfficeHours({ ...HOURS, timezone: 'Not/AZone' }, MON_20_SHA)).toBe(true);
  });
  it('labels office hours', () => {
    expect(officeHoursLabel(HOURS)).toBe('Mon–Fri 09:00–18:00 CST');
  });
});

describe('detectEscalation (priority order)', () => {
  const base = { topics: TOPICS, vipIds: [] as string[], orgId: 'org-1', hours: HOURS, now: MON_20_SHA };
  it('explicit request wins over topic', () => {
    expect(detectEscalation({ ...base, text: 'Talk to someone about my refund' })).toEqual({ reason: 'customer_request' });
  });
  it('sensitive topic carries the matched topic', () => {
    expect(detectEscalation({ ...base, text: 'I want a discount' })).toEqual({ reason: 'sensitive_topic', detail: 'discount' });
  });
  it('VIP routes every message', () => {
    expect(detectEscalation({ ...base, vipIds: ['org-1'], text: 'Where is ORD-2202?' })).toEqual({ reason: 'vip' });
  });
  it('after hours only when the customer prefers a human', () => {
    expect(detectEscalation({ ...base, text: 'Where is ORD-2202?' })).toBeNull();
    expect(detectEscalation({ ...base, text: 'Where is ORD-2202?', preferHuman: true })).toEqual({ reason: 'after_hours' });
    expect(detectEscalation({ ...base, text: 'Where is ORD-2202?', preferHuman: true, now: MON_10_SHA })).toBeNull();
  });
  it('handoff replies name the manager and never claim to be human', () => {
    const t = handoffReply({ reason: 'sensitive_topic', detail: 'refund' }, 'Priya Raman', null);
    expect(t).toContain('Priya Raman');
    expect(t).toContain('refund');
    expect(t).not.toMatch(/I am (a )?human/i);
  });
});

describe('redaction', () => {
  it('removes emails, phones and street addresses', () => {
    const out = redactText('Mail ana@northline.com or call +1 (415) 555-0134. Ship to 814 Harbor Rd, Oakland.');
    expect(out).not.toContain('ana@northline.com');
    expect(out).not.toContain('555-0134');
    expect(out).not.toContain('814 Harbor Rd');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[address]');
  });
  it('redacts "Address:" lines', () => {
    expect(redactText('Address: Unit 5, Somewhere Industrial Park')).toBe('Address: [address redacted]');
  });
  it('keeps tracking numbers, codes, dates and money', () => {
    const s = 'ORD-2202 tracking YT2530412345678 on 2026-10-30, total US$ 1,400.00, 10,000 pcs, RFQ-1003';
    expect(redactText(s)).toBe(s);
  });
  it('drops sensitive keys deeply and redacts strings', () => {
    const out = redactObject({ title: 'Bolts', email: 'x@y.com', contact: { phone: '1' }, nested: [{ address_line1: 'a', note: 'call +44 20 7946 0958' }], supplier_name: 'Acme Ltd' });
    expect(out).toEqual({ title: 'Bolts', nested: [{ note: 'call [phone]' }] });
  });
});

describe('tool argument validation (zod)', () => {
  it('exposes a definition for every tool', () => {
    expect(TOOL_DEFINITIONS.map((d) => d.function.name).sort()).toEqual([...TOOL_NAMES].sort());
  });
  it('accepts valid args from a JSON string', () => {
    const r = validateToolArgs('get_shipment', '{"tracking_or_order":"ORD-2202"}');
    expect(r.ok && r.args.tracking_or_order).toBe('ORD-2202');
  });
  it('rejects bad JSON and missing fields', () => {
    expect(validateToolArgs('get_shipment', '{oops').ok).toBe(false);
    expect(validateToolArgs('list_quotes', {}).ok).toBe(false);
  });
  it('coerces and normalises draft_rfq', () => {
    const r = validateToolArgs('draft_rfq', { title: 'Hex bolts M10', quantity: '2000', details: 'A2 stainless', destination_country: 'us', incoterm: 'FOB' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.args.quantity).toBe(2000); expect(r.args.destination_country).toBe('US'); }
    expect(validateToolArgs('draft_rfq', { title: 'x', quantity: 0, details: '' }).ok).toBe(false);
    expect(validateToolArgs('draft_rfq', { title: 'Hex bolts', quantity: 5, details: 'ok', incoterm: 'XYZ' }).ok).toBe(false);
  });
  it('validates draft_service_request codes and flattens values to strings', () => {
    const r = validateToolArgs('draft_service_request', { service_code: 'QC', details: { quantity: 2, urgent: true } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.args.service_code).toBe('qc'); expect(r.args.details).toEqual({ quantity: '2', urgent: 'true' }); }
    expect(validateToolArgs('draft_service_request', { service_code: 'drop table;', details: {} }).ok).toBe(false);
  });
  it('bounds get_terms_section', () => {
    expect(validateToolArgs('get_terms_section', { no: '7' }).ok).toBe(true);
    expect(validateToolArgs('get_terms_section', { no: 0 }).ok).toBe(false);
  });
});

describe('model reply parsing', () => {
  it('parses the JSON contract', () => {
    const r = parseModelReply('{"reply":"Your order shipped.","confidence":0.92,"sentiment":"positive","needs_staff_approval":false}');
    expect(r).toEqual({ reply: 'Your order shipped.', confidence: 0.92, sentiment: 'positive', needs_staff_approval: false, parsed: true });
  });
  it('normalises percentages, strings and unknown sentiment', () => {
    const r = parseModelReply('```json\n{"reply":"ok","confidence":"85%","sentiment":"Negative","needs_staff_approval":"true"}\n```');
    expect(r.confidence).toBe(0.85);
    expect(r.sentiment).toBe('negative');
    expect(r.needs_staff_approval).toBe(true);
    expect(parseModelReply('{"reply":"x","sentiment":"meh"}').sentiment).toBe('neutral');
  });
  it('falls back to plain text with medium confidence', () => {
    const r = parseModelReply('Your order is on the way.');
    expect(r.parsed).toBe(false);
    expect(r.reply).toBe('Your order is on the way.');
    expect(r.confidence).toBe(0.5);
  });
  it('handles empty and reply-less JSON', () => {
    expect(parseModelReply('').confidence).toBe(0);
    expect(parseModelReply('{"confidence":0.9}').parsed).toBe(false);
  });
  it('clamps confidence and never lets Octo claim to be human', () => {
    expect(clampConfidence(3)).toBe(0.03);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(250)).toBe(1);
    expect(clampConfidence('n/a')).toBe(0.5);
    expect(sanitizeReply("Don't worry, I'm a human.")).toBe("Don't worry, I'm Octo, an AI assistant.");
  });
});
