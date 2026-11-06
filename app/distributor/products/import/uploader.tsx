'use client';
import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createZipUpload, validateImport } from './actions';

/** Step 2 + 3 of the bulk upload: the workbook and (optional) images .zip → private Storage → validate. */
export function ImportUploader({ supplier = null }: { supplier?: string | null }) {
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!xlsx) return setErr('Choose the filled template (.xlsx).');
      if (zip && zip.size > 200 * 1024 * 1024) return setErr('The images .zip can be up to 200 MB.');
      setErr(null);
      start(async () => {
        let zipPath = '';
        if (zip) {
          setStep(`Uploading ${zip.name} (${(zip.size / 1048576).toFixed(1)} MB)…`);
          const up = await createZipUpload({ name: zip.name, size: zip.size });
          if (!up.ok) { setStep(null); return setErr(up.error ?? 'Upload could not start.'); }
          const { error } = await createClient().storage.from('imports').uploadToSignedUrl(up.data!.path, up.data!.token, zip, { contentType: 'application/zip' });
          if (error) { setStep(null); return setErr(`Upload of ${zip.name} failed: ${error.message}`); }
          zipPath = up.data!.path;
        }
        setStep('Checking every row, SKU and image…');
        const fd = new FormData(); fd.set('file', xlsx); if (zipPath) fd.set('zip_path', zipPath); if (supplier) fd.set('supplier', supplier);
        const r = await validateImport(fd);   // redirects to the report on success
        setStep(null);
        if (r && !r.ok) setErr(r.error ?? 'Could not check the file.');
      });
    }}>
      <label className="block">
        <span className="label">1 · Filled template (.xlsx, up to 2,000 rows)</span>
        <input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input py-2" onChange={(e) => setXlsx(e.target.files?.[0] ?? null)} />
      </label>
      <label className="block">
        <span className="label">2 · Upload images (.zip, optional)</span>
        <input type="file" name="zip" accept=".zip,application/zip" className="input py-2" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
        <span className="text-xs text-muted">Up to 200 MB · .jpg .jpeg .png .webp .avif, max 15 MB each · any folder structure · names matched case-insensitively.</span>
      </label>
      {step && <p role="status" className="text-sm text-blue font-semibold">{step}</p>}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Working…' : 'Upload and check'}</button>
    </form>
  );
}

