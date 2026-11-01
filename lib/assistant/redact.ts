/** Redaction before anything reaches the LLM or the tool-call log (SPEC §20.6). Pure — unit tested. */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// digit runs with phone-style separators, not glued to letters (keeps tracking numbers like YT2530412345678)
const PHONE_RE = /(?<![\w/@])\+?\(?\d[\d\s().-]{6,}\d(?![\w/])/g;
const STREET_RE =
  /\b\d{1,5}[A-Z]?\s+(?:[A-Z][\w.'-]*\s+){0,4}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|highway|hwy|court|ct|place|pl|square|sq|parkway|pkwy|terrace|close)\b\.?/gi;
const ADDRESS_LINE_RE = /^\s*(?:address|addr|ship(?:ping)? to|deliver(?:y)? to|billing address|street)\s*[:=].*$/gim;

function isPhone(m: string) {
  const digits = m.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  if (/\d{4}-\d{2}-\d{2}/.test(m)) return false; // ISO date
  return m.trim().startsWith('+') || /[\s().-]/.test(m.trim()) || digits.length >= 10;
}

export function redactText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(ADDRESS_LINE_RE, (l) => l.replace(/[:=].*$/, ': [address redacted]'))
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, (m) => (isPhone(m) ? '[phone]' : m))
    .replace(STREET_RE, '[address]');
}

/** Keys that are never sent to the model or logged (customer PII, supplier identities, internal money). */
export const SENSITIVE_KEY_RE =
  /(^|_)(email|phone|mobile|whatsapp|address|addresses|line1|line2|postal_code|zip|street|legal_name|contact|contact_name|registration_no|tax_id|vat|iban|bank|password|token|secret|api_key|cost|cost_cents|margin|supplier_name)($|_)/i;

/** Deep copy with sensitive keys dropped and every string redacted. */
export function redactObject<T>(value: T, depth = 0): T {
  if (depth > 8) return null as T;
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) continue;
      out[k] = redactObject(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
