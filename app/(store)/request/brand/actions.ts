'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { sendBrandProjectAdminEmail } from '@/lib/brand-projects-email';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type BrandPayload = {
  product_id?: string | null; product_link?: string; quantity?: string; markets: string[];
  method: string; packaging: string; colours?: string; logo_paths: string[];
  stock_destination: 'warehouse' | 'bulk'; bulk_country?: string; stores: string[]; note?: string;
};

const ERRORS: Record<string, string> = {
  NOT_A_CUSTOMER: 'Sign in with your company account to send a brand request.',
  PRODUCT_NOT_VERIFIED: 'Only products from verified suppliers can be branded. Choose another product.',
  PRODUCT_REQUIRED: 'Choose a product or paste a product link.',
  BAD_LOGO_PATH: 'The logo upload did not finish. Upload your logo again.',
  BULK_COUNTRY_REQUIRED: 'Choose the country for the bulk shipment.',
};

/** ADDON-44-F board 26 — creates the brand project (MB-xxxx) and notifies the account manager (create_brand_project). */
export async function createBrandProject(p: BrandPayload): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.org) return { ok: false, error: ERRORS.NOT_A_CUSTOMER };
  const sb = await createClient();
  const { data, error } = await sb.rpc('create_brand_project', { p });
  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: code ? ERRORS[code] : `Could not send the request: ${error.message}` };
  }
  revalidatePath('/account/brand');
  // bug 2 (8 Nov 2026): one e-mail to the admin address in settings, after the response (sent at most once per project)
  const created = data as { id: string; ref: string };
  after(() => sendBrandProjectAdminEmail(created.id));
  return { ok: true, ref: created.ref };
}

