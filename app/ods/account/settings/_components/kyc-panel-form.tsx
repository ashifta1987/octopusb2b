'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Checkbox, Field, Input, Select } from '@octopus/ui';
import { createClient } from '@/lib/supabase/client';
import { COUNTRY_NAMES } from '@/lib/format';
import { submitKyc, type KycInput } from '@/app/account/kyc/actions';
import { KYC_DOCS } from '@/components/account/kyc-docs';
import { ActionMessage, useRun, type ActionMsg } from '../../_services/action-kit';

type DocType = (typeof KYC_DOCS)[number]['type'];
export type KycDoc = { doc_type: string; file_name: string | null; storage_path: string; created_at: string };
export type KycValues = Omit<KycInput, 'consent'>;

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
  if (!/\.(pdf|jpe?g|png)$/i.test(f.name) || (f.type && !OK_TYPES.includes(f.type))) return 'Only PDF, JPG or PNG files are accepted.';
  if (f.size > MAX_BYTES) return 'File is larger than 10 MB.';
  return null;
}

/**
 * Verification (KYC) form in ODS — the same flow as today's components/account/kyc-form.tsx: TODAY's submitKyc action
 * (submit_kyc RPC + organisation profile fields), then the documents go from the browser to the private `kyc` bucket in the
 * company's folder and are recorded in kyc_documents (RLS: own org only). Modes: edit (new submission), docs (submitted but
 * required documents missing: upload only), locked (submitted / in review / verified).
 */
