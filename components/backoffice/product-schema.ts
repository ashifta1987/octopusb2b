import { z } from 'zod';
import { SKU_ERRORS, SKU_RE } from '@/lib/sku';

/** Shared product form schema (client form + server action). Prices are entered in the product currency (USD or CNY)
 *  and stored as minor units (cents / fen) with price_tiers.currency + products.currency (SPEC §15.1). */
export const tierSchema = z.object({
  min_qty: z.number().int('Whole number').positive('Must be > 0'),
  price: z.number().nonnegative('Must be ≥ 0'),
});
export const specSchema = z.object({ name: z.string().trim().min(1, 'Name required'), value: z.string().trim().min(1, 'Value required') });

export const productSchema = z.object({
  /** ADDON-33: Product Id / SKU. Optional on create (blank = automatic), fixed after creation (Admin only can change). */
  sku: z.string().trim().transform((v) => v.toUpperCase()).refine((v) => v === '' || (SKU_RE.test(v) && !/\s/.test(v)), SKU_ERRORS.format).optional(),
  title: z.string().trim().min(3, 'At least 3 characters').max(160),
  supplier_id: z.string().uuid('Choose a supplier'),
  category_id: z.string().uuid('Choose a category').nullable(),
  tag_ids: z.array(z.string().uuid()),
  unit: z.string().trim().min(1).max(20),
  moq: z.number().int('Whole number').positive('Must be > 0'),
  lead_time_days: z.number().int().nonnegative().nullable(),
  incoterm: z.string().trim().max(10).nullable(),
  origin_country: z.string().trim().max(2).nullable(),
  hs_code: z.string().trim().max(20).nullable(),
  /** One currency per product: all tiers share it (1688 suppliers usually quote CNY). */
  currency: z.enum(['USD', 'CNY']),
  tiers: z.array(tierSchema).min(1, 'Add at least one price tier'),
  specs: z.array(specSchema),
  certificate_ids: z.array(z.string().uuid()),
  octopus_dropship: z.boolean(),
  ready_to_ship: z.boolean(),
  images: z.array(z.string().url()),
  description: z.string().trim().max(8000).nullable(),
  seo_title: z.string().trim().max(160).nullable(),
  seo_description: z.string().trim().max(320).nullable(),
}).superRefine((v, ctx) => {
  for (let i = 1; i < v.tiers.length; i++) {
    if (v.tiers[i].min_qty <= v.tiers[i - 1].min_qty) {
      ctx.addIssue({ code: 'custom', path: ['tiers', i, 'min_qty'], message: 'Tier quantities must go up' });
    }
  }
});

export type ProductFormValues = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

/** Looser schema for autosaved drafts: only title + supplier are required. */
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  supplier_id: z.string().uuid(),
}).passthrough();

export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
export const UNITS = ['pcs', 'pairs', 'sets', 'units', 'boxes', 'packs', 'rolls', 'kits', 'm', 'kg', 'cartons'];
