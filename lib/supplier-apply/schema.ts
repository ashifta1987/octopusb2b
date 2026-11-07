import { z } from 'zod';

/** ADDON-36 C5 — "Sell on Octopus B2B" application (/suppliers). Shared by the client form and the server action. */
export const SHEET_EXT = /\.(pdf|xlsx?|csv|jpe?g|png)$/i;
export const SHEET_MAX_BYTES = 20 * 1024 * 1024;

const opt = (s: z.ZodString) => s.optional().or(z.literal(''));
const url = opt(z.string().trim().max(300).regex(/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i, 'Enter a web address, e.g. shop1688.1688.com'));

export const supplierApplySchema = z.object({
  company_name: z.string().trim().min(2, 'Company name is required').max(200),
  uscc: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{18}$/, 'The USCC has 18 letters and digits')),
  city: z.string().trim().min(2, 'City is required').max(120),
  province: opt(z.string().trim().max(120)),
  categories: z.array(z.string().trim().min(1).max(80)).min(1, 'Choose at least one category').max(10),
  contact_name: z.string().trim().min(2, 'Contact name is required').max(120),
  contact_email: z.string().trim().email('Enter a valid email address').max(200),
  contact_phone: opt(z.string().trim().max(40).regex(/^[+\d\s().-]*$/, 'Use digits, spaces and + only')),
  wechat: opt(z.string().trim().max(60)),
  website: url,
  store_url: url,
  product_sheet_path: opt(z.string().max(300)),
  notes: opt(z.string().trim().max(4000)),
});
export type SupplierApplyValues = z.input<typeof supplierApplySchema>;

