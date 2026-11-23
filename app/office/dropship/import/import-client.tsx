'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  previewDropshipCsv,
  commitDropshipCsv,
  type CsvPreviewResult,
} from '../actions';

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DropshipCsvImportClient() {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setMsg(null);
    startTransition(async () => {
      const res = await previewDropshipCsv(text);
      setPreview(res);
    });
  };

  const handlePreviewText = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await previewDropshipCsv(csvText);
      setPreview(res);
    });
  };

  const handleCommit = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await commitDropshipCsv(csvText);
      if (res.ok) {
        setMsg({
          ok: true,
          text: `Import complete: ${res.created} created (as Draft), ${res.updated} updated, ${res.unchanged} unchanged.`,
        });
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="space-y-6" data-testid="dropship-csv-import">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/office/dropship" className="text-[13.5px] text-coral-text font-semibold">
            ← Back to Dropshipping catalogue
          </Link>
          <h1 className="text-[28px] font-extrabold mt-1">CSV bulk import</h1>
          <p className="text-[14px] text-muted mt-1">
            Upsert on <span className="mono">octopus_sku</span> (running the same file twice changes nothing). Max 2,000 rows per file. No image URLs allowed; imported products stay <b>Draft</b> until photos are added in the form.
          </p>
        </div>
        <a
          href="/office/dropship/import/template"
          download="dropship-products-template.csv"
          className="btn btn-ghost min-h-11"
          data-testid="download-csv-template"
        >
          Download CSV template
        </a>
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          data-testid="csv-import-message"
          className={`card p-4 text-[14px] font-medium ${
            msg.ok ? 'bg-ok-bg text-ok border-ok' : 'bg-bad-bg text-bad border-bad'
          }`}
        >
          {msg.text}
        </div>
      )}

      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="btn btn-dark min-h-10 cursor-pointer">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="sr-only"
              data-testid="csv-file-input"
            />
          </label>
          <button
            type="button"
            disabled={pending || !csvText.trim()}
            onClick={handlePreviewText}
            className="btn btn-ghost min-h-10"
            data-testid="csv-preview-btn"
          >
            {pending ? 'Checking…' : 'Validate & preview'}
          </button>
        </div>

        <div>
          <label htmlFor="csv-raw" className="k block mb-1.5">
            Or paste CSV contents
          </label>
          <textarea
            id="csv-raw"
            rows={6}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="octopus_sku,title,description,category,weight_g,unit_cost_cents,min_order_qty,stock_status,stock_qty,source_type,supplier_code,supplier_sku,origin_country,specs_json"
            className="input font-mono text-[12.5px]"
            data-testid="csv-textarea"
          />
        </div>
      </section>

      {preview && (
        <section className="card overflow-hidden" data-testid="csv-preview-table">
          <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold">Validation preview</h2>
              <p className="text-[13px] text-muted">
                {preview.totalRows} rows · {preview.validRows} valid ·{' '}
                <span className={preview.errorRows > 0 ? 'text-bad font-bold' : ''}>
                  {preview.errorRows} with errors
                </span>
              </p>
            </div>
            {!preview.globalError && preview.totalRows > 0 && preview.errorRows === 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={handleCommit}
                className="btn btn-primary min-h-11"
                data-testid="csv-commit-btn"
              >
                {pending ? 'Importing…' : `Import ${preview.validRows} rows as Draft`}
              </button>
            )}
          </div>

          {preview.globalError ? (
            <div className="p-5 text-bad font-semibold text-[14px]" data-testid="csv-global-error">
              {preview.globalError}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="th">Row</th>
                    <th className="th">Octopus SKU</th>
                    <th className="th">Title (sanitised)</th>
                    <th className="th">Category</th>
                    <th className="th text-right">Weight</th>
                    <th className="th text-right">Unit cost</th>
                    <th className="th">Supplier</th>
                    <th className="th">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr
                      key={r.rowNumber}
                      className="border-b border-line"
                      data-testid="csv-preview-row"
                    >
                      <td className="td mono">{r.rowNumber}</td>
                      <td className="td mono font-semibold">{r.octopus_sku}</td>
                      <td className="td">{r.title}</td>
                      <td className="td">{r.category || '—'}</td>
                      <td className="td text-right tabular-nums">{r.weight_g} g</td>
                      <td className="td text-right tabular-nums">{usd(r.unit_cost_cents)}</td>
                      <td className="td mono">{r.supplier_code || r.source_type}</td>
                      <td className="td">
                        {r.errors.length === 0 ? (
                          <span className="pill bg-ok-bg text-ok">Valid (Draft)</span>
                        ) : (
                          <ul className="text-bad font-medium space-y-0.5" data-testid="csv-row-errors">
                            {r.errors.map((err, i) => (
                              <li key={i}>• {err}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
