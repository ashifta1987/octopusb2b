/**
 * ODS T9 · /admin/turnkey/settings — presentational. Admins on 2FA (tk_settings.can_edit && isAdmin) change values with
 * TODAY's forms (DepositSetting / DepositCustomSetting → setDepositPct*Action; SettingForm → settings/actions.ts); everyone
 * else with turnkey:view sees the values. Every change is audited (recent changes list).
 */
import type { ReactNode } from 'react';
import { EmptyState } from '@octopus/ui';
import { fmtDate } from '@/lib/format';
import { settingChangeLabel, type TkSettings } from '@/lib/turnkey/reports';
import { DepositCustomSetting, DepositSetting } from '@/components/turnkey/quote-staff';
import { SettingForm } from '@/app/admin/turnkey/settings/settings-client';
import { LoadError, Note, Panel, TurnkeyHead } from './tk-ui';

const dollars = (c: number | null | undefined) => (c == null ? '' : (Number(c) / 100).toFixed(Number(c) % 100 === 0 ? 0 : 2));

function Val({ children, testId }: { children: ReactNode; testId?: string }) {
  return <p className="m-0 text-ods-body font-semibold text-ods-navy" data-testid={testId}>{children}</p>;
}

export function SettingsView({ v, isAdmin, money }: { v: TkSettings | null; isAdmin: boolean; money: (c: number) => string }) {
  const edit = !!v?.can_edit && isAdmin;
  return (
    <div className="grid gap-4" data-testid="tk-settings">
      <TurnkeyHead title="Turnkey settings" subtitle="Prices and rules the Turnkey team works with. Only admins change them; every change is recorded." current="settings" isAdmin={isAdmin} />
      {!v ? <LoadError what="the settings" /> : (
        <>
          {!edit ? <Note>You can see these settings. Only an admin (signed in with 2FA) can change them.</Note> : null}
          <div className="grid gap-4 ods-desktop:grid-cols-2">
            <Panel title="Quote deposit" testId="tk-settings-deposit" description="The share of an accepted quote the client pays before production. A sent quote keeps the % it was sent with.">
              {edit ? <DepositSetting current={v.deposit_pct} /> : <Val>{v.deposit_pct ? `${v.deposit_pct}%` : 'Not set yet'}</Val>}
            </Panel>
            <Panel title="Quote deposit: custom / branded orders" testId="tk-settings-deposit-custom" description="Projects marked custom / branded take this deposit instead. A sent quote keeps the % it was sent with.">
              {edit ? <DepositCustomSetting current={v.deposit_pct_custom} /> : <Val>{v.deposit_pct_custom ? `${v.deposit_pct_custom}%` : 'Not set yet'}</Val>}
            </Panel>
            <Panel title="Visit China: extra traveller" testId="tk-settings-traveller" description={`The day price covers up to ${v.included_travellers ?? 2} people. Each extra traveller costs this much per day. New visit requests use it; requested visits keep their price.`}>
              {edit ? (
                <SettingForm id="extra-traveller" label="Extra traveller price per day (US$)" inputMode="decimal" initial={dollars(v.extra_traveller_day_cents)} suffix="per day"
                  help={v.visit_rule_text ? `Clients read: “${v.visit_rule_text}” The amount in this text follows the price.` : 'Shown on the services page.'} />
              ) : <Val>{v.extra_traveller_day_cents != null ? `${money(v.extra_traveller_day_cents)} per day` : 'Not set'}</Val>}
            </Panel>
            <Panel title="Passport copies" testId="tk-settings-retention" description="Passport copies for a China visit are deleted this many days after the visit ends (or is cancelled). Clients can ask for deletion at any time.">
              {edit ? (
                <SettingForm id="retention" label="Keep passport copies for (days after the visit)" inputMode="numeric" initial={String(v.passport_retention_days)} suffix="days"
                  help={v.passport_retention_set ? `Now ${v.passport_retention_days} days.` : `Not set: the standard ${v.passport_retention_days} days apply.`} />
              ) : <Val>{v.passport_retention_days} days{v.passport_retention_set ? '' : ' (standard)'}</Val>}
            </Panel>
            <Panel title="Account manager fee waiver" testId="tk-settings-threshold" description="The dedicated account manager fee is waived for projects worth more than this. The owner sets this value; until then it is not set and nothing is waived automatically.">
              {edit ? (
                <SettingForm id="threshold" label="Waive the fee above a project value of (US$)" inputMode="decimal" initial={dollars(v.am_waiver_threshold_cents)} allowEmpty
                  help={v.am_waiver_threshold_cents != null ? `Now ${money(v.am_waiver_threshold_cents)}. Leave it empty and save to clear it.` : 'Not set yet.'} />
              ) : <Val testId="tk-settings-threshold-value">{v.am_waiver_threshold_cents != null ? money(v.am_waiver_threshold_cents) : 'Not set yet'}</Val>}
            </Panel>
          </div>
          <Panel title="Recent changes">
            {v.changes.length === 0 ? <EmptyState title="No changes yet" description="Each change to these settings is listed here with who made it." headingLevel={3} /> : (
              <ul className="m-0 grid list-none gap-0 divide-y divide-ods-line p-0" data-testid="tk-settings-changes">
                {v.changes.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="flex flex-wrap justify-between gap-2 py-2 text-ods-table">
                    <span>{settingChangeLabel(c)}</span>
                    <span className="text-ods-slate">{c.by ?? 'System'} · {fmtDate(c.at, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
