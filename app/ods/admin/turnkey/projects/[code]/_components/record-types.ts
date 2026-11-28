/**
 * ODS T9 · Turnkey project record — data shapes (types only). Same shapes as today's page; signed-URL maps are plain objects.
 */
import type { TkClientProject, TkProjectContact, TkProjectEvent } from '@/lib/turnkey/projects';
import type { TkStageRow } from '@/lib/turnkey/format';
import type { TkStaffDrawings, TkStaffQuotes } from '@/lib/turnkey/work';
import type { TkStaffQc } from '@/lib/turnkey/qc';
import type { TkStaffShipping, TkStaffTrips } from '@/lib/turnkey/shipping';

export type StaffFee = {
  id: string; stage: string; service_code: string | null; service_name: string | null; version: number; amount_cents: number; currency: string;
  starting_cents: number | null; needs_approval: boolean; status: string; note: string | null; proposed_by: string; proposed_by_name: string | null;
  proposed_at: string; approved_by: string | null; approved_by_name: string | null; approved_at: string | null; rejected_by_name: string | null;
  rejected_at: string | null; reject_reason: string | null; withdrawn_at: string | null; effective_from: string | null; superseded_at: string | null;
  document_id: string | null; document_number: string | null; document_status: string | null; paid_cents: number | null; paid: boolean;
};
export type StaffRow = { owner_id: string | null; owner_set_at: string | null; created_by: string | null; legacy_lead_id: string | null; is_seed: boolean; cover_id: string | null; cover_from: string | null; cover_to: string | null };
export type LeadRow = { reference: string; kind: string; company_name: string; contact_name: string; email: string; phone: string | null; country: string; status: string; created_at: string };

export type RecordBase = {
  p: TkClientProject;
  stages: TkStageRow[];
  events: TkProjectEvent[];
  managerName: string | null;
  contact: TkProjectContact | null;
  staff: StaffRow | null;
  company: { id: string; name: string; country: string | null } | null;
  cands: { user_id: string; full_name: string }[];
  /** null = the fee list failed to load */
  fees: StaffFee[] | null;
  services: { code: string; name: string; from_cents: number; approx: boolean }[];
  lead: LeadRow | null;
};

export type RecordSources = {
  drw: { data: TkStaffDrawings; urls: Record<string, string> } | null;
  qts: TkStaffQuotes | null;
  qc: TkStaffQc | null;
  ship: TkStaffShipping | null;
  trp: TkStaffTrips | null;
};

export type Viewer = { userId: string; isAdmin: boolean; edit: boolean };
