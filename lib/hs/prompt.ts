/**
 * Prompt + strict JSON schema for the HS heading classifier (no server deps, so scripts and tests can import it).
 * 6 Nov 2026: the first preview with gpt-4o-mini and a short prompt gave wrong headings at 0.9 confidence
 * (aroma diffusers → 8480 "moulding boxes"). Asking for the reason first and the official heading title, and using
 * gpt-4.1 by default, gave consistent results (fans 8414, humidifiers / diffusers 8509). Override with HS_AI_MODEL.
 */
export const HS_DEFAULT_MODEL = 'gpt-4.1';

export const HS_SYSTEM_PROMPT = [
  'You are a customs classification assistant. For each product, classify it under the Harmonized System (HS 2022) at HEADING level only.',
  'Rules:',
  '- First write a one-line reason: what the product is, its main function and, for machines/appliances, whether it is electric.',
  '- Then give the 4-digit heading (exactly 4 digits, e.g. "8414"; never a subheading, never more digits) and the official heading title as written in the HS nomenclature.',
  '- Classify by the product\'s essential function, applying the General Interpretative Rules. Check that the heading title you give actually covers the product; if it does not, pick another heading or lower your confidence.',
  '- product_type: a short generic name for the kind of product, singular, without brand, model, colour or size (e.g. "electric fan", "ultrasonic humidifier"). Use the same product_type for products of the same kind.',
  '- confidence 0-1: use 0.8 or higher only when you are sure the heading is correct. If the product is ambiguous, or the title alone does not say what it is, give a confidence below 0.8 rather than guessing.',
].join('\n');

export const HS_SCHEMA = {
  name: 'hs_headings', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'reason', 'heading', 'heading_title', 'confidence', 'product_type'],
      properties: {
        id: { type: 'string' }, reason: { type: 'string' }, heading: { type: 'string', pattern: '^[0-9]{4}$' },
        heading_title: { type: 'string' }, confidence: { type: 'number' }, product_type: { type: 'string' },
      },
    } } },
  },
} as const;

