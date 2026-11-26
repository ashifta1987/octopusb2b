'use server';

import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usdToCents } from '@/lib/turnkey/format';

export type EnquiryInput = {
  catalogueProject: string; title: string; country: string; city: string; targetOpenOn: string; floorArea: string; budgetUsd: string; plan: string;
  website?: string; // hidden honeypot
};

const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());

/**
 * Turnkey T2 — client enquiry (design: Enquiry is free; NewProject / ClientIntake collect the plan). Creates a project at
 * "Enquiry" for the signed-in customer's company. The database checks everything again and applies the abuse limits.
 */
export async function submitEnquiryAction(input: EnquiryInput): Promise<{ ok: boolean; code?: string; error?: string }> {
  const s = await requireCustomer('/account/turnkey/new');
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };
  if (input.website) return { ok: false, error: 'Something went wrong. Please try again.' };
  const plan = input.plan.trim();
  if (!input.catalogueProject && !input.title.trim()) return { ok: false, error: 'Choose a project or tell us what you want to open.' };
  if (plan.length < 20) return { ok: false, error: 'Tell us about your plan (at least 20 characters).' };
  const budget = usdToCents(input.budgetUsd);
  if (Number.isNaN(budget)) return { ok: false, error: 'Budget: enter an amount in US dollars, for example 35000.' };
  const areaText = input.floorArea.trim().replace(',', '.');
  const area = areaText ? Number(areaText) : null;
  if (area != null && (!Number.isFinite(area) || area <= 0)) return { ok: false, error: 'Space: enter the floor area in m², for example 120.' };
  if (input.targetOpenOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetOpenOn)) return { ok: false, error: 'Choose an opening date.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_submit_enquiry', {
    p_org: s.org.id, p_catalogue_project: input.catalogueProject || null, p_title: input.title.trim() || null,
    p_country: input.country || null, p_city: input.city.trim() || null, p_target_open_on: input.targetOpenOn || null,
    p_floor_area_m2: area, p_budget_cents: budget, p_plan: plan,
  });
  if (error) return { ok: false, error: clean(error.message) };
  return { ok: true, code: (data as { code: string }).code };
}