export function KycPanelForm({ mode, initial, existingDocs, latestSubmissionId, orgId }: { mode: 'edit' | 'docs' | 'locked'; initial: KycValues; existingDocs: KycDoc[]; latestSubmissionId: string | null; orgId: string }) {
  const { pending, msg, setMsg, run } = useRun();
  const [v, setV] = useState<KycValues>(initial);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<Partial<Record<DocType, File>>>({});
  const [fileErr, setFileErr] = useState<Partial<Record<DocType, string>>>({});
  const existing = useMemo(() => { const m = new Map<string, KycDoc>(); existingDocs.forEach((d) => { if (!m.has(d.doc_type)) m.set(d.doc_type, d); }); return m; }, [existingDocs]);
  const countries = useMemo(() => Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])), []);
  const types = v.businessType && !BUSINESS_TYPES.includes(v.businessType) ? [v.businessType, ...BUSINESS_TYPES] : BUSINESS_TYPES;
  const set = (k: keyof KycValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const detailsOff = mode !== 'edit' || pending;

  const pick = (t: DocType, f: File | undefined) => {
    setFileErr((p) => ({ ...p, [t]: undefined }));
    if (!f) { setFiles((p) => ({ ...p, [t]: undefined })); return; }
    const e = checkFile(f);
    if (e) { setFileErr((p) => ({ ...p, [t]: e })); setFiles((p) => ({ ...p, [t]: undefined })); return; }
    setFiles((p) => ({ ...p, [t]: f }));
  };
  async function uploadDocs(submissionId: string, org: string, carryOver: boolean) {
    const sb = createClient();
    const rows: { submission_id: string; org_id: string; doc_type: string; storage_path: string; file_name: string | null }[] = [];
    for (const d of KYC_DOCS) {
      const f = files[d.type];
      if (f) {
        const path = `${org}/${submissionId}/${d.type}-${Date.now().toString(36)}-${safeFileName(f.name)}`;
        const { error } = await sb.storage.from('kyc').upload(path, f, { contentType: f.type || undefined });
        if (error) throw new Error(`${d.label}: ${error.message}`);
        rows.push({ submission_id: submissionId, org_id: org, doc_type: d.type, storage_path: path, file_name: f.name });
      } else if (carryOver && existing.has(d.type)) {
        const old = existing.get(d.type)!;
        rows.push({ submission_id: submissionId, org_id: org, doc_type: d.type, storage_path: old.storage_path, file_name: old.file_name });
      }
    }
    if (rows.length) { const { error } = await sb.from('kyc_documents').insert(rows); if (error) throw new Error(error.message); }
  }
  const missing = () => KYC_DOCS.filter((d) => d.required && !files[d.type] && !existing.has(d.type));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'locked') return;
    const miss = missing();
    if (miss.length) { setMsg({ ok: false, text: `Please add: ${miss.map((d) => d.label).join(', ')}.` }); return; }
    if (mode === 'docs') {
      if (!latestSubmissionId) return;
      if (!Object.values(files).some(Boolean)) { setMsg({ ok: false, text: 'Choose at least one file to upload.' }); return; }
      run(async (): Promise<ActionMsg> => {
        try { await uploadDocs(latestSubmissionId, orgId, false); setFiles({}); return { ok: true, text: 'Documents uploaded. Our team will review them.' }; }
        catch (x) { return { ok: false, text: x instanceof Error ? x.message : 'Upload failed' }; }
      });
      return;
    }
    if (!consent) { setMsg({ ok: false, text: 'Please confirm the details and accept the Privacy Policy.' }); return; }
    run(async (): Promise<ActionMsg> => {
      const r = await submitKyc({ ...v, consent: true }, COUNTRY_NAMES[v.country] ?? v.country);
      if (!r.ok || !r.data) return { ok: false, text: r.ok ? 'Submission failed' : r.error };
      try { await uploadDocs(r.data.submission_id, r.data.org_id, true); setFiles({}); return { ok: true, text: 'Submitted for verification. We usually review within 1–2 business days.' }; }
      catch (x) { return { ok: true, text: `Your details were submitted, but a document failed to upload (${x instanceof Error ? x.message : 'error'}). You can add the missing documents below.` }; }
    });
  };

  const text = (k: keyof KycValues, label: string, o: { required?: boolean; type?: string; autoComplete?: string } = {}) => (
    <Field label={label} required={o.required} disabled={detailsOff}>
      <Input type={o.type ?? 'text'} value={v[k] ?? ''} onChange={set(k)} autoComplete={o.autoComplete} disabled={detailsOff} />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" data-testid="kyc-form" data-mode={mode}>
      <Card title="1 · Company" headingLevel={3}>
        <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
          {text('company', 'Legal company name', { required: true, autoComplete: 'organization' })}
          <Field label="Business type" required disabled={detailsOff}>
            <Select value={v.businessType} onChange={set('businessType')} disabled={detailsOff} placeholder="Choose…">
              {types.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          {text('regNo', 'Company registration number', { required: true })}
          {text('website', 'Website', { type: 'url', autoComplete: 'url' })}
        </div>
      </Card>
      <Card title="2 · Business address" headingLevel={3}>
        <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
          <Field label="Country" required disabled={detailsOff}>
            <Select value={v.country} onChange={set('country')} disabled={detailsOff} placeholder="Choose…" autoComplete="country">
              {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
          </Field>
          {text('region', 'State / province / region', { required: true, autoComplete: 'address-level1' })}
          {text('city', 'City', { required: true, autoComplete: 'address-level2' })}
          {text('postal', 'Postal code', { required: true, autoComplete: 'postal-code' })}
          {text('line1', 'Address line 1', { required: true, autoComplete: 'address-line1' })}
          {text('line2', 'Address line 2', { autoComplete: 'address-line2' })}
        </div>
      </Card>
      <Card title="3 · Contact person" headingLevel={3}>
        <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
          {text('contactName', 'Full name', { required: true, autoComplete: 'name' })}
          {text('contactEmail', 'Work email', { required: true, type: 'email', autoComplete: 'email' })}
          {text('contactPhone', 'Phone', { required: true, type: 'tel', autoComplete: 'tel' })}
        </div>
      </Card>
      <Card title="4 · Documents" headingLevel={3} description="PDF, JPG or PNG, up to 10 MB each. Stored privately; only our verification team sees them.">
        <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
          {KYC_DOCS.map((d) => {
            const have = existing.get(d.type);
            const off = mode === 'locked' || pending;
            return (
              <li key={d.type} className="flex flex-col gap-2 py-3">
                <Field label={d.label} required={d.required} optional={!d.required} hint={have ? `On file: ${have.file_name ?? 'document'}. Choose a file only to replace it.` : d.hint} error={fileErr[d.type]} disabled={off}>
                  <Input type="file" accept={ACCEPT} disabled={off} onChange={(e) => pick(d.type, e.target.files?.[0])} />
                </Field>
              </li>
            );
          })}
        </ul>
      </Card>
      {mode === 'edit' ? (
        <Checkbox checked={consent} onCheckedChange={setConsent} disabled={pending}
          label={<>I confirm these details are correct and accept the <Link href="/legal/privacy" target="_blank" className="font-semibold text-ods-blue underline">Privacy Policy</Link>.</>} />
      ) : null}
      <ActionMessage msg={msg} testId="kyc-message" />
      {mode !== 'locked' ? (
        <div><Button type="submit" loading={pending} loadingText="Sending…" data-testid="kyc-submit">{mode === 'docs' ? 'Upload documents' : 'Submit for verification'}</Button></div>
      ) : <p className="m-0 text-ods-small text-ods-slate">The form is locked while we review it or after you are verified. Contact support if your company details change.</p>}
    </form>
  );
}
