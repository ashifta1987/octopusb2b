import 'server-only';
import { can, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { nowMs } from '@/components/admin/server';
import type { StaffSecuritySettings } from '@/components/admin/staff-security';
import { COMPANY_WIDE_ROLES } from '@/lib/divisions/shared';
import { AREA_ACTIONS, companyChanges, COMPANY_LABELS, maskAccount, securityEvent, deviceLabel, staffActions, staffStatus, type StaffActionFlags, type StaffSec, type StaffStatusKey } from './admin-c-core';

/**
 * ODS T9 · Admin batch C loaders: exactly the reads today's pages make (same tables / columns / RPCs / admin-only
 * branches), on the staff member's session (RLS). The page runs today's guard first.
 */

const DEFAULT_SECURITY: StaffSecuritySettings = {
  enforce_aal2: true, lockout_attempts: 5, lockout_minutes: 15, idle_minutes: 30, max_session_hours: 12, step_up_minutes: 10, trust_hours: 12,
  ip_allowlist: [], ip_rule_roles: ['admin', 'finance'], ip_rule_enabled: false, google_domain: 'octopusb2b.com',
};

export type StaffMember = {
  id: string; name: string; email: string; office: string | null; roles: string[]; roleNames: string[]; active: boolean; self: boolean;
  status: StaffStatusKey; statusLabel: string; statusTone: 'neutral' | 'danger' | 'info' | 'success'; lockedUntil: string | null; invitedAt: string | null;
  twoFa: boolean | null; lastSignIn: string | null; sessions: number | null; actions: StaffActionFlags; secEmail: string | null;
  divisions: { code: string; name: string; role: string }[]; companyWide: boolean;
};

export type StaffData = {
  team: StaffMember[];
  roles: { code: string; name: string; description: string; members: number }[];
  selectedRole: string | null;
  matrix: { areas: { code: string; name: string }[]; special: { code: string; name: string; actions: string[] }[]; have: string[] };
  divisions: { code: string; name: string; active: boolean }[];
  offices: string[];
  distributors: { id: string; name: string }[];
  suppliers: { id: string; label: string }[] | null;
  assignments: { distributorId: string; distributor: string; supplierId: string; supplier: string }[];
  secError: string | null;
  security: StaffSecuritySettings;
  events: { id: number; at: string; actor: string | null; subject: string | null; entity: string | null; label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral'; ip: string | null; device: string; deviceRaw: string | null }[];
  perms: { canEdit: boolean; canCreate: boolean; isAdmin: boolean; canSuppliersView: boolean; canSuppliersEdit: boolean };
};

export async function loadStaff(s: Session, roleParam: string | undefined): Promise<StaffData> {
  const sb = await createClient();
  const [{ data: roles }, { data: areas }, { data: userRoles }, { data: perms }, { data: assignments }, { data: suppliers }, secRes] = await Promise.all([
    sb.from('roles').select('code, name, description, is_staff, sort').order('sort'),
    sb.from('permission_areas').select('code, name, sort').order('sort'),
    sb.from('user_roles').select('user_id, role_code'),
    sb.from('role_permissions').select('role_code, area, action'),
    sb.from('distributor_suppliers').select('distributor_id, supplier_id'),
    sb.from('suppliers').select('id, code, legal_name, country').is('archived_at', null).order('code'),
    sb.rpc('admin_staff_security'),
  ]);
  const [{ data: divisions }, { data: memberships }] = await Promise.all([
    sb.from('divisions').select('id, code, name, status').order('sort_order'),
    sb.from('division_members').select('user_id, division_id, role'),
  ]);
  const staffRoles = (roles ?? []).filter((r) => r.is_staff);
  const staffCodes = new Set(staffRoles.map((r) => r.code as string));
  const byUser = new Map<string, string[]>();
  (userRoles ?? []).filter((r) => staffCodes.has(r.role_code as string)).forEach((r) => byUser.set(r.user_id as string, [...(byUser.get(r.user_id as string) ?? []), r.role_code as string]));
  const ids = [...byUser.keys()];
  const { data: profiles } = ids.length ? await sb.from('profiles').select('id, full_name, email, active, office, invited_at, created_at').in('id', ids) : { data: [] };
  const secById = new Map(((secRes.data ?? []) as StaffSec[]).map((r) => [r.user_id, r]));
  const now = nowMs();
  const team = (profiles ?? []).sort((a, b) => Number(b.active) - Number(a.active) || String(a.full_name).localeCompare(String(b.full_name)));
  const edit = can(s, 'staff', 'edit');
  const create = can(s, 'staff', 'create');
  const roleName = (code: string) => (staffRoles.find((x) => x.code === code)?.name as string) ?? code;
  const selRole = staffRoles.find((r) => r.code === roleParam) ?? staffRoles.find((r) => r.code !== 'admin') ?? staffRoles[0];
  const have = (perms ?? []).filter((p) => p.role_code === selRole?.code).map((p) => `${p.area}:${p.action}`);
  const supById = new Map((suppliers ?? []).map((x) => [x.id as string, x]));
  const nameById = new Map(team.map((t) => [t.id as string, t.full_name as string]));
  const divById = new Map((divisions ?? []).map((d) => [d.id as string, d]));

  let security = DEFAULT_SECURITY;
  let events: StaffData['events'] = [];
  if (s.isAdmin) {
    const [{ data: setting }, { data: ev }] = await Promise.all([
      sb.from('site_settings').select('value').eq('key', 'staff_security').maybeSingle(),
      sb.from('audit_log').select('id, actor_id, action, entity_id, details, created_at').like('action', 'auth.%').order('created_at', { ascending: false }).limit(50),
    ]);
    security = { ...DEFAULT_SECURITY, ...((setting?.value ?? {}) as Partial<StaffSecuritySettings>) };
    const raw = (ev ?? []) as { id: number; actor_id: string | null; action: string; entity_id: string | null; details: Record<string, unknown> | null; created_at: string }[];
    const eventNames = new Map<string, string>();
    const missing = [...new Set(raw.map((e) => e.actor_id).filter((x): x is string => !!x && !nameById.has(x)))];
    if (missing.length) {
      const { data: more } = await sb.from('profiles').select('id, full_name, email').in('id', missing);
      (more ?? []).forEach((p) => eventNames.set(p.id as string, (p.full_name as string) || (p.email as string) || String(p.id).slice(0, 8)));
    }
    const who = (id: string | null) => (id ? nameById.get(id) ?? eventNames.get(id) ?? id.slice(0, 8) : null);
    events = raw.map((e) => {
      const d = e.details ?? {};
      const ev2 = securityEvent(e.action);
      return {
        id: e.id, at: e.created_at, actor: who(e.actor_id), subject: typeof d.target === 'string' ? who(d.target) : null, entity: !e.actor_id ? e.entity_id : null,
        label: ev2.label, tone: ev2.tone, ip: typeof d.ip === 'string' && d.ip ? d.ip : null, device: deviceLabel(d.device), deviceRaw: typeof d.device === 'string' ? d.device : null,
      };
    });
  }

  return {
    team: team.map((t) => {
      const sec = secById.get(t.id as string);
      const st = staffStatus(!!t.active, sec, now);
      const rolesOf = byUser.get(t.id as string) ?? [];
      const self = t.id === s.userId;
      return {
        id: t.id as string, name: t.full_name as string, email: (t.email as string) ?? sec?.email ?? '', office: (t.office as string | null) ?? null,
        roles: rolesOf, roleNames: rolesOf.map(roleName), active: !!t.active, self,
        status: st.key, statusLabel: st.label, statusTone: st.tone, lockedUntil: sec?.locked_until ?? null, invitedAt: (t.invited_at as string | null) ?? null,
        twoFa: sec ? (sec.totp_factors ?? 0) > 0 : null, lastSignIn: sec?.last_sign_in_at ?? null, sessions: sec ? sec.active_sessions : null, secEmail: sec?.email ?? null,
        actions: staffActions({ canEdit: edit, canCreate: create, isAdmin: s.isAdmin, self, targetIsAdmin: rolesOf.includes('admin'), status: st.key, twoFa: (sec?.totp_factors ?? 0) > 0, sessions: sec?.active_sessions ?? 0, hasSec: !!sec }),
        divisions: (memberships ?? []).filter((m) => m.user_id === t.id).map((m) => { const d = divById.get(m.division_id as string); return { code: (d?.code as string) ?? '', name: (d?.name as string) ?? '—', role: m.role as string }; }),
        companyWide: rolesOf.some((r) => (COMPANY_WIDE_ROLES as readonly string[]).includes(r)),
      };
    }),
    roles: staffRoles.map((r) => ({ code: r.code as string, name: r.name as string, description: (r.description as string) ?? '', members: [...byUser.values()].filter((x) => x.includes(r.code as string)).length })),
    selectedRole: (selRole?.code as string) ?? null,
    matrix: {
      areas: (areas ?? []).filter((a) => !AREA_ACTIONS[a.code as string]).map((a) => ({ code: a.code as string, name: a.name as string })),
      special: (areas ?? []).filter((a) => !!AREA_ACTIONS[a.code as string]).map((a) => ({ code: a.code as string, name: a.name as string, actions: [...AREA_ACTIONS[a.code as string]!] })),
      have,
    },
    divisions: (divisions ?? []).map((d) => ({ code: d.code as string, name: d.name as string, active: d.status === 'active' })),
    offices: [...new Set(team.map((t) => t.office as string | null).filter((o): o is string => !!o))].sort(),
    distributors: team.filter((t) => byUser.get(t.id as string)?.includes('distributor')).map((t) => ({ id: t.id as string, name: t.full_name as string })),
    suppliers: can(s, 'suppliers', 'view') ? (suppliers ?? []).map((x) => ({ id: x.id as string, label: `${x.code} · ${x.legal_name}` })) : null,
    assignments: can(s, 'suppliers', 'view') ? (assignments ?? []).map((a) => {
      const sup = supById.get(a.supplier_id as string);
      return { distributorId: a.distributor_id as string, distributor: nameById.get(a.distributor_id as string) ?? String(a.distributor_id).slice(0, 8), supplierId: a.supplier_id as string, supplier: sup ? `${sup.code} · ${sup.legal_name}` : '—' };
    }) : [],
    secError: secRes.error ? secRes.error.message : null,
    security,
    events,
    perms: { canEdit: edit, canCreate: create, isAdmin: s.isAdmin, canSuppliersView: can(s, 'suppliers', 'view'), canSuppliersEdit: can(s, 'suppliers', 'edit') },
  };
}

/* ───────── divisions ───────── */

export type DivisionCard = { code: string; name: string; sortOrder: number; logoKey: string | null; active: boolean; people: number };

export async function loadDivisions(): Promise<DivisionCard[]> {
  const sb = await createClient();
  const [{ data: divs }, { data: members }] = await Promise.all([
    sb.from('divisions').select('id, code, name, sort_order, logo_key, status, updated_at').order('sort_order').order('name'),
    sb.from('division_members').select('division_id, role'),
  ]);
  return (divs ?? []).map((d) => ({
    code: d.code as string, name: d.name as string, sortOrder: Number(d.sort_order), logoKey: (d.logo_key as string | null) ?? null, active: d.status === 'active',
    people: (members ?? []).filter((m) => m.division_id === d.id).length,
  }));
}

/* ───────── company ───────── */

export type CompanyData = {
  values: Record<string, string>; updatedAt: string | null; brand: string;
  banks: { id: string; currency: string; bank: string; holder: string; account: string; swift: string | null; active: boolean }[];
  divisions: { code: string; name: string; active: boolean }[];
  rule: 'on_full_payment' | 'per_payment';
  history: { id: number; at: string; who: string; what: string }[];
};

export async function loadCompany(): Promise<CompanyData> {
  const sb = await createClient();
  const [{ data: c }, { data: banks }, { data: hist }, { data: divs }, { data: ruleRow }] = await Promise.all([
    sb.from('company_profile').select('legal_name, legal_name_cn, registration_no, tax_id, address, address_cn, registered_in, brand, updated_at').eq('id', 1).maybeSingle(),
    sb.from('company_bank_accounts').select('id, currency, bank_name, account_holder, account_number, swift, active').order('currency'),
    sb.from('audit_log').select('id, actor_id, details, created_at').eq('entity', 'company_profile').order('created_at', { ascending: false }).limit(10),
    sb.from('divisions').select('code, name, status').order('sort_order'),
    sb.from('site_settings').select('value').eq('key', 'invoicing.service_proforma_rule').maybeSingle(),
  ]);
  const actorIds = [...new Set((hist ?? []).map((h) => h.actor_id as string | null).filter((x): x is string => !!x))];
  const { data: actors } = actorIds.length ? await sb.from('profiles').select('id, full_name, email').in('id', actorIds) : { data: [] };
  const who = (id: string | null) => (id ? (actors ?? []).find((a) => a.id === id)?.full_name || (actors ?? []).find((a) => a.id === id)?.email || 'Staff' : 'System');
  const row = (c ?? {}) as Record<string, string | null>;
  return {
    values: Object.fromEntries(Object.keys(COMPANY_LABELS).map((k) => [k, row[k] ?? ''])),
    updatedAt: (c?.updated_at as string | null) ?? null, brand: (c?.brand as string) ?? 'Octopus B2B',
    banks: (banks ?? []).map((b) => ({ id: b.id as string, currency: b.currency as string, bank: b.bank_name as string, holder: (b.account_holder as string) ?? '—', account: maskAccount(b.account_number as string | null), swift: (b.swift as string | null) ?? null, active: !!b.active })),
    divisions: (divs ?? []).map((d) => ({ code: d.code as string, name: d.name as string, active: d.status === 'active' })),
    rule: ruleRow?.value === 'per_payment' ? 'per_payment' : 'on_full_payment',
    history: (hist ?? []).map((h) => ({ id: Number(h.id), at: h.created_at as string, who: who(h.actor_id as string | null), what: companyChanges(h.details).map((k) => COMPANY_LABELS[k]).join(', ') })),
  };
}
