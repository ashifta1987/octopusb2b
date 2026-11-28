import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageHead, PageWrap } from '../_services/ui';
import type { Session } from '@/lib/auth';
import { requireAccount } from '../_lib/loaders';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES } from '@/lib/format';
import { customerMessageFor } from '@/lib/kyc-message';
import { getSettingsPage } from '@/lib/dropship-ds12';
import { KYC_DOCS } from '@/components/account/kyc-docs';
import { Skeleton } from '@octopus/ui';
import { SETTINGS_TABS, kycMode, pickTab } from '../_services/logic';
import { SettingsView, type AddressRow, type CompanyData, type KycData, type KycSubmission, type Panel, type SettingsData, type TeamData } from './_components/settings-view';
import type { KycDoc } from './_components/kyc-panel-form';

export const metadata: Metadata = { title: 'Team and settings' };

/**
 * ODS /account/settings (Part 6.7, C_Team; `/account/kyc` 308s here with ?tab=verification for ODS visitors). Reads, all RLS:
 * organizations (own), org_members (own company), addresses (own company), kyc_submissions + kyc_documents (same columns as
 * today's app/account/kyc — customer_message only, never the internal note), and when Dropshipping is on, today's
 * ds_settings_page RPC (team names, emails, Dropship roles, open invites). Actions: today's submitKyc (+ kyc bucket upload).
 */
export default function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <PageWrap>
      <Suspense fallback={<div className="flex flex-col gap-6"><PageHead title="Team and settings" /><Skeleton lines={2} label="Loading settings" /><Skeleton lines={8} silent /></div>}>
      <Settings searchParams={searchParams} />
      </Suspense>
    </PageWrap>
  );
}

type Sb = Awaited<ReturnType<typeof createClient>>;

async function loadCompany(sb: Sb, orgId: string): Promise<Panel<CompanyData>> {
  const { data, error } = await sb.from('organizations').select('name, country, city, business_type, registration_no, website, kyc_status, created_at').eq('id', orgId).maybeSingle();
  if (error || !data) return { kind: 'error' };
  return { kind: 'ready', data: data as CompanyData };
}

async function loadTeam(sb: Sb, s: Session, dropshipOn: boolean): Promise<Panel<TeamData>> {
  const { data, error } = await sb.from('org_members').select('user_id, member_role, created_at').eq('org_id', s.org!.id).order('created_at');
  if (error) return { kind: 'error' };
  let ds: Awaited<ReturnType<typeof getSettingsPage>> | null = null;
  if (dropshipOn) { try { ds = await getSettingsPage(); } catch { ds = null; } }
  const dsTeam = new Map((ds?.team ?? []).map((m) => [m.user_id, m]));
  const members = ((data ?? []) as { user_id: string; member_role: string; created_at: string }[]).map((m) => {
    const d = dsTeam.get(m.user_id);
    const isMe = m.user_id === s.userId;
    return { userId: m.user_id, name: d?.name ?? (isMe ? s.profile?.full_name ?? null : null), email: d?.email ?? (isMe ? s.email : null), role: m.member_role, isMe, joined: m.created_at, dsRole: d?.ds_role ?? null };
  });
  return { kind: 'ready', data: { members, dropship: { on: dropshipOn && !!ds, invites: (ds?.invites ?? []).map((i) => ({ id: i.id, email: i.email, role: i.ds_role, expires_at: i.expires_at })), canInvite: ds?.my_role === 'owner' } } };
}

async function loadAddresses(sb: Sb, orgId: string): Promise<Panel<AddressRow[]>> {
  const { data, error } = await sb.from('addresses').select('id, label, line1, line2, city, region, postal_code, country, is_default').eq('org_id', orgId).order('is_default', { ascending: false }).order('created_at');
  if (error) return { kind: 'error' };
  return { kind: 'ready', data: (data ?? []) as AddressRow[] };
}

