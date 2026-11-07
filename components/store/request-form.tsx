'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { money, withCurrency } from '@/lib/format';
import { ConfirmChargeCurrency } from './confirm-charge-currency';
import { REQUEST_FIELDS, COUNTRY_OPTIONS, requestSchema, type RequestType, type RequestValues, type Field } from './request-schema';

type Props = {
  type: RequestType; action: (type: string, values: RequestValues, productId: string | null, idem: string) => Promise<{ ok: boolean; error?: string; redirect?: string }>;
  defaults: RequestValues; productId: string | null; feeCents: number; feeLabel: string; serviceName: string;
  /** Platform currency: the fee (service_price_info) and the wallet balance (my_wallet_balance(p_currency)) are both in it. */
  balanceCents: number | null; creditCents?: number; walletEnabled: boolean; currency: string;
  mode: 'ready' | 'guest' | 'no-org'; loginHref: string;
};

/** Request.png form: React Hook Form + the shared zod schema; submit goes through <ConfirmCharge/> (fee + wallet balance). */
export function RequestForm({ type, action, defaults, productId, feeCents, feeLabel, serviceName, balanceCents, creditCents = 0, walletEnabled, currency, mode, loginHref }: Props) {
  const router = useRouter();
  const sections = REQUEST_FIELDS[type];
  const schema = useMemo(() => requestSchema(type), [type]);
  const initial = useMemo(() => {
    const v: RequestValues = {};
    sections.forEach((s) => s.fields.forEach((f) => (v[f.name] = defaults[f.name] ?? '')));
    return v;
  }, [sections, defaults]);
  const { register, trigger, getValues, reset, formState: { errors } } = useForm<RequestValues>({ resolver: zodResolver(schema), defaultValues: initial, mode: 'onTouched' });
  // ADDON-36 (H5): what a signed-out visitor typed survives sign-in / sign-up (sessionStorage, this tab only)
  const draftKey = `octopus:request:${type}`;
  useEffect(() => {
    if (mode !== 'ready') return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      sessionStorage.removeItem(draftKey);
      const saved = JSON.parse(raw) as RequestValues;
      const merged: RequestValues = { ...initial };
      Object.keys(merged).forEach((k) => { if (typeof saved[k] === 'string' && saved[k]) merged[k] = saved[k]; });
      reset(merged);
    } catch { /* storage unavailable: nothing to restore */ }
  }, [mode, draftKey, initial, reset]);
  const saveDraft = () => { try { sessionStorage.setItem(draftKey, JSON.stringify(getValues())); } catch { /* ignore */ } };
  // any sign-in / sign-up link on the page (top notice, header) keeps the draft too
  useEffect(() => {
    if (mode !== 'guest') return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a[href^="/login"], a[href^="/signup"]');
      if (a) { try { sessionStorage.setItem(draftKey, JSON.stringify(getValues())); } catch { /* ignore */ } }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [mode, draftKey, getValues]);
  const [idem] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const disabled = mode !== 'ready';
  const submitLabel = type === 'sourcing' ? (feeCents > 0 ? 'Pay and submit RFQ' : 'Submit RFQ') : type === 'dropship' ? 'Start dropship setup' : (feeCents > 0 ? `Pay and submit request` : 'Submit request');

  const onConfirm = async () => {
    const valid = await trigger();
    if (!valid) return { ok: false, error: 'Please complete the highlighted fields, then try again.' };
    const r = await action(type, getValues(), productId, idem);
    if (r.ok && r.redirect) { router.push(r.redirect); return { ok: true }; }
    return { ok: false, error: r.error ?? 'Could not submit the request.' };
  };

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} className="space-y-8" aria-describedby={disabled ? 'req-locked' : undefined}>
      <fieldset disabled={mode === 'no-org'} className="space-y-8 disabled:opacity-70">
        {sections.map((s) => (
          <div key={s.title}>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-4">{s.title}<span className="flex-1 h-px bg-line" aria-hidden /></h2>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.fields.map((f) => <FieldInput key={f.name} f={{ ...f, label: withCurrency(f.label, currency) }} reg={register(f.name)} error={errors[f.name]?.message as string | undefined} />)}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="border-t border-line pt-6 space-y-5">
        <div className="rounded-[12px] bg-surface p-5">
          <h3 className="font-sans font-semibold text-[16px]">Fees for this request</h3>
          <div className="flex justify-between mt-2 text-[14px]" data-testid="fee-row"><span className="text-muted">{serviceName}</span><span className="mono font-semibold">{feeCents > 0 ? money(feeCents, currency) : 'Free'}</span></div>
          {feeCents > 0 && (
            <div className="flex justify-between items-baseline border-t border-line mt-3 pt-3">
              <span className="font-semibold">Pay now</span><span className="font-display text-2xl font-bold">{money(feeCents, currency)}</span>
            </div>
          )}
          <p className="text-[13px] text-muted mt-1" data-testid="fee-text">{feeLabel}</p>
        </div>
        <div className="flex flex-wrap justify-between items-center gap-4">
          <p className="text-[13px] text-muted max-w-sm">
            You get a reference number right away and can follow the request in My account › Product sourcing.
          </p>
          {mode === 'ready' && (
            <ConfirmChargeCurrency label={submitLabel} title={`Confirm ${serviceName.toLowerCase()}`} priceCents={feeCents} balanceCents={balanceCents} creditCents={creditCents} currency={currency}
              walletEnabled={walletEnabled && feeCents > 0} onConfirm={onConfirm} />
          )}
          {mode === 'guest' && <Link href={loginHref} onClick={saveDraft} className="btn btn-primary" data-testid="signin-to-submit">Sign in to submit</Link>}
          {mode === 'no-org' && <Link href="/onboarding" className="btn btn-primary">Complete company profile</Link>}
        </div>
      </div>
    </form>
  );
}

function FieldInput({ f, reg, error }: { f: Field; reg: UseFormRegisterReturn; error?: string }) {
  const id = `rq-${f.name}`;
  const describedBy = [error && `${id}-err`, f.hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': describedBy, 'aria-required': f.required, ...reg };
  return (
    <div className={f.full ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label htmlFor={id} className="label">{f.label}{f.required && <span className="text-bad" aria-hidden> *</span>}</label>
      {f.kind === 'textarea' ? (
        <textarea {...common} rows={4} placeholder={f.placeholder} className="input py-2.5 min-h-[110px]" />
      ) : f.kind === 'select' || f.kind === 'country' ? (
        <select {...common} className="input">
          <option value="">{f.kind === 'country' ? 'Select country' : 'Select…'}</option>
          {f.kind === 'country'
            ? COUNTRY_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)
            : f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input {...common} type={f.kind === 'date' ? 'date' : 'text'} inputMode={f.kind === 'int' ? 'numeric' : f.kind === 'money' ? 'decimal' : undefined}
          placeholder={f.placeholder} className="input" />
      )}
      {f.hint && !error && <p id={`${id}-hint`} className="text-[12px] text-muted mt-1">{f.hint}</p>}
      {error && <p id={`${id}-err`} className="text-[13px] text-bad mt-1" role="alert">{error}</p>}
    </div>
  );
}
