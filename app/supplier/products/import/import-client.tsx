'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsButton, DsCard, DsLinkButton, DsNotice, DsPageHeader, DsStepper, DsTableCard } from '@/components/dropship-ui';
import { MAX_BULK_ROWS, TEMPLATE_COLUMNS, parseBulkCsv } from '@/lib/dropship-ds14-shared';
import type { BulkResult } from '@/lib/dropship-ds14';
import { bulkAction } from '../../actions';
import { SupplierFrame } from '../../frame';

export function ImportClient() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [res, setRes] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const step = done ? 5 : res ? (res.problems.length ? 4 : 5) : rows ? 3 : 1;

  const onFile = async (file: File | undefined) => {
    setErr(null); setRes(null); setRows(null); setDone(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setErr('Save your spreadsheet as CSV (File › Save as › CSV) and choose that file. Excel files are not read here.'); return; }
    const parsed = parseBulkCsv(await file.text());
    if (parsed.error) { setErr(parsed.error); return; }
    setName(file.name);
    setRows(parsed.rows);
    start(async () => {
      const r = await bulkAction(parsed.rows, file.name, false);
      if (!r.ok) { setErr(r.message); return; }
      setRes(r.data);
    });
  };
  const submit = () => start(async () => {
    if (!rows) return;
    const r = await bulkAction(rows, name, true);
    if (!r.ok) { setErr(r.message); return; }
    setDone(`${r.data.good_rows} good row${r.data.good_rows === 1 ? '' : 's'} sent for review.`);
    router.refresh();
  });

  return (
    <SupplierFrame testId="supplier-import-page">
      <DsPageHeader title="Bulk upload" subtitle="Create products from a spreadsheet." icon="upload" actions={<DsLinkButton href="/supplier" variant="secondary" icon="arrow">Back to products</DsLinkButton>} />
      <DsStepper ariaLabel="Bulk upload steps" steps={['Download template', 'Fill it in', 'Upload', 'Fix errors', 'Submit'].map((label, i) => ({ label, state: i + 1 < step ? 'done' : i + 1 === step ? 'current' : 'upcoming' }))} />
      <DsCard title="Upload a spreadsheet" subtitle={`CSV, up to ${MAX_BULK_ROWS} rows`} icon="upload">
        <div className="flex flex-wrap gap-3 items-center">
          <DsLinkButton href="/supplier/products/import/template" variant="secondary" icon="download">Download template</DsLinkButton>
          <label className="ds-btn ds-btn-primary cursor-pointer min-h-[44px] inline-flex items-center gap-2">
            Choose file
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a CSV file" data-testid="supplier-import-file" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {name && <span className="text-[14px]" data-testid="supplier-import-name">{name}</span>}
        </div>
        <p className="text-[12px] text-muted mt-3 mb-0">Several rows with the same model number become one product with several variants. Image links are separated with |.</p>
      </DsCard>
      {err && <DsNotice tone="bad" title="The file could not be read" testId="supplier-import-error">{err}</DsNotice>}
      {pending && <DsNotice tone="info" title="Checking your file">One moment.</DsNotice>}
      {res && (
        <>
          <DsNotice tone={res.problems.length ? 'warn' : 'ok'} title={`${res.total_rows} rows checked`} testId="supplier-import-summary">
            {res.problems.length ? `${new Set(res.problems.map((p) => p.row)).size} rows have problems. Fix them and upload again, or submit the ${res.good_rows} good rows.` : `All ${res.good_rows} rows are good.`}
          </DsNotice>
          {res.problems.length > 0 && (
            <DsTableCard title="Check results" headers={['Row', 'Problem']} minWidth={420} testId="supplier-import-problems">
              {res.problems.map((p, i) => <tr key={i}><td>{p.row}</td><td>{p.problem}</td></tr>)}
            </DsTableCard>
          )}
          <div className="flex gap-2 flex-wrap">
            <DsButton onClick={submit} loading={pending} disabled={res.good_rows === 0 || !!done} disabledReason={res.good_rows === 0 ? 'No row is good yet' : done ? 'Already submitted' : undefined} icon="send" testId="supplier-import-submit">
              Submit {res.good_rows} good row{res.good_rows === 1 ? '' : 's'}
            </DsButton>
            <DsButton variant="secondary" onClick={() => { setRes(null); setRows(null); setName(''); if (input.current) input.current.value = ''; }}>Cancel</DsButton>
          </div>
        </>
      )}
      {done && <DsNotice tone="ok" title="Sent for review" testId="supplier-import-done">{done} You get an email when it is approved or when we need changes.</DsNotice>}
      <DsCard title="Template columns"><p className="m-0 text-[14px] text-muted">{TEMPLATE_COLUMNS.map(([, h]) => h).join(', ')}.</p></DsCard>
    </SupplierFrame>
  );
}
