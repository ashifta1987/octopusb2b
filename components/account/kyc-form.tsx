'use client';
import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { COUNTRY_NAMES, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { submitKyc, type KycInput } from '@/app/account/kyc/actions';

import { KYC_DOCS } from './kyc-docs';
export { KYC_DOCS };
type DocType = (typeof KYC_DOCS)[number]['type'];

export type KycExistingDoc = { doc_type: string; file_name: string | null; storage_path: string; created_at: string };
export type KycFormValues = Omit<KycInput, 'consent'>;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const BUSINESS_TYPES = ['E-commerce seller', 'Retailer', 'Wholesaler / distributor', 'Importer / wholesaler', 'Dropshipper', 'Manufacturer', 'Contractor / installer', 'Other'];

function safeFileName(name: string) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${base}.${ext}` : base;
}

function checkFile(f: File): string | null {
  const extOk = /\.(pdf|jpe?g|png)$/i.test(f.name);
  if (!extOk || (f.type && !OK_TYPES.includes(f.type))) return 'Only PDF, JPG or PNG files are accepted.';
  if (f.size > MAX_BYTES) return 'File is larger than 10 MB.';
  return null;
}

function Req() {
  return <span className="text-bad" aria-hidden> *</span>;
}

/**
 * KYC form. mode:
 *  - edit: full form, creates a new submission (status not_started / rejected / more_info)
 *  - docs: submission already sent but required documents are missing → upload only those to the latest submission
 *  - locked: read-only (submitted / in_review / verified)
 */
export function KycForm({
  mode, initial, existingDocs, latestSubmissionId, orgId,
}: {
  mode: 'edit' | 'docs' | 'locked';
  initial: KycFormValues;
  existingDocs: KycExistingDoc[];
  latestSubmissionId: string | null;
  orgId: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<KycFormValues>(initial);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<Partial<Record<DocType, File>>>({});
  const [fileErr, setFileErr] = useState<Partial<Record<DocType, string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputs = useRef<Partial<Record<DocType, HTMLInputElement | null>>>({});

  const existing = useMemo(() => {
    const m = new Map<string, KycExistingDoc>();
    existingDocs.forEach((d) => { if (!m.has(d.doc_type)) m.set(d.doc_type, d); });
    return m;
  }, [existingDocs]);

  const countries = useMemo(() => Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])), []);
  const businessTypes = v.businessType && !BUSINESS_TYPES.includes(v.businessType) ? [v.businessType, ...BUSINESS_TYPES] : BUSINESS_TYPES;
  const set = (k: keyof KycFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  const locked = mode === 'locked';
  const detailsDisabled = mode !== 'edit' || pending;

  function pick(type: DocType, f: File | undefined) {
    setFileErr((p) => ({ ...p, [type]: undefined }));
    if (!f) { setFiles((p) => ({ ...p, [type]: undefined })); return; }
    const e = checkFile(f);
    if (e) {
      setFileErr((p) => ({ ...p, [type]: e }));
      setFiles((p) => ({ ...p, [type]: undefined }));
      const el = inputs.current[type];
      if (el) el.value = '';
      return;
    }
    setFiles((p) => ({ ...p, [type]: f }));
  }

  /** Uploads chosen files (and re-links kept files) for a submission from the browser — RLS: own org folder only. */
  async function uploadDocs(submissionId: string, org: string, carryOver: boolean) {
    const sb = createClient();
    const rows: { submission_id: string; org_id: string; doc_type: string; storage_path: string; file_name: string | null }[] = [];
    for (const d of KYC_DOCS) {
      const f = files[d.type];
      if (f) {
        setProgress(`Uploading ${d.label.toLowerCase()}…`);
        const path = `${org}/${submissionId}/${d.type}-${Date.now().toString(36)}-${safeFileName(f.name)}`;
        const { error } = await sb.storage.from('kyc').upload(path, f, { contentType: f.type || undefined });
        if (error) throw new Error(`${d.label}: ${error.message}`);
        rows.push({ submission_id: submissionId, org_id: org, doc_type: d.type, storage_path: path, file_name: f.name });
      } else if (carryOver && existing.has(d.type)) {
        const old = existing.get(d.type)!;
        rows.push({ submission_id: submissionId, org_id: org, doc_type: d.type, storage_path: old.storage_path, file_name: old.file_name });
      }
    }
    if (rows.length) {
      setProgress('Saving documents…');
      const { error } = await sb.from('kyc_documents').insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  function missingRequired(allowExisting: boolean) {
    return KYC_DOCS.filter((d) => d.required && !files[d.type] && !(allowExisting && existing.has(d.type)));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (mode === 'locked') return;

    if (mode === 'docs') {
      if (!latestSubmissionId) return;
      const missing = missingRequired(true);
      if (missing.length) { setErr(`Please add: ${missing.map((d) => d.label).join(', ')}.`); return; }
      if (!Object.values(files).some(Boolean)) { setErr('Choose at least one file to upload.'); return; }
      start(async () => {
        try {
          await uploadDocs(latestSubmissionId, orgId, false);
          setMsg('Documents uploaded. Our team will review them.');
          setFiles({});
          router.refresh();
        } catch (x) {
          setErr(x instanceof Error ? x.message : 'Upload failed');
        } finally { setProgress(null); }
      });
      return;
    }

    const missing = missingRequired(true);
    if (missing.length) { setErr(`Please add: ${missing.map((d) => d.label).join(', ')}.`); return; }
    if (!consent) { setErr('Please confirm the details and accept the Privacy Policy.'); return; }

    start(async () => {
      setProgress('Submitting details…');
      const r = await submitKyc({ ...v, consent: true }, COUNTRY_NAMES[v.country] ?? v.country);
      if (!r.ok || !r.data) { setErr(r.ok ? 'Submission failed' : r.error); setProgress(null); return; }
      try {
        await uploadDocs(r.data.submission_id, r.data.org_id, true);
        setMsg('Submitted for verification. We usually review within 1–2 business days.');
        setFiles({});
      } catch (x) {
        setErr(`Your details were submitted, but a document failed to upload (${x instanceof Error ? x.message : 'error'}). You can add the missing documents below.`);
      } finally {
        setProgress(null);
        router.refresh();
      }
    });
  }

  const field = (k: keyof KycFormValues, label: string, opts: { required?: boolean; type?: string; placeholder?: string; autoComplete?: string; className?: string } = {}) => (
    <div className={opts.className}>
      <label className="label" htmlFor={`kyc-${k}`}>{label}{opts.required && <Req />}</label>
      <input id={`kyc-${k}`} className="input" type={opts.type ?? 'text'} value={v[k] ?? ''} onChange={set(k)} required={opts.required}
        placeholder={opts.placeholder} autoComplete={opts.autoComplete} aria-required={opts.required || undefined} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <fieldset disabled={detailsDisabled} className="space-y-5 min-w-0 disabled:opacity-90">
        <legend className="sr-only">Company details</legend>
        <section className="card p-6" aria-labelledby="kyc-s1">
          <h2 id="kyc-s1" className="text-lg font-semibold mb-4">1 · Company</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field('company', 'Legal company name', { required: true, autoComplete: 'organization' })}
            <div>
              <label className="label" htmlFor="kyc-businessType">Business type<Req /></label>
              <select id="kyc-businessType" className="input" value={v.businessType} onChange={set('businessType')} required aria-required>
                <option value="">Choose…</option>
                {businessTypes.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            {field('regNo', 'Company registration number', { required: true, placeholder: 'e.g. HRB 123456' })}
            {field('website', 'Website', { type: 'url', placeholder: 'https://', autoComplete: 'url' })}
          </div>
        </section>

        <section className="card p-6" aria-labelledby="kyc-s2">
          <h2 id="kyc-s2" className="text-lg font-semibold mb-4">2 · Business address</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="kyc-country">Country<Req /></label>
              <select id="kyc-country" className="input" value={v.country} onChange={set('country')} required aria-required autoComplete="country">
                <option value="">Choose…</option>
                {countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            {field('region', 'State / province / region', { required: true, autoComplete: 'address-level1' })}
            {field('city', 'City', { required: true, autoComplete: 'address-level2' })}
            {field('postal', 'Postal code', { required: true, autoComplete: 'postal-code' })}
            {field('line1', 'Address line 1', { required: true, autoComplete: 'address-line1', className: 'sm:col-span-2 lg:col-span-3' })}
            {field('line2', 'Address line 2', { autoComplete: 'address-line2', className: 'sm:col-span-2 lg:col-span-3' })}
          </div>
          <p className="mt-4 text-sm text-muted">Delivery addresses can be different: give the delivery city and country on each request or order.</p>
        </section>

        <section className="card p-6" aria-labelledby="kyc-s3">
          <h2 id="kyc-s3" className="text-lg font-semibold mb-4">3 · Contact person</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field('contactName', 'Full name', { required: true, autoComplete: 'name' })}
            {field('contactEmail', 'Work email', { required: true, type: 'email', autoComplete: 'email' })}
            {field('contactPhone', 'Phone', { required: true, type: 'tel', placeholder: '+49 40 1234567', autoComplete: 'tel' })}
          </div>
        </section>
      </fieldset>

      <fieldset disabled={locked || pending} className="min-w-0">
        <legend className="sr-only">Documents</legend>
        <section className="card p-6" aria-labelledby="kyc-s4">
          <h2 id="kyc-s4" className="text-lg font-semibold">4 · Documents</h2>
          <p className="mt-1 mb-4 text-sm text-muted">PDF, JPG or PNG, up to 10 MB each. Only our verification team can see them.</p>
          {mode === 'docs' && (
            <p className="mb-4 rounded-[10px] border border-warn/40 bg-warn-bg px-4 py-3 text-sm text-warn" role="status">
              Your details were received, but some required documents are missing. Upload them here to start the review.
            </p>
          )}
          <ul className="space-y-3">
            {KYC_DOCS.map((d) => {
              const ex = existing.get(d.type);
              const f = files[d.type];
              const id = `kyc-doc-${d.type}`;
              const fe = fileErr[d.type];
              return (
                <li key={d.type} className="rounded-[10px] border border-dashed border-line-strong bg-pearl/40 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <label htmlFor={id} className="font-semibold text-[15px]">{d.label}{d.required && <Req />}{d.required && <span className="sr-only"> (required)</span>}</label>
                      <div className="text-sm text-muted truncate">
                        {f ? <>Selected: {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</> : ex ? <>{ex.file_name ?? 'Document'} · uploaded {fmtDate(ex.created_at)}</> : d.hint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {f ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-tint text-coral-text">Ready to upload</span>
                      ) : ex ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-ok-bg text-ok">Uploaded</span>
                      ) : null}
                      {!locked && (
                        <>
                          <input
                            id={id}
                            ref={(el) => { inputs.current[d.type] = el; }}
                            type="file"
                            accept={ACCEPT}
                            className="sr-only"
                            aria-describedby={fe ? `${id}-err` : undefined}
                            onChange={(e) => pick(d.type, e.target.files?.[0])}
                          />
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputs.current[d.type]?.click()}>
                            {f || ex ? 'Replace' : 'Upload file'}
                          </button>
                          {f && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { pick(d.type, undefined); const el = inputs.current[d.type]; if (el) el.value = ''; }}>Remove</button>}
                        </>
                      )}
                    </div>
                  </div>
                  {fe && <p id={`${id}-err`} className="mt-2 text-sm text-bad" role="alert">{fe}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      </fieldset>

      {!locked && (
        <section className="card p-6">
          {mode === 'edit' && (
            <div className="flex items-start gap-3">
              <input id="kyc-consent" type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={pending} required aria-required />
              <label htmlFor="kyc-consent" className="text-[15px]">
                I confirm these details are correct and agree that Octopus B2B stores them to verify my business and to improve its service, as described in the{' '}
                <Link href="/legal/privacy" className="font-semibold text-coral-text underline" target="_blank">Privacy Policy</Link>.
              </label>
            </div>
          )}
          {err && <p className="mt-4 text-sm text-bad" role="alert">{err}</p>}
          {msg && <p className="mt-4 text-sm text-ok" role="status">{msg}</p>}
          <div className={cn('mt-5 flex flex-wrap items-center justify-end gap-3')}>
            {progress && <span className="text-sm text-muted mr-auto" aria-live="polite">{progress}</span>}
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Working…' : mode === 'docs' ? 'Upload documents' : 'Submit for verification'}
            </button>
          </div>
        </section>
      )}
    </form>
  );
}
