import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Notice, EmptyState } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { DepositCustomSetting, DepositSetting } from '@/components/turnkey/quote-staff';
import { TurnkeyStaffNav } from '@/components/turnkey/staff-nav';
import { settingChangeLabel, type TkSettings } from '@/lib/turnkey/reports';
import { SettingForm } from './settings-client';

export const metadata = { title: 'Turnkey settings' };

const dollars = (c: number | null | undefined) => (c == null ? '' : (Number(c) / 100).toFixed(Number(c) % 100 === 0 ? 0 : 2));

/**
 * Admin › Turnkey › Settings (Turnkey T7; design staff "Settings"): the deposit % of quotes (T4), the Visit China extra
 * traveller price per day (T6 data), how long passport copies are kept after a visit, and the design's open placeholder
 * "[THRESHOLD]: project value above which the account manager fee is waived" — left unset until the owner sets it.
 * Admins on 2FA change them; other Turnkey staff see the values. Every change is audited and listed here.
 */
export default async function TurnkeySettingsPage() {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/settings');
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_settings');
  const v = (data ?? null) as TkSettings | null;
  const edit = !!v?.can_edit && s.isAdmin;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Turnkey settings" subtitle="Prices and rules the Turnkey team works with. Only admins change them; every change is recorded." />
      <TurnkeyStaffNav current="settings" isAdmin={s.isAdmin} />
      {error || !v ? <Notice tone="red">The settings could not be loaded. Try again in a moment.</Notice> : (
        <>
          {!edit && <Notice tone="blue">You can see these settings. Only an admin (signed in with 2FA) can change them.</Notice>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Quote deposit">
              <div data-testid="tk-settings-deposit" className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-muted">The share of an accepted quote the client pays before production. A sent quote keeps the % it was sent with.</p>
                {edit ? <DepositSetting current={v.deposit_pct} /> : <p className="m-0 text-[15px] font-semibold">{v.deposit_pct ? `${v.deposit_pct}%` : 'Not set yet'}</p>}
              </div>
            </Card>
            <Card title="Quote deposit: custom / branded orders">
              <div data-testid="tk-settings-deposit-custom" className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-muted">Projects marked custom / branded take this deposit instead. A sent quote keeps the % it was sent with.</p>
                {edit ? <DepositCustomSetting current={v.deposit_pct_custom} /> : <p className="m-0 text-[15px] font-semibold">{v.deposit_pct_custom ? `${v.deposit_pct_custom}%` : 'Not set yet'}</p>}
              </div>
            </Card>
            <Card title="Visit China: extra traveller">
              <div data-testid="tk-settings-traveller" className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-muted">The day price covers up to {v.included_travellers ?? 2} people. Each extra traveller costs this much per day. New visit requests use it; requested visits keep their price.</p>
                {edit ? (
                  <SettingForm id="extra-traveller" label="Extra traveller price per day (US$)" inputMode="decimal" initial={dollars(v.extra_traveller_day_cents)} suffix="per day"
                    help={v.visit_rule_text ? `Clients read: “${v.visit_rule_text}” The amount in this text follows the price.` : 'Shown on the services page.'} />
                ) : <p className="m-0 text-[15px] font-semibold">{v.extra_traveller_day_cents != null ? `${money(v.extra_traveller_day_cents)} per day` : 'Not set'}</p>}
              </div>
            </Card>
            <Card title="Passport copies">
              <div data-testid="tk-settings-retention" className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-muted">Passport copies for a China visit are deleted this many days after the visit ends (or is cancelled). Clients can ask for deletion at any time.</p>
                {edit ? (
                  <SettingForm id="retention" label="Keep passport copies for (days after the visit)" inputMode="numeric" initial={String(v.passport_retention_days)} suffix="days"
                    help={v.passport_retention_set ? `Now ${v.passport_retention_days} days.` : `Not set: the standard ${v.passport_retention_days} days apply.`} />
                ) : <p className="m-0 text-[15px] font-semibold">{v.passport_retention_days} days{v.passport_retention_set ? '' : ' (standard)'}</p>}
              </div>
            </Card>
            <Card title="Account manager fee waiver">
              <div data-testid="tk-settings-threshold" className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-muted">The dedicated account manager fee is waived for projects worth more than this. The owner sets this value; until then it is not set and nothing is waived automatically.</p>
                {edit ? (
                  <SettingForm id="threshold" label="Waive the fee above a project value of (US$)" inputMode="decimal" initial={dollars(v.am_waiver_threshold_cents)} allowEmpty
                    help={v.am_waiver_threshold_cents != null ? `Now ${money(v.am_waiver_threshold_cents)}. Leave it empty and save to clear it.` : 'Not set yet.'} />
                ) : <p className="m-0 text-[15px] font-semibold" data-testid="tk-settings-threshold-value">{v.am_waiver_threshold_cents != null ? money(v.am_waiver_threshold_cents) : 'Not set yet'}</p>}
              </div>
            </Card>
          </div>
          <Card title="Recent changes">
            {v.changes.length === 0 ? <EmptyState title="No changes yet" body="Each change to these settings is listed here with who made it." /> : (
              <ul className="m-0 p-0 list-none flex flex-col gap-2" data-testid="tk-settings-changes">
                {v.changes.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="flex flex-wrap justify-between gap-2 text-[14px] border-b border-line pb-2">
                    <span>{settingChangeLabel(c)}</span>
                    <span className="text-muted">{c.by ?? 'System'} · {fmtDate(c.at, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