const NAME_TO_CODE = Object.fromEntries(Object.entries(COUNTRY_NAMES).map(([c, n]) => [n.toLowerCase(), c]));
/** Best-effort parse of the address lines today's submitKyc writes (line1 / line2 / "city, region, postal" / country). */
function parseAddress(a: string | null) {
  const out = { line1: '', line2: '', city: '', region: '', postal: '', country: '' };
  if (!a) return out;
  const lines = a.split('\n');
  if (lines.length === 4) {
    out.line1 = lines[0]; out.line2 = lines[1];
    const parts = lines[2].split(', ');
    if (parts.length === 3) { out.city = parts[0]; out.region = parts[1]; out.postal = parts[2]; }
    out.country = NAME_TO_CODE[lines[3].trim().toLowerCase()] ?? '';
  } else out.line1 = a.replace(/\n/g, ', ');
  return out;
}

type SubRow = Omit<KycSubmission, 'message'> & { registration_no: string | null; address: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null };
async function loadKyc(sb: Sb, s: Session): Promise<Panel<KycData>> {
  const orgId = s.org!.id;
  const [{ data: org, error: orgErr }, { data: subsRaw, error }] = await Promise.all([
    sb.from('organizations').select('name, country, city, business_type, registration_no, website, kyc_status').eq('id', orgId).maybeSingle(),
    sb.from('kyc_submissions').select('id, status, company_name, registration_no, address, contact_name, contact_phone, contact_email, customer_message, submitted_at, reviewed_at, created_at').eq('org_id', orgId).order('created_at', { ascending: false }),
  ]);
  if (error || orgErr) return { kind: 'error' };
  const subs = (subsRaw ?? []) as SubRow[];
  const latest = subs[0] ?? null;
  const { data: docsRaw } = latest ? await sb.from('kyc_documents').select('doc_type, file_name, storage_path, created_at').eq('submission_id', latest.id).order('created_at', { ascending: false }) : { data: [] };
  const docs = (docsRaw ?? []) as KycDoc[];
  const status = (org?.kyc_status as string | undefined) ?? s.org!.kyc_status;
  const have = new Set(docs.map((d) => d.doc_type));
  const missing = KYC_DOCS.filter((d) => d.required && !have.has(d.type)).length;
  const addr = parseAddress(latest?.address ?? null);
  const o = (org ?? {}) as Record<string, string | null>;
  const initial = {
    company: latest?.company_name ?? o.name ?? s.org!.name ?? '', regNo: latest?.registration_no ?? o.registration_no ?? '', businessType: o.business_type ?? '', website: o.website ?? '',
    country: addr.country || o.country || '', region: addr.region, city: addr.city || o.city || '', postal: addr.postal, line1: addr.line1, line2: addr.line2,
    contactName: latest?.contact_name ?? s.profile?.full_name ?? '', contactEmail: latest?.contact_email ?? s.email ?? '', contactPhone: latest?.contact_phone ?? s.profile?.phone ?? '',
  };
  if (initial.country && !COUNTRY_NAMES[initial.country]) initial.country = '';
  const toSub = (x: SubRow): KycSubmission => ({ id: x.id, status: x.status, company_name: x.company_name, customer_message: x.customer_message, submitted_at: x.submitted_at, reviewed_at: x.reviewed_at, created_at: x.created_at, message: customerMessageFor(x) });
  return { kind: 'ready', data: { status, orgId, mode: kycMode(status, !!latest, missing), initial, docs, latest: latest ? toSub(latest) : null, subs: subs.map(toSub) } };
}

async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireAccount('/account/settings');
  const [sb, sp, ctx] = await Promise.all([createClient(), searchParams, getAccountContext(s.org!.id)]);
  const dropshipOn = serviceOn(ctx.services.dropship);
  const [company, team, addresses, kyc] = await Promise.all([loadCompany(sb, s.org!.id), loadTeam(sb, s, dropshipOn), loadAddresses(sb, s.org!.id), loadKyc(sb, s)]);
  const data: SettingsData = { company, team, addresses, kyc, email: s.email, dropshipOn };
  return <SettingsView data={data} tab={pickTab(sp.tab, SETTINGS_TABS)} />;
}
