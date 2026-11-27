'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTableCard } from '@/components/dropship-ui';
import { ORDER_FIELDS, ORDERS_CSV_MAX_BYTES, ORDERS_CSV_TEMPLATE, guessColumns, missingRequired, parseOrdersCsv, type ColumnMap, type OrderField } from '@/lib/connectors/csv';
import { minorToDecimal } from '@/lib/connectors/formats';
import { splitCsv } from '@/lib/warehouse-orders';
import { fmtDateTime } from '@/lib/dropship-ds12-shared';
import type { FilePage, ImportResult } from '@/lib/dropship-c0';
import { importOrdersCsvAction } from '../c0-actions';

const rowsText = (rows: number[]) => (rows.length ? `Row${rows.length > 1 ? 's' : ''} ${rows.join(', ')}` : 'File');

export function FileClient({ data }: { data: FilePage }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => new Date(new Date().getTime() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  const header = useMemo(() => (file ? (splitCsv(file.text.replace(/^\ufeff/, ''))[0] ?? []).map((h) => h.trim()) : []), [file]);
  const preview = useMemo(() => (file ? parseOrdersCsv(file.text, map) : null), [file, map]);
  const missing = missingRequired(map);

  const pick = async (f: File | undefined) => {
    setFileErr(null); setResult(null); setActionErr(null); setFile(null);
    if (!f) return;
    if (f.size > ORDERS_CSV_MAX_BYTES) { setFileErr('The file is larger than 1 MB. Split it into smaller files.'); return; }
    const text = await f.text();
    const head = (splitCsv(text.replace(/^\ufeff/, ''))[0] ?? []).map((h) => h.trim());
    if (head.length < 3) { setFileErr('This does not look like a CSV file with a header row. Start from the template.'); return; }
    setMap(guessColumns(head));
    setFile({ name: f.name, text });
  };
  const runImport = () => {
    if (!file) return;
    setActionErr(null);
    start(async () => {
      const r = await importOrdersCsvAction(file.name, file.text, map);
      if (!r.ok) { setActionErr(r.message); return; }
      setResult(r.data);
      setFile(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5" data-testid="file-page">
      <DsPageHeader title="File import" subtitle="Bring orders in and send products and tracking out with CSV files. Works with any store." icon="file"
        actions={<DsLinkButton href="/account/dropship/integrations" variant="secondary" icon="arrow">Back to integrations</DsLinkButton>} />
      {!data.orders_on && <DsNotice tone="info" title="Orders are not switched on yet" testId="file-orders-off">You can download files now. Importing orders opens when orders are switched on for your account.</DsNotice>}

      <DsCard title="1. Upload orders" subtitle="One row per product. Rows with the same order ID form one order. Up to 200 orders and 1 MB per file." icon="upload" testId="file-orders">
        <div className="flex flex-wrap gap-2 items-center">
          <a className="ds-btn ds-btn-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(ORDERS_CSV_TEMPLATE)}`} download="octopus-orders-template.csv" data-testid="file-template">Download the template</a>
          <span className="text-[13px] text-muted">The price the buyer paid is required on every row: customs declares what the buyer paid.</span>
        </div>
        <div className="mt-4">
          <label htmlFor="c0-orders-file" className="ds-label">Orders CSV file</label>
          <input id="c0-orders-file" type="file" accept=".csv,text/csv" className="block text-[14px] min-h-11" data-testid="file-input"
            disabled={pending || !data.can_import} onChange={(e) => void pick(e.target.files?.[0])} aria-describedby="c0-orders-file-msg" />
          <p id="c0-orders-file-msg" className={`mt-1.5 mb-0 text-[12px] ${fileErr ? 'text-bad' : 'text-muted'}`}>
            {fileErr ?? (data.can_import ? 'Choose a .csv file saved from a spreadsheet or your store.' : 'Your team role can\u2019t import orders. Ask the account owner.')}
          </p>
        </div>

        {file && preview && (
          <div className="mt-5 flex flex-col gap-4" data-testid="file-preview">
            <fieldset className="m-0 p-0 border-0">
              <legend className="text-[15px] font-semibold mb-2">Match your columns</legend>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ORDER_FIELDS.map((f) => (
                  <DsSelect key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint || undefined} value={map[f.key] ?? ''} data-testid={`map-${f.key}`}
                    onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key as OrderField]; else n[f.key as OrderField] = Number(e.target.value); return n; })}>
                    <option value="">{f.required ? 'Choose a column…' : 'Not in my file'}</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </DsSelect>
                ))}
              </div>
            </fieldset>
            {preview.errors.length > 0 && (
              <DsNotice tone="warn" title={`${preview.errors.length} row problem${preview.errors.length > 1 ? 's' : ''}`} testId="file-row-errors">
                <ul className="m-0 pl-5 text-[13px]">{preview.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
                {preview.errors.length > 50 && <p className="m-0 mt-1 text-[13px]">…and {preview.errors.length - 50} more.</p>}
              </DsNotice>
            )}
            <DsTableCard title={`Preview: ${preview.orders.length} order${preview.orders.length === 1 ? '' : 's'} from ${preview.totalRows} row${preview.totalRows === 1 ? '' : 's'}`}
              headers={['Rows', 'Order', 'Buyer', 'Country', 'Lines', 'Paid by buyer']} minWidth={640} testId="file-preview-table">
              {preview.orders.slice(0, 20).map((o) => (
                <tr key={o.order.externalOrderId} data-testid={`preview-${o.order.externalOrderId}`}>
                  <td>{o.rows.join(', ')}</td>
                  <td className="font-semibold">{o.order.externalOrderName || o.order.externalOrderId}</td>
                  <td>{o.order.buyerName}</td>
                  <td>{o.order.address.country}</td>
                  <td>{o.order.lines.map((l) => `${l.qty} × ${l.modelNo}`).join(', ')}</td>
                  <td>{o.order.currency} {minorToDecimal(o.order.lines.reduce((n, l) => n + (l.buyerPaidMinor ?? (l.buyerUnitPriceMinor ?? 0) * l.qty), 0), o.order.currency)}</td>
                </tr>
              ))}
            </DsTableCard>
            <div className="flex flex-wrap gap-2 items-center">
              <DsButton icon="upload" onClick={runImport} loading={pending} testId="file-import"
                disabled={pending || !data.can_import || missing.length > 0 || preview.orders.length === 0}
                disabledReason={!data.can_import ? 'Importing is not available for your account' : missing.length ? 'Match the required columns first' : preview.orders.length === 0 ? 'No orders to import' : undefined}>
                Import {preview.orders.length} order{preview.orders.length === 1 ? '' : 's'}
              </DsButton>
              <span className="text-[13px] text-muted">Orders already received are skipped. Orders are charged the same way as store orders.</span>
            </div>
          </div>
        )}
        {actionErr && <div role="alert" className="mt-3 text-[13px] text-bad" data-testid="file-import-error">{actionErr}</div>}
        {result && (
          <div className="mt-4" data-testid="file-import-result">
            <DsNotice tone={result.failed ? 'warn' : 'ok'} title={`${result.created} imported · ${result.duplicates} already received · ${result.failed} not imported`}>
              {result.errors.length > 0 && <ul className="m-0 pl-5 text-[13px]">{result.errors.slice(0, 50).map((e, i) => <li key={i}>{rowsText(e.rows)}: {e.message}</li>)}</ul>}
            </DsNotice>
          </div>
        )}
      </DsCard>

      <DsTableCard title="Import history" subtitle="Your last 20 files." headers={['When (UTC)', 'File', 'Rows', 'Imported', 'Already received', 'Not imported', 'Problems']} minWidth={760} testId="file-history">
        {data.imports.length === 0 ? (
          <tr><td colSpan={7} className="text-muted">No files imported yet.</td></tr>
        ) : data.imports.map((i) => (
          <tr key={i.id} data-testid="file-history-row">
            <td>{fmtDateTime(i.created_at)}</td>
            <td className="break-all">{i.file_name}</td>
            <td>{i.total_rows}</td>
            <td>{i.created}</td>
            <td>{i.duplicates}</td>
            <td>{i.failed ? <DsBadge tone="warn">{i.failed}</DsBadge> : 0}</td>
            <td className="text-[13px]">{i.errors.length === 0 ? '—' : (
              <details><summary className="cursor-pointer">{i.errors.length} problem{i.errors.length > 1 ? 's' : ''}</summary>
                <ul className="m-0 pl-4">{i.errors.slice(0, 30).map((e, k) => <li key={k}>{rowsText(e.rows)}: {e.message}</li>)}</ul></details>
            )}</td>
          </tr>
        ))}
      </DsTableCard>

      <div className="grid md:grid-cols-2 gap-4">
        <DsCard title="2. Product file" subtitle="Your imported products with your titles, SKUs and prices, for stores without a connection." icon="download" testId="file-products">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a CSV download from a route handler, not a page */}
          <a className="ds-btn ds-btn-secondary" href="/account/dropship/integrations/file/export?kind=products" data-testid="file-products-download">Download product CSV</a>
          <p className="text-[12px] text-muted mt-2 mb-0">Upload it in your store&rsquo;s product import. Stock and price changes are not synced to a file: download a new one.</p>
        </DsCard>
        <DsCard title="3. Tracking file" subtitle="Tracking numbers of shipped orders, to upload into your store." icon="truck" testId="file-tracking">
          <div className="grid grid-cols-2 gap-3">
            <DsInput label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} data-testid="tracking-from" />
            <DsInput label="To" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} data-testid="tracking-to" />
          </div>
          <a className="ds-btn ds-btn-secondary mt-3" href={`/account/dropship/integrations/file/export?kind=tracking&from=${from}&to=${to}`} data-testid="file-tracking-download">Download tracking CSV</a>
          <p className="text-[12px] text-muted mt-2 mb-0">The tracking link opens your branded tracking page.</p>
        </DsCard>
      </div>
    </div>
  );
}
