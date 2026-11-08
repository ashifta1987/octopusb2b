'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/lib/supabase/client';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import { leadSchema, FLOOR_PLAN_EXT, FLOOR_PLAN_MAX_BYTES, type LeadValues } from '@/lib/turnkey/schema';
import { createFloorPlanUpload, submitTurnkeyLead } from '../actions';

type Props = { kind: 'quote' | 'interest'; projectId: string; packages: { id: string; label: string }[]; defaults: Partial<LeadValues> };

/** Quote / interest form (ADDON-31 §4): RHF + shared zod schema, floor plan straight to private Storage via a signed URL. */
export function LeadForm({ kind, projectId, packages, defaults }: Props) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<LeadValues>({
    resolver: zodResolver(leadSchema), mode: 'onTouched',
    defaultValues: { kind, project_id: projectId, package_id: '', company_name: '', contact_name: '', email: '', phone: '', country: '', delivery_term: '', delivery_place: '', target_open_date: '', floor_plan_path: '', message: '', ...defaults },
  });
  const term = useWatch({ control, name: 'delivery_term' });

  const onSubmit = handleSubmit(async (values) => {
    setErr(null);
    let floor_plan_path = '';
    if (file) {
      if (!FLOOR_PLAN_EXT.test(file.name) || file.size > FLOOR_PLAN_MAX_BYTES) { setErr('Floor plans must be PDF, DWG, JPG or PNG, up to 20 MB.'); return; }
      setBusy('Uploading floor plan…');
      const up = await createFloorPlanUpload({ name: file.name, size: file.size });
      if (!up.ok) { setBusy(null); setErr(up.error); return; }
      const { error } = await createClient().storage.from('turnkey-floorplans').uploadToSignedUrl(up.path, up.token, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { setBusy(null); setErr(`Upload failed: ${error.message}. Remove the file or try again.`); return; }
      floor_plan_path = up.path;
    }
    setBusy(kind === 'quote' ? 'Sending to sourcing…' : 'Registering your interest…');
    const r = await submitTurnkeyLead({ ...values, floor_plan_path });
    if (!r.ok) {
      setBusy(null);
      if (r.field && r.field in values) setError(r.field as keyof LeadValues, { message: r.error });
      setErr(r.error); return;
    }
    router.push(`/turnkey/confirmation/${r.leadId}`);
  }, (bad) => {
    const keys = Object.keys(bad);
    console.warn('turnkey form invalid', keys, Object.values(bad).map((e) => e?.message));
    setErr('Please complete the highlighted fields, then try again.');
  });

  const f = (name: keyof LeadValues) => ({ id: `tk-${name}`, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `tk-${name}-err` : undefined, ...register(name) });
  const errOf = (name: keyof LeadValues) => (errors[name] ? <p id={`tk-${name}-err`} role="alert" className="text-[13px] text-bad mt-1">{String(errors[name]?.message)}</p> : null);
  const req = <span className="text-bad" aria-hidden> *</span>;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2" data-testid="turnkey-lead-form">
      {packages.length > 0 && (
        <div className="sm:col-span-2">
          <label htmlFor="tk-package_id" className="label">{kind === 'quote' ? 'Package' : 'Capacity you have in mind'}</label>
          <select {...f('package_id')} className="input">{packages.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        </div>
      )}
      <div><label htmlFor="tk-company_name" className="label">Company name{req}</label><input {...f('company_name')} className="input" autoComplete="organization" />{errOf('company_name')}</div>
      <div><label htmlFor="tk-contact_name" className="label">Contact name{req}</label><input {...f('contact_name')} className="input" autoComplete="name" />{errOf('contact_name')}</div>
      <div><label htmlFor="tk-email" className="label">Email{req}</label><input {...f('email')} type="email" className="input" autoComplete="email" inputMode="email" />{errOf('email')}</div>
      <div><label htmlFor="tk-phone" className="label">Phone / WhatsApp</label><input {...f('phone')} type="tel" className="input" autoComplete="tel" inputMode="tel" placeholder="+971 …" />{errOf('phone')}</div>
      <div>
        <label htmlFor="tk-country" className="label">Country{req}</label>
        <select {...f('country')} className="input" autoComplete="country"><option value="">Select country</option>{COUNTRY_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        {errOf('country')}
      </div>
      <div><label htmlFor="tk-target_open_date" className="label">Target opening date</label><input {...f('target_open_date')} type="date" className="input" />{errOf('target_open_date')}</div>
      <div>
        <label htmlFor="tk-delivery_term" className="label">Preferred delivery term</label>
        <select {...f('delivery_term')} className="input">
          <option value="">Not sure yet</option><option value="FOB">FOB · Shenzhen / nearest port</option><option value="CIF">CIF · your port</option><option value="DAP">DAP · your door</option>
        </select>
      </div>
      {(term === 'CIF' || term === 'DAP') && (
        <div><label htmlFor="tk-delivery_place" className="label">{term === 'CIF' ? 'Destination port' : 'Delivery city'}{req}</label><input {...f('delivery_place')} className="input" placeholder={term === 'CIF' ? 'e.g. Jebel Ali' : 'e.g. Lagos'} />{errOf('delivery_place')}</div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="tk-floor" className="label">Floor plan (optional)</label>
        <input id="tk-floor" type="file" accept=".pdf,.dwg,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[14px] file:btn file:btn-ghost file:mr-3 file:min-h-10" />
        <p className="text-[12px] text-muted mt-1">PDF, DWG, JPG or PNG, up to 20 MB. On a phone you can photograph a printed plan.</p>
      </div>
      <div className="sm:col-span-2"><label htmlFor="tk-message" className="label">Message</label><textarea {...f('message')} rows={4} className="input py-2.5 min-h-[110px]" placeholder="Site size, power supply, opening plans, questions…" />{errOf('message')}</div>
      {err && <p role="alert" className="sm:col-span-2 rounded-[10px] bg-bad-bg text-bad text-[14px] px-4 py-3">{err}</p>}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy ?? (kind === 'quote' ? 'Send to sourcing →' : 'Register interest →')}</button>
        <span className="text-[12.5px] text-muted">We reply within 24 hours. Your details are only used for this request.</span>
      </div>
    </form>
  );
}
