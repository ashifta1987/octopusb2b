'use server';

import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';

export type ApplyInput = {
  company: string; contactName: string; email: string; phone: string; country: string; sells: string; ordersBand: string;
  channels: string[]; stockRoute: string; hasBatteries: boolean; hasLiquids: boolean; preferredWarehouse: string; website?: string;
};

/** Warehouse OS board 27 — Apply. The database validates again and limits repeats. `website` is a hidden honeypot. */
export async function submitApplicationAction(input: ApplyInput): Promise<{ ok: boolean; code?: string; sds?: boolean; error?: string }> {
  if (input.website) return { ok: true, code: 'APP-0000' };
  const need: [string, string][] = [['company', 'Company'], ['contactName', 'Your name'], ['email', 'Work email'], ['sells', 'What you sell'], ['ordersBand', 'Orders a month'], ['stockRoute', 'How stock reaches us']];
  const missing = need.filter(([k]) => !String((input as Record<string, unknown>)[k] ?? '').trim()).map(([, l]) => l);
  if (missing.length) return { ok: false, error: `Fill in: ${missing.join(', ')}.` };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_submit_application', {
    p_company: input.company, p_contact_name: input.contactName, p_email: input.email, p_phone: input.phone || null,
    p_country: input.country || null, p_sells: input.sells, p_orders_band: input.ordersBand, p_channels: input.channels,
    p_stock_route: input.stockRoute, p_has_batteries: input.hasBatteries, p_has_liquids: input.hasLiquids,
    p_preferred_warehouse: input.preferredWarehouse || null,
  });
  if (error) return { ok: false, error: error.message.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase()) };
  const d = data as { code: string; safety_data_sheet: boolean };
  // CH-1 single sign-in (G1): a signed-in customer's application belongs to their company straight away
  const s = await getSession();
  if (s?.org && !s.isStaff) await sb.rpc('wh_link_my_application', { p_code: d.code });
  return { ok: true, code: d.code, sds: d.safety_data_sheet };
}
