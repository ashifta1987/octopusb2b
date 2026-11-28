import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '@/app/ods/account/_services/ui';
import type { SettingsTab } from '@/app/ods/account/_services/logic';
import { SettingsView, type KycData, type SettingsData } from '@/app/ods/account/settings/_components/settings-view';
import { ServicesFixtureFrame, fixtureState } from '../account-turnkey/_frame';

export const metadata: Metadata = { title: 'My account · Team and settings · ODS fixtures (staging)', robots: { index: false, follow: false } };

/* SAMPLE company (C_Team board example) — staging only. */
const INITIAL = { company: 'Anna Home Trading LLC', regNo: 'CN-1234567', businessType: 'E-commerce seller', website: 'https://example.com', country: 'AE', region: 'Dubai', city: 'Dubai', postal: '00000', line1: 'Office 12, Example Tower', line2: '', contactName: 'Anna K.', contactEmail: 'anna@example.com', contactPhone: '+971 50 000 0000' };
const kyc = (status: string, over: Partial<KycData> = {}): KycData => ({
  status, orgId: 'sample-org', initial: INITIAL, docs: [], latest: null, subs: [],
  mode: status === 'verified' || status === 'in_review' || status === 'submitted' ? 'locked' : 'edit', ...over,
});
const SUB = (status: string, message: string | null = null) => ({ id: `sub-${status}`, status, company_name: 'Anna Home Trading LLC', customer_message: message, submitted_at: '2026-11-20T09:00:00Z', reviewed_at: status === 'submitted' ? null : '2026-11-22T09:00:00Z', created_at: '2026-11-20T09:00:00Z', message });

const base = (kycData: KycData, kycStatus: string): SettingsData => ({
  company: { kind: 'ready', data: { name: 'Anna Home Trading LLC', country: 'AE', city: 'Dubai', business_type: 'E-commerce seller', registration_no: 'CN-1234567', website: 'https://example.com', kyc_status: kycStatus, created_at: '2026-03-02T09:00:00Z' } },
  team: { kind: 'ready', data: {
    members: [
      { userId: 'u1', name: 'Anna K.', email: 'anna@example.com', role: 'owner', isMe: true, joined: '2026-03-02T09:00:00Z' },
      { userId: 'u2', name: null, email: null, role: 'buyer', isMe: false, joined: '2026-05-10T09:00:00Z' },
    ],
    dropship: { on: false, invites: [], canInvite: false },
  } },
  addresses: { kind: 'ready', data: [{ id: 'ad1', label: 'Dubai warehouse', line1: 'Unit 4, Example Logistics Park', line2: null, city: 'Dubai', region: null, postal_code: null, country: 'AE', is_default: true }] },
  kyc: { kind: 'ready', data: kycData },
  email: 'anna@example.com', dropshipOn: false,
});

const STATES = [
  { id: 'company', label: 'Company' }, { id: 'team', label: 'Team' }, { id: 'team-dropship', label: 'Team with Dropshipping invites' }, { id: 'addresses', label: 'Addresses' },
  { id: 'notifications', label: 'Notifications' }, { id: 'security', label: 'Security' },
  { id: 'kyc-not-started', label: 'KYC: not verified' }, { id: 'kyc-pending', label: 'KYC: pending' }, { id: 'kyc-docs', label: 'KYC: document missing' },
  { id: 'kyc-more-info', label: 'KYC: more info' }, { id: 'kyc-rejected', label: 'KYC: not approved' }, { id: 'kyc-verified', label: 'KYC: verified' },
  { id: 'error', label: 'Panels failed' }, { id: 'loading', label: 'Loading' },
];

export default function SettingsFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  let data: SettingsData = base(kyc('verified', { subs: [SUB('verified')], latest: SUB('verified') }), 'verified');
  let tab: SettingsTab = 'company';
  if (state === 'team' || state === 'team-dropship') tab = 'team';
  if (state === 'addresses' || state === 'notifications' || state === 'security') tab = state;
  if (state === 'team-dropship') data = { ...data, dropshipOn: true, team: { kind: 'ready', data: { members: [{ userId: 'u1', name: 'Anna K.', email: 'anna@example.com', role: 'owner', isMe: true, joined: '2026-03-02T09:00:00Z', dsRole: 'owner' }, { userId: 'u3', name: 'Priya R.', email: 'priya@example.com', role: 'buyer', isMe: false, joined: '2026-06-01T09:00:00Z', dsRole: 'support' }], dropship: { on: true, canInvite: true, invites: [{ id: 'i1', email: 'omar@example.com', role: 'manager', expires_at: '2026-12-04T09:00:00Z' }] } } } };
  if (state.startsWith('kyc-')) {
    tab = 'verification';
    const st = { 'kyc-not-started': 'not_started', 'kyc-pending': 'submitted', 'kyc-docs': 'submitted', 'kyc-more-info': 'more_info', 'kyc-rejected': 'rejected', 'kyc-verified': 'verified' }[state]!;
    const sub = st === 'not_started' ? null : SUB(st, st === 'more_info' ? 'Please upload the tax registration certificate.' : st === 'rejected' ? 'The registration number does not match the certificate.' : null);
    const docs = st === 'submitted' && state === 'kyc-docs' ? [{ doc_type: 'business_registration', file_name: 'trade-licence.pdf', storage_path: 'x', created_at: '2026-11-20T09:00:00Z' }] : sub ? [{ doc_type: 'business_registration', file_name: 'trade-licence.pdf', storage_path: 'x', created_at: '2026-11-20T09:00:00Z' }, { doc_type: 'tax_registration', file_name: 'trn.pdf', storage_path: 'y', created_at: '2026-11-20T09:00:00Z' }] : [];
    data = base(kyc(st, { latest: sub, subs: sub ? [sub] : [], docs, ...(state === 'kyc-docs' ? { mode: 'docs' as const } : {}) }), st);
  }
  if (state === 'error') data = { ...data, company: { kind: 'error' }, team: { kind: 'error' }, addresses: { kind: 'error' }, kyc: { kind: 'error' } };
  if (state === 'loading') data = { ...data, company: { kind: 'loading' }, team: { kind: 'loading' }, addresses: { kind: 'loading' }, kyc: { kind: 'loading' } };
  return (
    <ServicesFixtureFrame path="/account/settings" states={STATES} current={state}>
      <PageWrap><SettingsView key={state} data={data} tab={tab} tabParam={null} /></PageWrap>
    </ServicesFixtureFrame>
  );
}
