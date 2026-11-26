import { z } from 'zod';
import { COUNTRY_NAMES } from '@/lib/format';

/** Request Center (Request.png) — one field config per request type; the SAME zod schema runs in the form and the server action. */
/** W7 (owner, 26 Nov 2026): '3pl' is no longer a request type — 3PL starts at /3pl (Warehouse OS intro + Apply). */
export const REQUEST_TYPES = ['sourcing', 'dropship', 'sample', 'qc', 'certification', 'factory-audit'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const isRequestType = (t: string): t is RequestType => (REQUEST_TYPES as readonly string[]).includes(t);
/** Service code charged for each type (`rfq` for sourcing via submit_rfq, else request_service). */
export const SERVICE_CODE: Record<RequestType, string> = { sourcing: 'rfq', dropship: 'dropship', sample: 'sample', qc: 'qc', certification: 'certification', 'factory-audit': 'factory_audit' };

export type Field = {
  name: string; label: string; kind: 'text' | 'textarea' | 'int' | 'money' | 'select' | 'date' | 'country';
  required?: boolean; placeholder?: string; options?: string[]; full?: boolean; max?: number; hint?: string;
};
export type Section = { title: string; fields: Field[] };

const notes: Field = { name: 'notes', label: 'Anything else we should know?', kind: 'textarea', full: true, placeholder: 'Specs, links, packaging, timing' };

export const REQUEST_FIELDS: Record<RequestType, Section[]> = {
  sourcing: [{
    title: 'The product',
    fields: [
      { name: 'title', label: 'Product name', kind: 'text', required: true, full: true, placeholder: 'e.g. Galvanised steel cable ties, 300 mm' },
      { name: 'details', label: 'Description, specs or a link', kind: 'textarea', required: true, full: true, placeholder: 'Material, size, standard, certifications, reference link' },
      { name: 'quantity', label: 'Quantity', kind: 'int', required: true, placeholder: 'e.g. 20000' },
      { name: 'target_price', label: 'Target price ({currency} per unit)', kind: 'money', placeholder: '0.00' },
      { name: 'destination_country', label: 'Destination country', kind: 'country', required: true },
      { name: 'destination_city', label: 'Destination city / port', kind: 'text', placeholder: 'e.g. Rotterdam' },
      { name: 'incoterm', label: 'Preferred Incoterm', kind: 'select', options: ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'] },
      { name: 'needed_by', label: 'Needed by', kind: 'date' },
    ],
  }],
  dropship: [{
    title: 'Dropship setup',
    fields: [
      { name: 'product', label: 'Products you plan to sell (optional)', kind: 'text', full: true, placeholder: 'Product names or links — you can also pick them later from the dropship catalogue' },
      { name: 'target_markets', label: 'Target markets', kind: 'text', required: true, placeholder: 'e.g. US, Germany, UAE' },
      { name: 'store_platform', label: 'Store platform', kind: 'select', required: true, options: ['Shopify', 'WooCommerce', 'Upload a sheet'] },
      { name: 'monthly_orders', label: 'Expected orders per month', kind: 'int' },
      // ADDON-44-F: branding moved to the Make My Brand request; dropshipping keeps only the packing slip
      { name: 'packing_slip', label: 'Your packing slip', kind: 'select', options: ['Your store name and logo', 'Your store name only', 'No packing slip'], hint: 'Want your logo on the product itself? Start a Make My Brand request.' },
      notes,
    ],
  }],
  sample: [{
    title: 'Sample details',
    fields: [
      { name: 'product', label: 'Product', kind: 'text', required: true, full: true },
      { name: 'quantity', label: 'Number of samples', kind: 'int', required: true, max: 10, hint: 'Usually 1–5 units' },
      { name: 'destination_country', label: 'Ship samples to', kind: 'country', required: true },
      { name: 'destination_city', label: 'City', kind: 'text' },
      notes,
    ],
  }],
  qc: [{
    title: 'Inspection details',
    fields: [
      { name: 'product', label: 'Product', kind: 'text', required: true, full: true },
      { name: 'inspection_type', label: 'Inspection type', kind: 'select', required: true, options: ['Pre-shipment inspection', 'During production', 'Factory audit'] },
      { name: 'order_reference', label: 'Order reference (if any)', kind: 'text', placeholder: 'e.g. ORD-2202' },
      { name: 'inspection_date', label: 'Preferred inspection date', kind: 'date' },
      { name: 'quantity', label: 'Order quantity', kind: 'int' },
      { name: 'factory_location', label: 'Factory location', kind: 'text', placeholder: 'City, country' },
      notes,
    ],
  }],
  // Batch 3 (F-16): factory audit is its own request type (service factory_audit, priced in Admin › Services)
  'factory-audit': [{
    title: 'Factory audit details',
    fields: [
      { name: 'product', label: 'Products made at this factory', kind: 'text', required: true, full: true, placeholder: 'e.g. Silicone kitchen tools' },
      { name: 'audit_type', label: 'Audit type', kind: 'select', required: true, options: ['Factory capability audit', 'Quality system audit', 'Social compliance audit'] },
      { name: 'factory_location', label: 'Factory location', kind: 'text', required: true, placeholder: 'City, province, country' },
      { name: 'audit_date', label: 'Preferred audit date', kind: 'date' },
      notes,
    ],
  }],
  certification: [{
    title: 'Certification needs',
    fields: [
      { name: 'product', label: 'Product', kind: 'text', required: true, full: true },
      { name: 'certifications', label: 'Certificates needed', kind: 'text', required: true, placeholder: 'e.g. CE, FCC, RoHS' },
      { name: 'target_market', label: 'Target market', kind: 'country', required: true },
      notes,
    ],
  }],
};

export const COUNTRY_OPTIONS = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

function fieldSchema(f: Field) {
  const req = (s: z.ZodString) => (f.required ? s.min(1, `${f.label} is required`) : s);
  switch (f.kind) {
    case 'int':
      return req(z.string().trim()).refine((v) => v === '' || (/^\d+$/.test(v) && +v > 0 && (!f.max || +v <= f.max)),
        f.max ? `Enter a whole number from 1 to ${f.max}` : 'Enter a whole number above 0');
    case 'money':
      return req(z.string().trim()).refine((v) => v === '' || /^\d+(\.\d{1,3})?$/.test(v), 'Enter an amount like 0.25');
    case 'date':
      return req(z.string().trim()).refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Enter a valid date');
    case 'country':
      return req(z.string().trim()).refine((v) => v === '' || v in COUNTRY_NAMES, 'Choose a country');
    case 'select':
      return req(z.string().trim()).refine((v) => v === '' || (f.options ?? []).includes(v), 'Choose an option');
    case 'textarea':
      return req(z.string().trim().max(4000, 'Keep it under 4,000 characters'));
    default:
      return req(z.string().trim().max(300, 'Keep it under 300 characters'));
  }
}

export function requestSchema(type: RequestType) {
  const shape: Record<string, z.ZodType<string, string>> = {};
  REQUEST_FIELDS[type].forEach((s) => s.fields.forEach((f) => (shape[f.name] = fieldSchema(f))));
  return z.object(shape);
}
export type RequestValues = Record<string, string>;
