import type { ReactNode } from 'react';
import { Bell, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, Stepper, Timeline, formatDate } from '@octopus/ui';
import { COUNTRY_NAMES } from '@/lib/format';
import { Facts, Notice, PageHead, TextLink } from '../../_services/ui';
import { KYC_STEPS, SETTINGS_TABS, SETTINGS_TAB_LABEL, kycView, memberRole, type SettingsTab } from '../../_services/logic';
import { KycPanelForm, type KycDoc, type KycValues } from './kyc-panel-form';
import { VerticalTabs } from './vertical-tabs';

export type Panel<T> = { kind: 'ready'; data: T } | { kind: 'loading' } | { kind: 'error' };

export type CompanyData = { name: string; country: string | null; city: string | null; business_type: string | null; registration_no: string | null; website: string | null; kyc_status: string; created_at: string | null };
export type TeamData = {
  members: { userId: string; name: string | null; email: string | null; role: string; isMe: boolean; joined: string | null; dsRole?: string | null }[];
  dropship: { on: boolean; invites: { id: string; email: string; role: string; expires_at: string }[]; canInvite: boolean };
};
export type AddressRow = { id: string; label: string | null; line1: string; line2: string | null; city: string | null; region: string | null; postal_code: string | null; country: string; is_default: boolean };
export type KycSubmission = { id: string; status: string; company_name: string | null; customer_message: string | null; submitted_at: string | null; reviewed_at: string | null; created_at: string; message: string | null };
export type KycData = { status: string; orgId: string; mode: 'edit' | 'docs' | 'locked'; initial: KycValues; docs: KycDoc[]; latest: KycSubmission | null; subs: KycSubmission[] };
export type SettingsData = {
  company: Panel<CompanyData>; team: Panel<TeamData>; addresses: Panel<AddressRow[]>; kyc: Panel<KycData>;
  email: string | null; dropshipOn: boolean;
};

const loading = (what: string) => <Skeleton lines={5} label={`Loading ${what}`} />;
const failed = (what: string) => <ErrorState headingLevel={2} title={`${what} could not be loaded`} description="Reload the page. The other sections still work." action={<Button variant="secondary" href="/account/settings">Reload</Button>} />;
const country = (c: string | null) => (c ? COUNTRY_NAMES[c] ?? c : null);

function Section({ title, description, actions, children, testId }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return <Card as="section" title={title} headingLevel={2} description={description} actions={actions} data-testid={testId}>{children}</Card>;
}

