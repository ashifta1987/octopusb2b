'use client';
import { useState } from 'react';
import { Switch } from '@/components/client';
import { ActionForm } from '@/components/admin/client';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

export type StaffSecuritySettings = {
  enforce_aal2: boolean; lockout_attempts: number; lockout_minutes: number; idle_minutes: number; max_session_hours: number;
  step_up_minutes: number; trust_hours: number; ip_allowlist: string[]; ip_rule_roles: string[]; ip_rule_enabled: boolean; google_domain: string | null;
};

function Num({ id, name, label, value, min, max, unit, hint }: { id: string; name: string; label: string; value: number; min: number; max: number; unit: string; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} name={name} type="number" inputMode="numeric" min={min} max={max} step={1} defaultValue={value} className="input mono w-28" required />
        <span className="text-sm text-muted">{unit}</span>
      </div>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

/** Admin → Staff & roles → Security panel (SPEC §17.3). Saving goes through rpc update_staff_security and needs a fresh 2FA code. */
export function StaffSecurityForm({ settings, action }: { settings: StaffSecuritySettings; action: (prev: R | null, fd: FormData) => Promise<R> }) {
  const [enforce, setEnforce] = useState(settings.enforce_aal2);
  const [ipOn, setIpOn] = useState(settings.ip_rule_enabled);
  const turningOff2fa = settings.enforce_aal2 && !enforce;
  return (
    <ActionForm action={action} className="px-6 pb-6" submitLabel="Save security settings"
      confirm={turningOff2fa ? 'Turn OFF required two-step verification for all staff? This weakens back-office security.' : 'Save the staff security settings?'}>
      <input type="hidden" name="enforce_aal2" value={enforce ? 'true' : 'false'} />
      <input type="hidden" name="ip_rule_enabled" value={ipOn ? 'true' : 'false'} />

      <fieldset className="border-t border-line pt-4">
        <legend className="eyebrow">Lockout</legend>
        <div className="grid gap-4 sm:grid-cols-2 mt-2">
          <Num id="sec-la" name="lockout_attempts" label="Wrong passwords or codes before lock" value={settings.lockout_attempts} min={3} max={20} unit="attempts" />
          <Num id="sec-lm" name="lockout_minutes" label="Lock the account for" value={settings.lockout_minutes} min={1} max={1440} unit="minutes" hint="Admins are notified when an account locks." />
        </div>
      </fieldset>

      <fieldset className="border-t border-line pt-4 mt-5">
        <legend className="eyebrow">Sessions</legend>
        <div className="grid gap-4 sm:grid-cols-2 mt-2">
          <Num id="sec-idle" name="idle_minutes" label="Idle timeout" value={settings.idle_minutes} min={5} max={720} unit="minutes" />
          <Num id="sec-max" name="max_session_hours" label="Maximum session" value={settings.max_session_hours} min={1} max={168} unit="hours" />
          <Num id="sec-step" name="step_up_minutes" label="Ask for the code again after" value={settings.step_up_minutes} min={1} max={120} unit="minutes"
            hint="Money approvals, restores, KYC documents and role changes." />
          <Num id="sec-trust" name="trust_hours" label={'"Trust this computer" lasts'} value={settings.trust_hours} min={0} max={720} unit="hours" hint="0 hides the option." />
        </div>
      </fieldset>

      <fieldset className="border-t border-line pt-4 mt-5">
        <legend className="eyebrow">Office IP rule</legend>
        <div className="flex items-center gap-3 mt-2">
          <Switch checked={ipOn} onChange={setIpOn} label="Limit sign-ins to office IP addresses" />
          <span className="font-semibold">{ipOn ? 'ON' : 'OFF'}</span>
          <span className="text-sm text-muted">Only allow sign-in from these addresses for the roles below</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_220px] mt-3">
          <div>
            <label className="label" htmlFor="sec-ips">Allowed IP addresses</label>
            <textarea id="sec-ips" name="ip_allowlist" rows={4} className="input mono text-sm" defaultValue={settings.ip_allowlist.join('\n')} placeholder={'203.0.113.10\n198.51.100.0/24'} />
            <p className="text-xs text-muted mt-1">One IP address or CIDR range per line.</p>
          </div>
          <fieldset>
            <legend className="label">Apply to roles</legend>
            {[['admin', 'Admin'], ['finance', 'Finance']].map(([code, name]) => (
              <label key={code} className="flex items-center gap-2 text-sm py-1">
                <input type="checkbox" name="ip_rule_roles" value={code} defaultChecked={settings.ip_rule_roles.includes(code)} /> {name}
              </label>
            ))}
          </fieldset>
        </div>
      </fieldset>

      <fieldset className="border-t border-line pt-4 mt-5">
        <legend className="eyebrow">Sign-in</legend>
        <div className="grid gap-4 sm:grid-cols-2 mt-2">
          <div>
            <label className="label" htmlFor="sec-gd">Staff email domain</label>
            <div className="flex items-center gap-1"><span className="text-muted">@</span><input id="sec-gd" name="google_domain" className="input mono" defaultValue={settings.google_domain ?? ''} placeholder="octopusb2b.com" /></div>
            <p className="text-xs text-muted mt-1">Shown as the email hint on the staff login page. Staff sign in with email and password only.</p>
          </div>
          <div>
            <span className="label">Two-step verification for all staff</span>
            <div className="flex items-center gap-3">
              <Switch checked={enforce} onChange={setEnforce} label="Require two-step verification for staff" />
              <span className="font-semibold">{enforce ? 'Required' : 'NOT required'}</span>
            </div>
          </div>
        </div>
        {!enforce && (
          <div role="alert" className="mt-4 rounded-[10px] border border-bad/40 bg-[#FDE8E8] text-[#A32D2D] px-4 py-3 text-sm">
            <p className="font-semibold">Warning: without required 2FA, a stolen password is enough to open the back office, move money and read KYC documents.</p>
            {turningOff2fa ? (
              <div className="mt-3">
                <label className="label" htmlFor="sec-confirm">Type CONFIRM to turn it off</label>
                <input id="sec-confirm" name="confirm_disable_2fa" className="input mono w-48" autoComplete="off" required pattern="CONFIRM" />
              </div>
            ) : <p className="mt-1">2FA is currently not required. Turn it back on as soon as possible.</p>}
          </div>
        )}
      </fieldset>
      <p className="text-xs text-muted mt-4">Saving asks for your 2FA code again if it is older than {settings.step_up_minutes} minutes. Changes are recorded in the audit log.</p>
    </ActionForm>
  );
}
