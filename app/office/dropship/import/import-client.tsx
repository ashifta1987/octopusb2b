'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DsIcon } from '@/components/dropship-ui';
import { sanitiseCsvCellClient } from './csv-client-util';
import {
  previewDropshipCsv,
  commitDropshipCsv,
  createDropshipFromSourcingAction,
  uploadDropshipBatchImages,
  type CsvPreviewResult,
  type SourcingCandidateOption,
} from '../actions';

export type ImportJobSummary = {
  id: string;
  job_code: string;
  source_type: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  error_count: number;
  created_at: string;
};

type CommitSummary = {
  job_code: string;
  created: number;
  updated: number;
  unchanged: number;
  skippedErrors: number;
  createdModelNos: string[];
};

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DropshipCsvImportClient({
  candidates,
  recentJobs,
  canSeeCosts,
}: {
  candidates: SourcingCandidateOption[];
  recentJobs: ImportJobSummary[];
  canSeeCosts: boolean;
}) {
  const router = useRouter();
  const [sourceMode, setSourceMode] = useState<'csv' | 'sourcing' | 'one'>('csv');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitSummary | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [batchImgMsg, setBatchImgMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentStep = commitResult ? 5 : preview ? 3 : csvText.trim() ? 2 : 1;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCommitResult(null);
    setMsg(null);
    if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes('csv') && !file.type.includes('text')) {
      setPreview({
        totalRows: 0,
        validRows: 0,
        newReadyRows: 0,
        updateRows: 0,
        unchangedRows: 0,
        errorRows: 0,
        warningRows: 0,
        headers: [],
        columnMappings: [],
        rows: [],
        globalError: 'Use the CSV template. Only .csv files up to 2,000 rows can be imported.',
      });
      return;
    }
    const text = await file.text();
    setCsvText(text);
    startTransition(async () => {
      const res = await previewDropshipCsv(text);
      setPreview(res);
    });
  };

  const handlePreviewText = () => {
    setMsg(null);
    setCommitResult(null);
    startTransition(async () => {
      const res = await previewDropshipCsv(csvText);
      setPreview(res);
    });
  };

  const handleCommit = (allowSkipErrors = false) => {
    setMsg(null);
    startTransition(async () => {
      const res = await commitDropshipCsv(csvText, {
        fileName: fileName ?? 'pasted-import.csv',
        allowSkipErrors,
      });
      if (res.ok) {
        setCommitResult({
          job_code: res.job_code,
          created: res.created,
          updated: res.updated,
          unchanged: res.unchanged,
          skippedErrors: res.skippedErrors,
          createdModelNos: res.createdModelNos,
        });
        setMsg({
          ok: true,
          text: `Import complete (${res.job_code}): ${res.created} created (as Draft), ${res.updated} updated, ${res.unchanged} unchanged.`,
        });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  const handleDownloadErrorsCsv = () => {
    if (!preview) return;
    const errRows = preview.rows.filter((r) => r.errors.length > 0);
    if (errRows.length === 0) return;
    const lines = [
      'row_number,title,errors',
      ...errRows.map((r) =>
        [
          String(r.rowNumber),
          `"${sanitiseCsvCellClient(r.title).replace(/"/g, '""')}"`,
          `"${sanitiseCsvCellClient(r.errors.join(' | ')).replace(/"/g, '""')}"`,
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dropship-import-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadReport = () => {
    if (!commitResult) return;
    const lines = [
      'job_code,created_drafts,updated,unchanged,skipped_errors,created_ds_models',
      [
        commitResult.job_code,
        commitResult.created,
        commitResult.updated,
        commitResult.unchanged,
        commitResult.skippedErrors,
        `"${commitResult.createdModelNos.join(' ')}"`,
      ].join(','),
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${commitResult.job_code.toLowerCase()}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBatchImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadingBatch(true);
    setBatchImgMsg(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(fileList)) {
        fd.append('files', f);
      }
      const res = await uploadDropshipBatchImages(fd);
      if (res.ok) {
        setBatchImgMsg({
          ok: true,
          text: `Matched ${res.matchedFiles} image(s) across ${res.updatedProductCount} product(s). Stored with random UUID file names and EXIF stripped.${
            res.unmatchedFiles > 0 ? ` (${res.unmatchedFiles} unmatched)` : ''
          }${res.rejectedFiles.length > 0 ? ` · Rejected: ${res.rejectedFiles.join(', ')}` : ''}`,
        });
      } else {
        setBatchImgMsg({ ok: false, text: res.error });
      }
    } finally {
      setUploadingBatch(false);
      e.target.value = '';
    }
  };

  const handleCreateFromSourcing = (cand: SourcingCandidateOption) => {
    setMsg(null);
    startTransition(async () => {
      const res = await createDropshipFromSourcingAction({
        supplierProductId: cand.supplier_product_id,
        rfqId: cand.rfq_id,
      });
      if (res.ok) {
        router.push(`/office/dropship/${res.product_id}`);
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="space-y-5" data-testid="dropship-csv-import">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/office/dropship"
            className="text-[13px] font-semibold text-[#2A6FD1] hover:underline"
          >
            ← Back to Dropshipping catalogue
          </Link>
          <h1 className="m-0 mt-1 text-[26px] font-bold flex items-center gap-3 flex-wrap text-[#1A174A]">
            <span
              data-page-icon=""
              aria-hidden="true"
              className="w-10 h-10 rounded-[10px] bg-[#E6EFFB] text-[#2A6FD1] inline-flex items-center justify-center shrink-0"
            >
              <DsIcon name="upload" size={20} strokeWidth={2} />
            </span>
            <span>Import products</span>
          </h1>
          <p className="m-0 mt-1.5 text-[14px] text-[#5B6478]">
            Add products to the dropship catalogue from a CSV file, from a Sourcing item, or one at
            a time. Everything lands as a draft.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <a
            href="/office/dropship/import/template"
            download="dropship-products-template.csv"
            className="ds-btn ds-btn-secondary"
            data-testid="download-csv-template"
          >
            <DsIcon name="download" size={16} />
            Download CSV template
          </a>
          {canSeeCosts && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="ds-btn ds-btn-secondary"
              data-testid="toggle-import-history-btn"
            >
              <DsIcon name="clock" size={16} />
              Import history ({recentJobs.length})
            </button>
          )}
        </div>
      </header>

      {/* Import history drawer */}
      {canSeeCosts && showHistory && (
        <section className="card p-0 overflow-hidden" data-testid="import-history-panel">
          <div className="px-5 py-3.5 border-b border-[#E3E7EF]">
            <h2 className="m-0 text-[16px] font-bold">Recent import jobs</h2>
          </div>
          {recentJobs.length === 0 ? (
            <p className="p-5 m-0 text-[14px] text-[#5B6478]">No import jobs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent import jobs">
              <table className="ds-tbl min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Source</th>
                    <th scope="col">Created</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Unchanged</th>
                    <th scope="col">Errors</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="mono font-semibold">{j.job_code}</td>
                      <td className="uppercase text-[12px] text-[#5B6478]">{j.source_type}</td>
                      <td className="tabular-nums">{j.created_count}</td>
                      <td className="tabular-nums">{j.updated_count}</td>
                      <td className="tabular-nums">{j.unchanged_count}</td>
                      <td className="tabular-nums">{j.error_count}</td>
                      <td>
                        <span className="ds-badge ds-badge-ok capitalize">{j.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 5-step progress indicator */}
      <section className="card p-4" aria-label="Import steps">
        <ol className="list-none m-0 p-0 flex items-center gap-2 flex-wrap">
          {[
            [1, 'Source'],
            [2, 'Map columns'],
            [3, 'Check'],
            [4, 'Images'],
            [5, 'Result'],
          ].map(([num, label], idx) => {
            const stepNum = num as number;
            const done = stepNum < currentStep;
            const active = stepNum === currentStep;
            return (
              <li key={stepNum} className="contents">
                {idx > 0 && (
                  <span
                    aria-hidden="true"
                    className="flex-[1_1_20px] min-w-[14px] h-[2px] bg-[#E3E7EF]"
                  />
                )}
                <span
                  className={`flex items-center gap-2 text-[14px] ${
                    active
                      ? 'font-semibold text-[#1A174A]'
                      : done
                        ? 'font-medium text-[#1A174A]'
                        : 'font-medium text-[#5B6478]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 ${
                      done
                        ? 'bg-[#0B7A75] text-white'
                        : active
                          ? 'bg-[#2A6FD1] text-white'
                          : 'border-2 border-[#C9D0DD] text-[#5B6478]'
                    }`}
                  >
                    {stepNum}
                  </span>
                  {label as string}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Commit / action status message */}
      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          data-testid="csv-import-message"
          className={`rounded-[12px] px-4 py-3.5 text-[14px] font-medium border ${
            msg.ok
              ? 'bg-[#F1FAF8] border-[#B9E2DC] text-[#0B7A75]'
              : 'bg-[#FEF4F4] border-[#F2C4C2] text-[#B42318]'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* States-Staff.html: "Nothing changed" banner when re-running identical file */}
      {commitResult &&
        commitResult.created === 0 &&
        commitResult.updated === 0 &&
        commitResult.unchanged > 0 && (
          <div
            role="status"
            data-testid="csv-nothing-changed-banner"
            className="rounded-[12px] border border-[#B9E2DC] bg-[#F1FAF8] px-4 py-3.5"
          >
            <strong className="text-[14px] text-[#1A174A]">Nothing changed</strong>
            <p className="m-0 mt-1 text-[13px] text-[#5B6478]">
              All {commitResult.unchanged}{' '}
              {commitResult.unchanged === 1 ? 'row matches' : 'rows match'} what&apos;s already
              imported. No duplicates were created.
            </p>
          </div>
        )}

      {/* Step 1 · Choose a source */}
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
            <DsIcon name="layers" size={18} className="text-[#2A6FD1]" />
            <span>Step 1 · Choose a source</span>
          </h2>
        </div>

        <fieldset className="border-0 m-0 p-0 grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Import source</legend>
          <label
            className={`flex flex-col gap-1.5 rounded-[12px] p-4 text-[14px] cursor-pointer ${
              sourceMode === 'csv'
                ? 'border-2 border-[#2A6FD1] bg-[#F8FAFF]'
                : 'border border-[#C9D0DD]'
            }`}
          >
            <span className="flex items-center gap-2.5 font-bold">
              <input
                type="radio"
                name="src_mode"
                checked={sourceMode === 'csv'}
                onChange={() => setSourceMode('csv')}
              />
              CSV file
            </span>
            <span className="text-[13px] text-[#5B6478]">
              Up to 2,000 rows. Matched on the Sourcing model no.
            </span>
          </label>

          <label
            className={`flex flex-col gap-1.5 rounded-[12px] p-4 text-[14px] cursor-pointer ${
              sourceMode === 'sourcing'
                ? 'border-2 border-[#2A6FD1] bg-[#F8FAFF]'
                : 'border border-[#C9D0DD]'
            }`}
          >
            <span className="flex items-center gap-2.5 font-bold">
              <input
                type="radio"
                name="src_mode"
                checked={sourceMode === 'sourcing'}
                onChange={() => {
                  setSourceMode('sourcing');
                  document
                    .getElementById('sourcing-items-table')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
              From a Sourcing item
            </span>
            <span className="text-[13px] text-[#5B6478]">
              Approved items and accepted merchant requests
            </span>
          </label>

          <label
            className={`flex flex-col gap-1.5 rounded-[12px] p-4 text-[14px] cursor-pointer ${
              sourceMode === 'one'
                ? 'border-2 border-[#2A6FD1] bg-[#F8FAFF]'
                : 'border border-[#C9D0DD]'
            }`}
          >
            <span className="flex items-center gap-2.5 font-bold">
              <input
                type="radio"
                name="src_mode"
                checked={sourceMode === 'one'}
                onChange={() => {
                  setSourceMode('one');
                  router.push('/office/dropship/new');
                }}
              />
              One product
            </span>
            <span className="text-[13px] text-[#5B6478]">Open an empty product form</span>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label className="ds-btn ds-btn-primary cursor-pointer">
              <DsIcon name="upload" size={16} />
              {fileName ? 'Replace CSV file' : 'Choose CSV file'}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="sr-only"
                data-testid="csv-file-input"
              />
            </label>
            {fileName && (
              <span className="text-[13.5px] font-semibold text-[#1A174A]">{fileName}</span>
            )}
          </div>

          <button
            type="button"
            disabled={pending || !csvText.trim()}
            onClick={handlePreviewText}
            className="ds-btn ds-btn-secondary"
            data-testid="csv-preview-btn"
          >
            {pending ? 'Checking…' : 'Validate & preview'}
          </button>
        </div>

        <div>
          <label htmlFor="csv-raw" className="ds-label">
            Or paste CSV contents
          </label>
          <textarea
            id="csv-raw"
            rows={5}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="src_model_no,product_title,description,category,weight_g,l_cm,w_cm,h_cm,hs,origin,battery,liquid,magnet,powder,color,size,min_order_qty"
            className="ds-input w-full font-mono text-[12.5px] !py-2.5"
            data-testid="csv-textarea"
          />
        </div>
      </section>

      {/* Step 2 · Map columns */}
      {preview && !preview.globalError && preview.columnMappings.length > 0 && (
        <section className="card p-0 overflow-hidden" data-testid="csv-column-map">
          <div className="px-5 py-4 border-b border-[#E3E7EF] flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
              <DsIcon name="layers" size={18} className="text-[#2A6FD1]" />
              <span>Step 2 · Map columns</span>
            </h2>
            <span className="ds-badge ds-badge-ok">
              <DsIcon name="check" size={12} strokeWidth={2.2} />
              Matched
            </span>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Column mappings">
            <table className="ds-tbl min-w-[680px]">
              <thead>
                <tr>
                  <th scope="col">Column in your file</th>
                  <th scope="col">Octopus field</th>
                  <th scope="col">Rule</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.columnMappings.map((cm, idx) => (
                  <tr key={`${cm.fileColumn}-${idx}`}>
                    <td className="mono">{cm.fileColumn}</td>
                    <td>{cm.octopusField}</td>
                    <td className="text-[#5B6478]">{cm.rule}</td>
                    <td>
                      {cm.status === 'matched' ? (
                        <span className="ds-badge ds-badge-ok">
                          <DsIcon name="check" size={12} strokeWidth={2.2} />
                          Matched
                        </span>
                      ) : cm.status === 'warning' ? (
                        <span className="ds-badge ds-badge-warn">
                          <DsIcon name="alert" size={12} strokeWidth={2.2} />
                          Check
                        </span>
                      ) : (
                        <span className="ds-badge ds-badge-neutral">Ignored</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-[#E3E7EF] text-[13px] text-[#5B6478]">
            Cost and supplier are never read from the file: they come from the Sourcing item linked
            by the model no., so prices can&apos;t be typed wrong.
          </div>
        </section>
      )}

      {/* Step 3 · Check */}
      {preview && (
        <section className="card p-5 space-y-4" data-testid="csv-preview-table">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
                <DsIcon name="check" size={18} className="text-[#2A6FD1]" />
                <span>Step 3 · Check</span>
              </h2>
              <p className="m-0 mt-1 text-[13px] text-[#5B6478]">
                Nothing is saved yet. Rows with errors are skipped; imported items always start as
                Draft.
              </p>
            </div>
          </div>

          {/* States-Staff.html: Wrong file / > 2,000 rows state */}
          {preview.globalError ? (
            <div
              role="status"
              data-testid="csv-global-error"
              className="flex flex-wrap items-center justify-between gap-3.5 rounded-[12px] border border-[#F2C4C2] bg-[#FEF4F4] px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <strong className="text-[14px] text-[#1A174A]">
                  This file can&apos;t be imported
                </strong>
                <p className="m-0 mt-1 text-[13px] text-[#5B6478]">{preview.globalError}</p>
              </div>
              <a
                href="/office/dropship/import/template"
                download="dropship-products-template.csv"
                className="ds-btn ds-btn-secondary"
              >
                <DsIcon name="download" size={16} />
                Download template
              </a>
            </div>
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
                  <div className="text-[24px] font-bold">{preview.newReadyRows}</div>
                  <span className="ds-badge ds-badge-ok">New, ready</span>
                </div>
                <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
                  <div className="text-[24px] font-bold">{preview.updateRows}</div>
                  <span className="ds-badge ds-badge-info">Updates to existing</span>
                </div>
                <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
                  <div className="text-[24px] font-bold">{preview.errorRows}</div>
                  <span className="ds-badge ds-badge-bad">Errors, won&apos;t import</span>
                </div>
                <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
                  <div className="text-[24px] font-bold">{preview.warningRows}</div>
                  <span className="ds-badge ds-badge-warn">With warnings</span>
                </div>
              </div>

              {pending && (
                <div
                  role="progressbar"
                  aria-label="Import progress"
                  className="rounded-[10px] border border-[#E3E7EF] bg-[#F9FAFC] p-3.5"
                >
                  <div className="h-2.5 rounded-full bg-[#EEF0F4] overflow-hidden">
                    <div className="h-2.5 w-2/3 bg-[#2A6FD1] animate-pulse rounded-full" />
                  </div>
                  <p className="m-0 mt-2 text-[13px] text-[#5B6478]">
                    Saving {preview.validRows} draft rows…
                  </p>
                </div>
              )}

              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Validation preview">
                <table className="ds-tbl min-w-[760px]">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      {canSeeCosts && <th scope="col">Match key (staff)</th>}
                      <th scope="col">Title (sanitised)</th>
                      <th scope="col">Category</th>
                      <th scope="col" className="text-right">
                        Weight
                      </th>
                      {canSeeCosts && (
                        <>
                          <th scope="col" className="text-right">
                            Sourcing cost
                          </th>
                          <th scope="col">Sourcing link</th>
                        </>
                      )}
                      <th scope="col">Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} data-testid="csv-preview-row">
                        <td className="mono">{r.rowNumber}</td>
                        {canSeeCosts && (
                          <td className="mono font-semibold">{r.import_ref}</td>
                        )}
                        <td>{r.title}</td>
                        <td>{r.category || '—'}</td>
                        <td className="text-right tabular-nums">{r.weight_g} g</td>
                        {canSeeCosts && (
                          <>
                            <td className="text-right tabular-nums">
                              {r.unit_cost_cents > 0 ? usd(r.unit_cost_cents) : '—'}
                            </td>
                            <td className="mono">{r.sourcing_sku || r.source_type}</td>
                          </>
                        )}
                        <td>
                          {r.errors.length === 0 ? (
                            <div className="space-y-1">
                              <span
                                className={`ds-badge ${
                                  r.existing_model_no ? 'ds-badge-info' : 'ds-badge-ok'
                                }`}
                              >
                                {r.existing_model_no
                                  ? `Update (${r.existing_model_no})`
                                  : 'Valid (Draft)'}
                              </span>
                              {r.warnings.map((w, idx) => (
                                <div key={idx} className="text-[12px] text-[#B54708]">
                                  Warning: {w}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <ul
                              className="list-none m-0 p-0 text-[#B42318] text-[12.5px] font-medium space-y-0.5"
                              data-testid="csv-row-errors"
                            >
                              {r.errors.map((err, idx) => (
                                <li key={idx}>• {err}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-1">
                {preview.validRows > 0 && preview.errorRows === 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleCommit(false)}
                    className="ds-btn ds-btn-primary"
                    data-testid="csv-commit-btn"
                  >
                    <DsIcon name="upload" size={16} />
                    {pending
                      ? 'Importing…'
                      : `Import ${preview.validRows} rows as Draft`}
                  </button>
                )}
                {preview.validRows > 0 && preview.errorRows > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleCommit(true)}
                    className="ds-btn ds-btn-primary"
                    data-testid="csv-commit-good-rows-btn"
                  >
                    <DsIcon name="upload" size={16} />
                    {pending
                      ? 'Importing…'
                      : `Import the ${preview.validRows} good rows as Draft`}
                  </button>
                )}
                {preview.errorRows > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadErrorsCsv}
                    className="ds-btn ds-btn-secondary"
                    data-testid="download-errors-csv-btn"
                  >
                    <DsIcon name="download" size={16} />
                    Download errors as CSV
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* Step 4 · Images (multi-file upload -> EXIF stripped, re-encoded, random UUID filename) */}
      <section className="card p-5 space-y-3.5" data-testid="csv-images-step">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
            <DsIcon name="image" size={18} className="text-[#2A6FD1]" />
            <span>Step 4 · Images</span>
          </h2>
        </div>
        <p className="m-0 text-[14px] text-[#5B6478]">
          Images aren&apos;t in the CSV. Upload image files named after the Sourcing model no. or
          DS model no. (for example <span className="mono">DS-000001-1.jpg</span>). Each file is
          verified by magic bytes (JPG/PNG/WebP ≤ 5 MB), EXIF stripped, and saved under a random
          UUID file name.
        </p>

        <label className="block rounded-[12px] border-2 border-dashed border-[#C9D0DD] p-5 text-center text-[14px] cursor-pointer hover:border-[#2A6FD1] bg-[#FAFBFD]">
          <span className="font-semibold text-[#2A6FD1]">
            {uploadingBatch ? 'Processing images…' : 'Choose product image files'}
          </span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={handleBatchImages}
            disabled={uploadingBatch}
            className="sr-only"
            data-testid="batch-images-input"
          />
        </label>

        {batchImgMsg && (
          <div
            role={batchImgMsg.ok ? 'status' : 'alert'}
            className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium border ${
              batchImgMsg.ok
                ? 'bg-[#F1FAF8] border-[#B9E2DC] text-[#0B7A75]'
                : 'bg-[#FEF4F4] border-[#F2C4C2] text-[#B42318]'
            }`}
            data-testid="batch-images-message"
          >
            {batchImgMsg.text}
          </div>
        )}
      </section>

      {/* Step 5 · Result (after import) */}
      {commitResult && (
        <section className="card p-5 space-y-4" data-testid="csv-result-step">
          <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
            <DsIcon name="chart" size={18} className="text-[#2A6FD1]" />
            <span>Step 5 · Result ({commitResult.job_code})</span>
          </h2>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
              <div className="text-[24px] font-bold">{commitResult.created}</div>
              <div className="text-[12.5px] text-[#5B6478]">Drafts created</div>
            </div>
            <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
              <div className="text-[24px] font-bold">{commitResult.updated}</div>
              <div className="text-[12.5px] text-[#5B6478]">Updated</div>
            </div>
            <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
              <div className="text-[24px] font-bold">{commitResult.unchanged}</div>
              <div className="text-[12.5px] text-[#5B6478]">Unchanged</div>
            </div>
            <div className="rounded-[10px] border border-[#E3E7EF] p-3.5 text-center">
              <div className="text-[24px] font-bold">{commitResult.skippedErrors}</div>
              <div className="text-[12.5px] text-[#5B6478]">Skipped with errors</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link href="/office/dropship?view=drafts" className="ds-btn ds-btn-primary">
              <DsIcon name="arrow" size={16} />
              Open the drafts
            </Link>
            <button
              type="button"
              onClick={handleDownloadReport}
              className="ds-btn ds-btn-secondary"
              data-testid="download-import-report-btn"
            >
              <DsIcon name="download" size={16} />
              Download import report
            </button>
          </div>
        </section>
      )}

      {/* Or: from a Sourcing item (Corrections 1, 4, 5, 7) */}
      {canSeeCosts && (
        <section
          id="sourcing-items-table"
          className="card p-0 overflow-hidden"
          data-testid="sourcing-import-section"
        >
          <div className="px-5 py-4 border-b border-[#E3E7EF]">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
              <DsIcon name="package" size={18} className="text-[#2A6FD1]" />
              <span>Or: from a Sourcing item</span>
            </h2>
          </div>

          {candidates.length === 0 ? (
            <p className="p-5 m-0 text-[14px] text-[#5B6478]">
              No Sourcing items available yet.
            </p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sourcing items">
              <table className="ds-tbl min-w-[820px]">
                <thead>
                  <tr>
                    <th scope="col">Sourcing item</th>
                    <th scope="col">Supplier (staff only)</th>
                    <th scope="col">Cost</th>
                    <th scope="col">For</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 25).map((cand) => (
                    <tr key={cand.supplier_product_id} data-testid="sourcing-candidate-row">
                      <td>
                        <div className="font-medium text-[#1A174A]">
                          {cand.rfq_code ? `${cand.rfq_code} · ` : ''}
                          {cand.sourcing_title}
                        </div>
                        {cand.sourcing_sku && (
                          <div className="text-[12px] text-[#5B6478] mono">
                            {cand.sourcing_sku}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>
                            {cand.supplier_code ? `${cand.supplier_code} · ` : ''}
                            {cand.supplier_name}
                          </span>
                          {cand.supplier_verified ? (
                            <span className="ds-badge ds-badge-ok">
                              <DsIcon name="check" size={12} strokeWidth={2.2} />
                              Verified
                            </span>
                          ) : (
                            <span className="ds-badge ds-badge-bad">
                              <DsIcon name="stop" size={12} strokeWidth={2.2} />
                              Not verified
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="tabular-nums font-semibold">
                        {cand.unit_cost_cents > 0 ? usd(cand.unit_cost_cents) : '—'}
                      </td>
                      <td>
                        {cand.for_org_name ? (
                          <span className="ds-badge ds-badge-info">
                            {cand.for_org_name} only (accepted quote)
                          </span>
                        ) : (
                          'All merchants'
                        )}
                      </td>
                      <td>
                        {!cand.supplier_verified ? (
                          <button
                            type="button"
                            disabled
                            className="ds-btn ds-btn-secondary !min-h-[38px]"
                            data-testid="sourcing-unverified-btn"
                          >
                            Supplier not verified
                          </button>
                        ) : cand.existing_dropship_product_id ? (
                          <Link
                            href={`/office/dropship/${cand.existing_dropship_product_id}`}
                            className="ds-btn ds-btn-secondary !min-h-[38px]"
                          >
                            Open {cand.existing_dropship_model_no}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleCreateFromSourcing(cand)}
                            className="ds-btn ds-btn-secondary !min-h-[38px]"
                            data-testid="create-from-sourcing-btn"
                          >
                            <DsIcon name="plus" size={16} />
                            Create dropship product
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-5 py-3 border-t border-[#E3E7EF] text-[13px] text-[#5B6478]">
            Creates a draft with a new DS model number, reusing the Sourcing item&apos;s physical
            item master unit. Cost and supplier stay owned by Sourcing.
          </div>
        </section>
      )}
    </div>
  );
}
