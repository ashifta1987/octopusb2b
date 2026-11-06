'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { createImportUploads, stageImportRun } from './actions';

/** Step 1 of the bulk-import wizard: name, price validity, XLSX + optional image ZIP → private Storage → parse. */
export function ImportUploadForm({ defaultValidFrom }: { defaultValidFrom: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const xlsx = fd.get('xlsx') as File | null;
        const zip = fd.get('zip') as File | null;
        const name = String(fd.get('name') ?? '');
        const validFrom = String(fd.get('valid_from') ?? '');
        if (!xlsx || !xlsx.size) return setErr('Choose the supplier workbook (.xlsx).');
        setErr(null);
        start(async () => {
          const files = [{ name: xlsx.name, size: xlsx.size, kind: 'xlsx' as const }, ...(zip && zip.size ? [{ name: zip.name, size: zip.size, kind: 'zip' as const }] : [])];
          setStep('Preparing upload…');
          const up = await createImportUploads(files);
          if (!up.ok) { setStep(null); return setErr(up.error); }
          const sb = createClient();
          for (const u of up.uploads) {
            const file = u.kind === 'xlsx' ? xlsx : zip!;
            setStep(`Uploading ${file.name}…`);
            const { error } = await sb.storage.from('imports').uploadToSignedUrl(u.path, u.token, file, { contentType: file.type || undefined });
            if (error) { setStep(null); return setErr(`Upload of ${file.name} failed: ${error.message}`); }
          }
          setStep('Reading the workbook and checking every row…');
          const r = await stageImportRun({ name, validFrom, xlsxPath: up.uploads.find((u) => u.kind === 'xlsx')!.path, zipPath: up.uploads.find((u) => u.kind === 'zip')?.path ?? null });
          setStep(null);
          if (!r.ok) return setErr(r.error);
          router.push(`/admin/import/${r.runId}`);
        });
      }}
    >
      <div className="sm:col-span-2">
        <label htmlFor="im-name" className="label">Import name</label>
        <input id="im-name" name="name" required minLength={3} maxLength={120} className="input" placeholder="Bowijie 2026-11 catalogue" />
      </div>
      <div>
        <label htmlFor="im-xlsx" className="label">Supplier workbook (.xlsx, max 50 MB)</label>
        <input id="im-xlsx" name="xlsx" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input py-2" />
        <p className="text-xs text-muted mt-1">One “Supplier” sheet plus one sheet per category with “Product Id” in cell A1.</p>
      </div>
      <div>
        <label htmlFor="im-zip" className="label">Product photos (.zip, optional)</label>
        <input id="im-zip" name="zip" type="file" accept=".zip,application/zip" className="input py-2" />
        <p className="text-xs text-muted mt-1">File names must match the “Image file” column.</p>
      </div>
      <div>
        <label htmlFor="im-valid" className="label">Supplier prices valid from</label>
        <input id="im-valid" name="valid_from" type="date" required defaultValue={defaultValidFrom} className="input" />
        <p className="text-xs text-muted mt-1">Valid-to is set from the default validity in settings.</p>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Working…' : 'Upload and preview'}</button>
        {step && <span role="status" className="text-sm text-muted">{step}</span>}
        {err && <span role="alert" className="text-sm text-bad">{err}</span>}
      </div>
      <p className="sm:col-span-2 text-xs text-muted">Nothing is written to the catalogue until you review the preview and press Commit. Every new product is a draft.</p>
    </form>
  );
}

