import { z } from 'zod';

/** Turnkey quote / interest form (ADDON-31 §4) — shared by the client form and the server action. */
export const FLOOR_PLAN_EXT = /\.(pdf|dwg|jpe?g|png)$/i;
export const FLOOR_PLAN_MAX_BYTES = 20 * 1024 * 1024;

export const leadSchema = z.object({
  kind: z.enum(['quote', 'interest']),
  project_id: z.string().regex(/^[a-z0-9-]{2,60}$/),
  package_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Choose a package').optional().or(z.literal('')),
  company_name: z.string().trim().min(2, 'Company name is required').max(160),
  contact_name: z.string().trim().min(2, 'Contact name is required').max(120),
  email: z.string().trim().email('Enter a valid email address').max(200),
  phone: z.string().trim().max(40).regex(/^[+\d\s().-]*$/, 'Use digits, spaces and + only').optional().or(z.literal('')),
  country: z.string().regex(/^[A-Z]{2}$/, 'Select your country'),
  delivery_term: z.enum(['FOB', 'CIF', 'DAP']).optional().or(z.literal('')),
  delivery_place: z.string().trim().max(120).optional().or(z.literal('')),
  target_open_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').optional().or(z.literal('')),
  floor_plan_path: z.string().max(300).optional().or(z.literal('')),
  message: z.string().trim().max(4000).optional().or(z.literal('')),
}).superRefine((v, ctx) => {
  if ((v.delivery_term === 'CIF' || v.delivery_term === 'DAP') && !v.delivery_place?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['delivery_place'], message: v.delivery_term === 'CIF' ? 'Which port?' : 'Which city?' });
  }
  if (v.target_open_date) {
    const d = new Date(v.target_open_date + 'T00:00:00Z');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (Number.isNaN(d.getTime()) || d < today) ctx.addIssue({ code: 'custom', path: ['target_open_date'], message: 'Pick a date in the future' });
  }
});
export type LeadValues = z.input<typeof leadSchema>;