export function CompanyPanel({ state }: { state: Panel<CompanyData> }) {
  if (state.kind === 'loading') return loading('company details');
  if (state.kind === 'error') return failed('Company details');
  const c = state.data;
  const k = kycView(c.kyc_status);
  return (
    <Section title="Company" description="Legal name and registration change through Verification before you are verified, and through support after.">
      <div className="flex flex-col gap-4">
        <Facts items={[
          ['Legal name', <span key="n" className="flex flex-wrap items-center gap-2">{c.name}<StatusPill tone={k.tone}>{k.name}</StatusPill></span>],
          ['Country', country(c.country) ?? 'Not given'], ['City', c.city ?? 'Not given'], ['Business type', c.business_type ?? 'Not given'],
          ['Registration no.', c.registration_no ?? 'Not given'], ['Website', c.website ? <a key="w" href={c.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-ods-blue underline">{c.website}</a> : 'Not given'],
          ...(c.created_at ? [['Customer since', formatDate(c.created_at)] as [string, string]] : []),
        ]} />
        <div className="flex flex-wrap gap-2">
          {c.kyc_status === 'verified' ? <Button variant="secondary" href="/account/support?subject=Change%20of%20company%20details">Ask to change details</Button> : <Button variant="secondary" href="/account/settings?tab=verification">Edit in Verification</Button>}
        </div>
      </div>
    </Section>
  );
}

export function TeamPanel({ state }: { state: Panel<TeamData> }) {
  if (state.kind === 'loading') return loading('your team');
  if (state.kind === 'error') return failed('Your team');
  const t = state.data;
  return (
    <div className="flex flex-col gap-6">
      <Section title="Team" description="Everyone with a login to your company account. One login per person.">
        {t.members.length === 0 ? <EmptyState icon={Users} headingLevel={3} title="Only you so far" /> : (
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0" data-testid="team-list">
            {t.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="flex min-w-0 flex-col"><span className="font-semibold">{m.isMe ? `${m.name ?? 'You'} (you)` : m.name ?? 'Team member'}</span>{m.email ? <span className="break-all text-ods-small text-ods-slate">{m.email}</span> : null}{m.joined ? <span className="text-ods-small text-ods-slate">Since {formatDate(m.joined)}</span> : null}</span>
                <span className="flex flex-wrap gap-2"><StatusPill tone="info">{memberRole(m.role)}</StatusPill>{m.dsRole ? <StatusPill tone="neutral">{`Dropshipping: ${memberRole(m.dsRole)}`}</StatusPill> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Invite someone" description="Team invites by email with a role per service.">
        {t.dropship.on ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-ods-body">Today you can invite people to Dropshipping (roles Manager or Support). Invites for the other services come with the team update; until then, ask support to add a colleague.</p>
            {t.dropship.invites.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Open invites">
                {t.dropship.invites.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2 text-ods-body"><span className="break-all">{i.email}</span><StatusPill tone="warning">Invited</StatusPill><span className="text-ods-small text-ods-slate">{memberRole(i.role)} · until {formatDate(i.expires_at)}</span></li>)}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button href="/account/dropship/settings" variant={t.dropship.canInvite ? 'primary' : 'secondary'}>{t.dropship.canInvite ? 'Invite to Dropshipping' : 'Dropshipping team'}</Button>
              <Button href="/account/support?subject=Add%20a%20team%20member" variant="ghost">Ask support to add someone</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-ods-body">Inviting colleagues yourself comes with the team update (roles per service: Buyer, Warehouse, Accounts). Until then, ask support and we add them for you.</p>
            <div><Button href="/account/support?subject=Add%20a%20team%20member" variant="secondary">Ask support to add someone</Button></div>
          </div>
        )}
      </Section>
    </div>
  );
}

export function AddressesPanel({ state }: { state: Panel<AddressRow[]> }) {
  if (state.kind === 'loading') return loading('your addresses');
  if (state.kind === 'error') return failed('Your addresses');
  return (
    <Section title="Addresses" description="Delivery addresses saved for your company. You add a new one when you join a pool or check out; to change or remove one, ask support.">
      {state.data.length === 0 ? <EmptyState icon={MapPin} headingLevel={3} title="No saved addresses yet" description="Addresses you use for deliveries are saved here." /> : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 ods-tablet:grid-cols-2" data-testid="address-list">
          {state.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-ods-card border border-ods-line p-4">
              <span className="flex flex-wrap items-center gap-2 font-semibold">{a.label ?? 'Address'}{a.is_default ? <StatusPill tone="info">Default</StatusPill> : null}</span>
              <span className="text-ods-body">{[a.line1, a.line2].filter(Boolean).join(', ')}</span>
              <span className="text-ods-body">{[a.city, a.region, a.postal_code].filter(Boolean).join(', ')}</span>
              <span className="text-ods-body">{country(a.country)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function NotificationsPanel({ dropshipOn }: { dropshipOn: boolean }) {
  return (
    <Section title="Notifications" description="What we tell you and where.">
      <div className="flex flex-col gap-4">
        <EmptyState icon={Bell} headingLevel={3} title="Email and in-app choices come with the notifications update"
          description="Today every quote, payment, shipment and message from your account manager reaches you in the notification list and by email to your sign-in address." />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" href="/account/notifications">Open your notifications</Button>
          {dropshipOn ? <Button variant="ghost" href="/account/dropship/settings">Dropshipping alerts</Button> : null}
        </div>
      </div>
    </Section>
  );
}

export function SecurityPanel({ email }: { email: string | null }) {
  return (
    <Section title="Security" description="Your sign-in and how to keep it safe.">
      <div className="flex flex-col gap-4">
        <Facts items={[['Your sign-in', email ?? 'Not available'], ['Sign-in method', 'Email and password, or Google']]} />
        <div className="flex flex-wrap gap-2"><Button variant="secondary" href="/forgot">Change your password</Button></div>
        <p className="m-0 text-ods-small text-ods-slate">We email you a secure link to set a new password. Signed in with Google? Your Google account protects your sign-in.</p>
        <Notice tone="info">2-step codes for customers (withdrawals, bank details, team changes) come with the security update. Staff accounts already use them.</Notice>
      </div>
    </Section>
  );
}

export function KycPanel({ state }: { state: Panel<KycData> }) {
  if (state.kind === 'loading') return <div data-testid="kyc-panel">{loading('verification')}</div>;
  if (state.kind === 'error') return <div data-testid="kyc-panel">{failed('Verification')}</div>;
  const k = state.data;
  const st = kycView(k.status);
  const note = k.latest && (k.latest.status === 'more_info' || k.latest.status === 'rejected') ? k.latest.message : null;
  return (
    <div className="flex flex-col gap-6" data-testid="kyc-panel" data-status={k.status}>
      <Section title="Verification (KYC)" actions={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
        description="We verify every buyer's business before live orders, wallet withdrawals and live API access. Browsing and quote requests work before.">
        <div className="flex flex-col gap-4">
          <Stepper label="Verification progress" current={Math.min(st.step, KYC_STEPS.length - 1)}
            steps={KYC_STEPS.map((label, i) => ({ id: String(i), label, status: i < st.step ? 'done' : i === st.step ? (k.status === 'rejected' ? 'error' : 'current') : 'upcoming', errorText: k.status === 'rejected' && i === st.step ? 'Not approved' : undefined }))} />
          {k.status === 'verified' ? <Notice tone="success">Your business is verified. Live orders, live API keys and wallet withdrawals are unlocked. Contact support if your company details change.</Notice> : null}
          {k.status === 'in_review' || (k.status === 'submitted' && k.mode === 'locked') ? <Notice tone="info">Your details were submitted{k.latest?.submitted_at ? ` on ${formatDate(k.latest.submitted_at)}` : ''} and are {k.status === 'in_review' ? 'being reviewed' : 'waiting for review'}. The form is locked until our team responds.</Notice> : null}
          {k.status === 'submitted' && k.mode === 'docs' ? <Notice tone="warning">Your details are in, but a required document is missing. Add it below.</Notice> : null}
          {k.status === 'more_info' ? <Notice tone="warning"><strong>We need more information.</strong>{note ? ` ${note}` : ''} Update the form below and submit again.</Notice> : null}
          {k.status === 'rejected' ? <Notice tone="danger"><strong>Verification was not approved.</strong>{note ? ` ${note}` : ''} You can correct the details and submit again.</Notice> : null}
        </div>
      </Section>
      <KycPanelForm mode={k.mode} initial={k.initial} existingDocs={k.docs} latestSubmissionId={k.latest?.id ?? null} orgId={k.orgId} />
      <Section title="Submission history">
        {k.subs.length === 0 ? <EmptyState icon={ShieldCheck} headingLevel={3} title="No submissions yet" description="Your verification submissions and messages from our team appear here." /> : (
          <Timeline label="Verification submissions" items={k.subs.map((s, i) => ({
            id: s.id, title: kycView(s.status).label, date: s.submitted_at ?? s.created_at, state: i === 0 ? 'current' as const : 'done' as const,
            description: [s.company_name, s.message ? `Message from our team: ${s.message}` : null, s.reviewed_at ? `Reviewed ${formatDate(s.reviewed_at)}` : null].filter(Boolean).join(' · ') || undefined,
          }))} />
        )}
      </Section>
    </div>
  );
}

/** /account/settings (Part 6.7, C_Team): vertical tabs Company · Team · Addresses · Notifications · Security · Verification (KYC). */
export function SettingsView({ data, tab, tabParam = 'tab' }: { data: SettingsData; tab: SettingsTab; tabParam?: string | null }) {
  const panels: Record<SettingsTab, ReactNode> = {
    company: <CompanyPanel state={data.company} />,
    team: <TeamPanel state={data.team} />,
    addresses: <AddressesPanel state={data.addresses} />,
    notifications: <NotificationsPanel dropshipOn={data.dropshipOn} />,
    security: <SecurityPanel email={data.email} />,
    verification: <KycPanel state={data.kyc} />,
  };
  const k = data.company.kind === 'ready' ? kycView(data.company.data.kyc_status) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Team and settings" description="People, company details, addresses, notifications, security and verification." />
      <VerticalTabs label="Settings sections" value={tab} param={tabParam} testId="settings-tabs"
        items={SETTINGS_TABS.map((id) => ({ id, label: SETTINGS_TAB_LABEL[id], panel: panels[id], badge: id === 'verification' && k && k.name !== 'Verified' ? <span className="text-ods-small font-semibold text-ods-warning">{k.name === 'Verification pending' ? 'Pending' : 'To do'}</span> : undefined }))} />
      <p className="m-0 text-ods-small text-ods-slate">Looking for something else? <TextLink href="/account/support">Ask support</TextLink>.</p>
    </div>
  );
}
