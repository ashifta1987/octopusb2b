'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/lib/supabase/client';
import { supplierApplySchema, SHEET_EXT, SHEET_MAX_BYTES, type SupplierApplyValues } from '@/lib/supplier-apply/schema';
import { createSheetUpload, submitSupplierApplication } from './actions';

/** ADDON-36 C5 — supplier application form (RHF + shared zod schema; product sheet straight to private Storage). */
export function ApplyForm({ categories }: { categories: string[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<SupplierApplyValues>({
    resolver: zodResolver(supplierApplySchema), mode: 'onTouched',
    defaultValues: { company_name: '', uscc: '', city: '', province: '', categories: [], contact_name: '', contact_email: '', contact_phone: '', wechat: '', website: '', store_url: '', product_sheet_path: '', notes: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErr(null);
    let product_sheet_path = '';
    if (file) {
      if (!SHEET_EXT.test(file.name) || file.size > SHEET_MAX_BYTES) { setErr('Product sheets must be PDF, Excel, CSV, JPG or PNG, up to 20 MB.'); return; }
      setBusy('Uploading product sheet…');
      const up = await createSheetUpload({ name: file.name, size: file.size });
      if (!up.ok) { setBusy(null); setErr(up.error); return; }
      const { error } = await createClient().storage.from('supplier-applications').uploadToSignedUrl(up.path, up.token, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { setBusy(null); setErr(`Upload failed: ${error.message}. Remove the file or try again.`); return; }
      product_sheet_path = up.path;
    }
    setBusy('Sending your application…');
    const r = await submitSupplierApplication({ ...values, product_sheet_path });
    setBusy(null);
    if (!r.ok) {
      if (r.field && r.field in values) setError(r.field as keyof SupplierApplyValues, { message: r.error });
      setErr(r.error); return;
    }
    setDone(r.reference);
  }, () => setErr('Please complete the highlighted fields, then try again.'));

  if (done) {
    return (
      <div role="status" className="rounded-[14px] border border-ok-bg bg-ok-bg p-6" data-testid="apply-done">
        <h3 className="text-lg font-bold">Application received</h3>
        <p className="mt-1 text-[15px]">Your reference is <b className="mono">{done}</b>. We sent a confirmation email and will contact you within 3 working days.</p>
      </div>
    );
  }

  const f = (name: keyof SupplierApplyValues) => ({ id: `sa-${name}`, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `sa-${name}-err` : undefined, ...register(name) });
  const errOf = (name: keyof SupplierApplyValues) => (errors[name] ? <p id={`sa-${name}-err`} role="alert" className="text-[13px] text-bad mt-1">{String(errors[name]?.message)}</p> : null);
  const req = <span className="text-bad" aria-hidden> *</span>;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2" data-testid="supplier-apply-form">
      <div><label htmlFor="sa-company_name" className="label">Company name{req}</label><input {...f('company_name')} className="input" autoComplete="organization" placeholder="e.g. Shenzhen Example Electronics Co., Ltd." />{errOf('company_name')}</div>
      <div><label htmlFor="sa-uscc" className="label">USCC (统一社会信用代码)</label><input {...f('uscc')} className="input mono uppercase" maxLength={18} placeholder="18 letters and digits" />{errOf('uscc')}</div>
      <div><label htmlFor="sa-city" className="label">City{req}</label><input {...f('city')} className="input" placeholder="e.g. Shenzhen" />{errOf('city')}</div>
      <div><label htmlFor="sa-province" className="label">Province</label><input {...f('province')} className="input" placeholder="e.g. Guangdong" />{errOf('province')}</div>
      <fieldset className="sm:col-span-2" aria-describedby={errors.categories ? 'sa-categories-err' : undefined}>
        <legend className="label">What do you make?{req}</legend>
        <div className="flex flex-wrap gap-2 mt-1">
          {[...categories, 'Other'].map((c) => (
            <label key={c} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-white px-3.5 min-h-11 text-[14px] cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-pearl">
              <input type="checkbox" value={c} {...register('categories')} className="w-4 h-4 accent-coral" />{c}
            </label>
          ))}
        </div>
        {errors.categories && <p id="sa-categories-err" role="alert" className="text-[13px] text-bad mt-1">{String(errors.categories.message)}</p>}
      </fieldset>
      <div><label htmlFor="sa-contact_name" className="label">Contact name{req}</label><input {...f('contact_name')} className="input" autoComplete="name" />{errOf('contact_name')}</div>
      <div><label htmlFor="sa-contact_email" className="label">Email{req}</label><input {...f('contact_email')} type="email" className="input" autoComplete="email" inputMode="email" />{errOf('contact_email')}</div>
      <div><label htmlFor="sa-contact_phone" className="label">Phone</label><input {...f('contact_phone')} type="tel" className="input" autoComplete="tel" inputMode="tel" placeholder="+86 …" />{errOf('contact_phone')}</div>
      <div><label htmlFor="sa-wechat" className="label">WeChat ID</label><input {...f('wechat')} className="input" />{errOf('wechat')}</div>
      <div><label htmlFor="sa-website" className="label">Website</label><input {...f('website')} className="input" inputMode="url" placeholder="www.example.com" />{errOf('website')}</div>
      <div><label htmlFor="sa-store_url" className="label">1688 / Alibaba store</label><input {...f('store_url')} className="input" inputMode="url" placeholder="example.1688.com" />{errOf('store_url')}</div>
      <div className="sm:col-span-2">
        <label htmlFor="sa-sheet" className="label">Product sheet or catalogue</label>
        <input id="sa-sheet" type="file" accept=".pdf,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[14px] file:btn file:btn-ghost file:mr-3 file:min-h-11" />
        <p className="text-[12px] text-muted mt-1">PDF, Excel, CSV, JPG or PNG, up to 20 MB. A price list with MOQ helps us review faster.</p>
      </div>
      <div className="sm:col-span-2"><label htmlFor="sa-notes" className="label">Anything else?</label><textarea {...f('notes')} rows={3} className="input py-2.5 min-h-[96px]" placeholder="Export markets, certifications, factory size…" />{errOf('notes')}</div>
      {err && <p role="alert" className="sm:col-span-2 rounded-[10px] bg-bad-bg text-bad text-[14px] px-4 py-3">{err}</p>}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary min-h-11" disabled={!!busy}>{busy ?? 'Apply to sell →'}</button>
        <span className="text-[12.5px] text-muted">Free to apply. We only use these details to review your application.</span>
      </div>
    </form>
  );
}

