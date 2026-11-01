import { z } from 'zod';

/** Tool argument validation (zod) + OpenAI function definitions for Octo's tools (SPEC §20.7 item 2). Pure — unit tested. */

const code = z.string().trim().min(2).max(80);

export const toolSchemas = {
  get_shipment: z.object({ tracking_or_order: code }),
  list_quotes: z.object({ rfq_id_or_code: code }),
  list_pools: z.object({ product_id_or_slug: z.string().trim().max(160).optional().nullable() }),
  draft_rfq: z.object({
    title: z.string().trim().min(3).max(160),
    quantity: z.coerce.number().int().positive().max(100_000_000),
    details: z.string().trim().min(3).max(4000),
    destination_country: z.string().trim().length(2).toUpperCase().optional().nullable(),
    destination_city: z.string().trim().max(120).optional().nullable(),
    target_price: z.coerce.number().positive().max(10_000_000).optional().nullable(),
    incoterm: z.enum(['EXW', 'FOB', 'CIF', 'DAP', 'DDP']).optional().nullable(),
    product_id: z.string().uuid().optional().nullable(),
  }),
  draft_service_request: z.object({
    service_code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, 'Unknown service'),
    details: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean()]).transform(String))
      .refine((d) => Object.keys(d).length <= 20, 'Too many fields'),
    product_id: z.string().uuid().optional().nullable(),
  }),
  get_terms_section: z.object({ no: z.coerce.number().int().min(1).max(100) }),
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
export const isToolName = (n: string): n is ToolName => (TOOL_NAMES as string[]).includes(n);

export type ToolArgs<N extends ToolName> = z.infer<(typeof toolSchemas)[N]>;

/** Validate raw JSON args from the model. */
export function validateToolArgs<N extends ToolName>(name: N, raw: unknown): { ok: true; args: ToolArgs<N> } | { ok: false; error: string } {
  let input = raw;
  if (typeof raw === 'string') {
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return { ok: false, error: 'Arguments are not valid JSON' };
    }
  }
  const r = toolSchemas[name].safeParse(input ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: `${i?.path.join('.') || 'args'}: ${i?.message ?? 'invalid'}` };
  }
  return { ok: true, args: r.data as ToolArgs<N> };
}

/** OpenAI Chat Completions `tools` (function definitions). */
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_shipment',
      description: "Live shipment status for one of the customer's orders: carrier, tracking number, latest scans, ETA. Accepts an order code (ORD-…), shipment code (SHP-…) or tracking number.",
      parameters: { type: 'object', properties: { tracking_or_order: { type: 'string', description: 'ORD-…, SHP-… or carrier tracking number' } }, required: ['tracking_or_order'], additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_quotes',
      description: 'Supplier quotes for one of the customer\'s RFQs (supplier shown by code only): unit price, incoterm, lead time, shipping, total, validity.',
      parameters: { type: 'object', properties: { rfq_id_or_code: { type: 'string', description: 'RFQ code (RFQ-…) or id' } }, required: ['rfq_id_or_code'], additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_pools',
      description: 'Open group-buy pools, optionally for one product (id or slug): pool price, progress, deadline.',
      parameters: { type: 'object', properties: { product_id_or_slug: { type: 'string', description: 'Product id or slug; omit for all open pools' } }, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draft_rfq',
      description: 'Prepare an RFQ DRAFT for the customer to review. This never submits — the customer must click Confirm in the chat.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Product name' },
          quantity: { type: 'integer' },
          details: { type: 'string', description: 'Specs, material, standard, packaging' },
          destination_country: { type: 'string', description: 'ISO-2 country code' },
          destination_city: { type: 'string' },
          target_price: { type: 'number', description: 'Target unit price in the platform currency (major units)' },
          incoterm: { type: 'string', enum: ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'] },
          product_id: { type: 'string' },
        },
        required: ['title', 'quantity', 'details'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draft_service_request',
      description: 'Prepare a service request DRAFT (sample, qc, certification, 3pl, dropship, sourcing…) for the customer to confirm. Never submits.',
      parameters: {
        type: 'object',
        properties: {
          service_code: { type: 'string', description: 'Service code, e.g. sample, qc, certification, 3pl, dropship' },
          details: { type: 'object', description: 'Flat key → text map, e.g. {"product":"…","quantity":"2","notes":"…"}', additionalProperties: { type: 'string' } },
          product_id: { type: 'string' },
        },
        required: ['service_code', 'details'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_terms_section',
      description: 'Text of one numbered section of the current published Octopus B2B Terms & Conditions.',
      parameters: { type: 'object', properties: { no: { type: 'integer', description: 'Section number' } }, required: ['no'], additionalProperties: false },
    },
  },
];
