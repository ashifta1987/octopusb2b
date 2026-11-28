import 'server-only';
/**
 * ODS T9 · Turnkey project record — TODAY's data, unchanged (app/admin/turnkey/projects/[code]/page.tsx): getTkClientProject
 * (RLS decides visibility), tk_client_project_staff, organizations, tk_manager_candidates, tk_list_project_fees, tk_services,
 * turnkey_leads (old lead), getTkStaffDrawings / Quotes / Inspections / Shipping / Trips. Each staff RPC already returns null on
 * failure; here that becomes a per-panel error instead of today's silent "none yet". Read-only.
 */
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getTkClientProject } from '@/lib/turnkey/projects';
import { getTkStaffDrawings, getTkStaffQuotes } from '@/lib/turnkey/work';
import { getTkStaffInspections } from '@/lib/turnkey/qc';
import { getTkStaffShipping, getTkStaffTrips } from '@/lib/turnkey/shipping';
import type { RecordBase, RecordSources, StaffFee, StaffRow, LeadRow } from '../_components/record-types';

export const loadRecordBase = cache(async (code: string): Promise<RecordBase | null> => {
  const d = await getTkClientProject(code);
  if (!d) return null;
  const { project: p, stages, events, managerName, contact } = d;
  const sb = await createClient();
  const [{ data: staffRow }, { data: org }, { data: cands }, { data: feeRows, error: feeError }, { data: svcRows }] = await Promise.all([
    sb.from('tk_client_project_staff').select('owner_id, owner_set_at, created_by, legacy_lead_id, is_seed, cover_id, cover_from, cover_to').eq('project_id', p.id).maybeSingle(),
    p.org_id ? sb.from('organizations').select('id, name, country').eq('id', p.org_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc('tk_manager_candidates'),
    sb.rpc('tk_list_project_fees', { p_project: p.id }),
    sb.from('tk_services').select('code, name, from_cents, approx').eq('active', true).order('sort'),
  ]);
  const staff = staffRow as StaffRow | null;
  const { data: leadRow } = staff?.legacy_lead_id
    ? await sb.from('turnkey_leads').select('reference, kind, company_name, contact_name, email, phone, country, status, created_at').eq('lead_id', staff.legacy_lead_id).maybeSingle()
    : { data: null };
  return {
    p, stages, events, managerName, contact, staff,
    company: org as { id: string; name: string; country: string | null } | null,
    cands: (cands ?? []) as { user_id: string; full_name: string }[],
    fees: feeError ? null : ((feeRows ?? []) as StaffFee[]).map((f) => ({ ...f, amount_cents: Number(f.amount_cents), starting_cents: f.starting_cents == null ? null : Number(f.starting_cents), paid_cents: f.paid_cents == null ? null : Number(f.paid_cents) })),
    services: ((svcRows ?? []) as { code: string; name: string; from_cents: number; approx: boolean }[]).map((x) => ({ ...x, from_cents: Number(x.from_cents) })),
    lead: leadRow as LeadRow | null,
  };
});

/** The five staff RPCs, in parallel, once per request. Signed URL maps become plain objects (props-friendly). */
export const loadRecordSources = cache(async (projectId: string): Promise<RecordSources> => {
  const [drw, qts, qc, ship, trp] = await Promise.all([getTkStaffDrawings(projectId), getTkStaffQuotes(projectId), getTkStaffInspections(projectId), getTkStaffShipping(projectId), getTkStaffTrips(projectId)]);
  return { drw: drw ? { data: drw.data, urls: Object.fromEntries(drw.urls) } : null, qts, qc, ship, trp };
});
