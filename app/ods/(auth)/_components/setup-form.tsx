'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { Button, Field, Icon, Input, Select, ODS_SERVICE_ICONS, odsServices, cx, type OdsServiceKey } from '@octopus/ui';
import { normalizeE164, OTHER_COUNTRY, PHONE_ERROR, PHONE_HINT, SETUP_ROLES } from '@/lib/ods-auth';
import type { CountryOption } from '@/lib/ods-auth-settings';
import type { SetupField, SetupFormState } from '../welcome/setup/actions';
import { AuthNotice, InfoBox } from './notice';

/** Left border + checked tint per service (static class names for Tailwind). */
const CARD: Record<OdsServiceKey, { border: string; tint: string; text: string }> = {
  sourcing: { border: 'border-s-ods-svc-sourcing', tint: 'has-[:checked]:bg-ods-svc-sourcing-tint', text: 'text-ods-svc-sourcing' },
  pools: { border: 'border-s-ods-svc-pools', tint: 'has-[:checked]:bg-ods-svc-pools-tint', text: 'text-ods-svc-pools' },
  dropship: { border: 'border-s-ods-svc-dropship', tint: 'has-[:checked]:bg-ods-svc-dropship-tint', text: 'text-ods-svc-dropship' },
  '3pl': { border: 'border-s-ods-svc-3pl', tint: 'has-[:checked]:bg-ods-svc-3pl-tint', text: 'text-ods-svc-3pl' },
  turnkey: { border: 'border-s-ods-svc-turnkey', tint: 'has-[:checked]:bg-ods-svc-turnkey-tint', text: 'text-ods-svc-turnkey' },
  brand: { border: 'border-s-ods-svc-brand', tint: 'has-[:checked]:bg-ods-svc-brand-tint', text: 'text-ods-svc-brand' },
};

export type SetupFormProps = {
  countries: { launch: CountryOption[]; all: CountryOption[] };
  next: string;
  action: (prev: SetupFormState, formData: FormData) => Promise<SetupFormState>;
  /** fixtures: show a validation state without submitting */
  initialState?: SetupFormState;
};

/**
 * First-time company setup form (Auth_Setup). Controlled fields (values survive a failed submit). Phone is checked as
 * E.164 on blur and on submit (lib/ods-auth.ts normalizeE164, the same helper the server action uses). The six cards are
 * native checkboxes (Space toggles) with the service colour as a left border and icon + name (never colour alone).
 * Phones: one column.
 */
export function SetupForm({ countries, next, action, initialState = null }: SetupFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const v = state?.values;
  const [company, setCompany] = useState(v?.company ?? '');
  const [country, setCountry] = useState(v?.country ?? '');
  const [phone, setPhone] = useState(v?.phone ?? '');
  const [role, setRole] = useState(v?.role || 'owner');
  const [interests, setInterests] = useState<string[]>(v?.interests ?? []);
  const [local, setLocal] = useState<Partial<Record<SetupField, string>>>({});
  const err = (f: SetupField) => local[f] ?? state?.fieldErrors?.[f];

  function checkPhone() {
    setLocal((l) => ({ ...l, phone: phone.trim() && !normalizeE164(phone) ? PHONE_ERROR : undefined }));
  }
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const l: Partial<Record<SetupField, string>> = {};
    if (company.trim().length < 2) l.company = 'Enter your company name (at least 2 characters).';
    if (!country) l.country = 'Choose your country, or Other.';
    if (!normalizeE164(phone)) l.phone = phone.trim() ? PHONE_ERROR : 'Enter your WhatsApp number with + and the country code.';
    setLocal(l);
    if (Object.keys(l).length) {
      e.preventDefault();
      const first = e.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(l)[0]}"]`);
      first?.focus();
    }
  }
  const toggle = (k: string, on: boolean) => setInterests((xs) => (on ? [...new Set([...xs, k])] : xs.filter((x) => x !== k)));

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5" data-testid="setup-form">
      <input type="hidden" name="next" value={next} />
      {state?.formError ? (
        <AuthNotice tone="danger" title="We couldn’t set up your company." testId="setup-error" state="form-error">
          {state.formError}
        </AuthNotice>
      ) : null}
      <div className="grid gap-4 ods-tablet:grid-cols-2">
        <Field label="Company name" required error={err('company')}>
          <Input name="company" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Country" required error={err('country')}>
          <Select name="country" autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Choose your country">
            {countries.launch.length ? (
              <optgroup label="Launch countries">
                {countries.launch.map((c) => (
                  <option key={`l-${c.code}`} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label={countries.launch.length ? 'All countries' : 'Countries'}>
              {countries.all.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <option value={OTHER_COUNTRY}>Other</option>
          </Select>
        </Field>
        <Field label="Phone (WhatsApp)" required hint={PHONE_HINT} error={err('phone')}>
          <Input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={checkPhone} />
        </Field>
        <Field label="Your role" required error={err('role')}>
          <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {SETUP_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-ods-label font-semibold text-ods-navy">
          What would you like to do? <span className="font-normal text-ods-slate">(choose any)</span>
        </legend>
        <div className="grid gap-3 ods-tablet:grid-cols-2">
          {odsServices.map((svc) => {
            const c = CARD[svc.key];
            const on = interests.includes(svc.key);
            return (
              <label
                key={svc.key}
                className={cx(
                  'flex min-h-[calc(var(--ods-control-h)+8px)] cursor-pointer items-center gap-3 rounded-ods-card border border-s-4 border-ods-line bg-ods-surface px-4 text-ods-body text-ods-text',
                  'transition-colors duration-(--ods-motion-fast) ease-ods hover:border-ods-line-strong',
                  c.border,
                  c.tint,
                )}
              >
                <input type="checkbox" name="interests" value={svc.key} checked={on} onChange={(e) => toggle(svc.key, e.target.checked)} className="size-[18px] shrink-0 accent-[var(--ods-blue)]" />
                <Icon icon={ODS_SERVICE_ICONS[svc.key]} size="sm" className={c.text} />
                <span>{svc.name}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <InfoBox title="Verify your company later.">You can browse and send requests now. We ask for your trade licence before your first payment.</InfoBox>

      <div>
        <Button type="submit" variant="primary" loading={pending} loadingText="Setting up…" data-testid="setup-submit">
          Go to the shop
        </Button>
      </div>
    </form>
  );
}
