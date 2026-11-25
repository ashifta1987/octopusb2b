'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsCheckbox,
  DsChip,
  DsEmptyState,
  DsInput,
  DsNotice,
  DsSelect,
  DsStepper,
  DsTextarea,
} from '@/components/dropship-ui';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import {
  approveRateImportAction,
  deactivateRateCardAction,
  deleteRateDraftAction,
  previewRatesAction,
  rejectRateImportAction,
  saveRateImportAction,
  testQuoteAction,
  type ErrorRow,
  type PreviewRow,
  type RateRow,
  type TestQuoteRow,
} from './actions';

export type RateCard = {
  id: string; carrier_code: string; carrier_name: string | null; method: string; carrier_service_code: string;
  service_label: string | null; country: string; base_cents: number; per_100g_cents: number; step_g: number;
  max_weight_g: number; volumetric_divisor: number; days_min: number; days_max: number;
  allows_battery: boolean; allows_liquid: boolean; allows_magnet: boolean; allows_powder: boolean;
  fuel_surcharge_bp: number; remote_area_fee_cents: number | null; version: number; active: boolean;
  used_count: number; effective_from: string; import_id: string | null; proposed_by_name: string | null; approved_by_name: string | null;
};
export type RateImport = {
  id: string; source: 'csv' | 'manual'; file_name: string | null; status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  note: string | null; rows: RateRow[]; replace_keys: string[];
  counts: { rows_in_file?: number; new?: number; changed?: number; unchanged?: number; errors?: number; keys?: string[] };
  errors: ErrorRow[]; proposed_by: string; proposed_by_name: string | null; submitted_at: string | null;
  decided_by_name: string | null; decided_at: string | null; reject_reason: string | null; created_at: string;
};
export type RatesAccess = { userId: string; canEditRates: boolean };

type Msg = { ok: boolean; text: string } | null;
function Message({ m, testId }: { m: Msg; testId?: string }) {
  if (!m) return null;
  return (
    <p role={m.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[13px] ${m.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>
      {m.text}
    </p>
  );
}

const METHOD_LABEL: Record<string, string> = { economy: 'Economy', standard: 'Standard', express: 'Express' };
const countryName = (c: string) => COUNTRY_NAMES[c] ?? c;
const restricted = (r: { allows_battery?: unknown; allows_liquid?: unknown; allows_magnet?: unknown; allows_powder?: unknown }) =>
  [r.allows_battery && 'Battery', r.allows_liquid && 'Liquid', r.allows_magnet && 'Magnet', r.allows_powder && 'Powder']
    .filter(Boolean).join(', ') || '—';
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** Price of one parcel on a card, same formula as the database quotes (weight steps, then fuel %). */
function cardPrice(c: { base_cents: unknown; per_100g_cents: unknown; step_g: unknown; fuel_surcharge_bp: unknown }, grams: number): number | null {
  const base = n(c.base_cents); const per = n(c.per_100g_cents); const step = n(c.step_g) ?? 100; const fuel = n(c.fuel_surcharge_bp) ?? 0;
  if (base == null || per == null || !step) return null;
  return Math.round((base + Math.ceil(grams / step) * per) * (10000 + fuel) / 10000);
}
function priceText(c: { base_cents: unknown; per_100g_cents: unknown; step_g: unknown; fuel_surcharge_bp: unknown; remote_area_fee_cents?: unknown }) {
  const base = n(c.base_cents); const per = n(c.per_100g_cents);
  if (base == null || per == null) return '—';
  const fuel = (n(c.fuel_surcharge_bp) ?? 0) / 100;
  const remote = n(c.remote_area_fee_cents);
  return `${money(base, 'USD')} + ${money(per, 'USD')}/${n(c.step_g) ?? 100} g + ${fuel.toFixed(fuel % 1 ? 2 : 0)}% fuel${remote != null ? ` · remote area ${money(remote, 'USD')} may apply` : ''}`;
}

/* ───────── CSV ───────── */
const FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'carrier_code', label: 'Carrier code', required: true },
  { key: 'method', label: 'Method (economy, standard, express)', required: true },
  { key: 'carrier_service_code', label: 'Service code', required: true },
  { key: 'service_label', label: 'Service name', required: false },
  { key: 'country', label: 'Country (2-letter code)', required: true },
  { key: 'base_usd', label: 'Base price (US$)', required: true },
  { key: 'per_100g_usd', label: 'Price per weight step (US$)', required: true },
  { key: 'step_g', label: 'Weight step (g, default 100)', required: false },
  { key: 'max_weight_g', label: 'Max weight (g)', required: false },
  { key: 'volumetric_divisor', label: 'Box-size divisor (default 5000)', required: false },
  { key: 'days_min', label: 'Delivery days, minimum', required: true },
  { key: 'days_max', label: 'Delivery days, maximum', required: true },
  { key: 'battery', label: 'Battery allowed (yes/no)', required: false },
  { key: 'liquid', label: 'Liquid allowed (yes/no)', required: false },
  { key: 'magnet', label: 'Magnet allowed (yes/no)', required: false },
  { key: 'powder', label: 'Powder allowed (yes/no)', required: false },
  { key: 'fuel_pct', label: 'Fuel surcharge (%)', required: false },
  { key: 'remote_area_fee_usd', label: 'Remote-area fee (US$)', required: false },
];
const CSV_HEADER = FIELDS.map((f) => f.key).join(',');
const CSV_EXAMPLE = 'yunexpress,express,THPHR,Express,AE,5.00,0.80,100,30000,5000,3,6,no,no,no,no,0,';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const usdToCents = (v: string) => {
  const s = v.trim();
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : s; // a non-number goes through and is reported as an error
};
const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());
const pctToBp = (v: string) => (v.trim() === '' ? 0 : /^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v.trim()) * 100) : v.trim());

/** Mapped values → a row the database validates (money in cents, fuel in basis points). Unknown cells stay as typed. */
function toRow(raw: Record<string, string>): RateRow {
  return {
    carrier_code: raw.carrier_code ?? '', method: (raw.method ?? '').toLowerCase(), carrier_service_code: raw.carrier_service_code ?? '',
    service_label: raw.service_label || null, country: (raw.country ?? '').toUpperCase(),
    base_cents: usdToCents(raw.base_usd ?? ''), per_100g_cents: usdToCents(raw.per_100g_usd ?? ''),
    step_g: raw.step_g || null, max_weight_g: raw.max_weight_g || null, volumetric_divisor: raw.volumetric_divisor || null,
    days_min: raw.days_min || null, days_max: raw.days_max || null,
    allows_battery: yes(raw.battery ?? ''), allows_liquid: yes(raw.liquid ?? ''), allows_magnet: yes(raw.magnet ?? ''), allows_powder: yes(raw.powder ?? ''),
    fuel_surcharge_bp: pctToBp(raw.fuel_pct ?? ''), remote_area_fee_cents: usdToCents(raw.remote_area_fee_usd ?? ''),
  };
}
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ───────── Import / new card: Upload → Map columns → Check → Send for approval ───────── */
type Draft = { source: 'csv' | 'manual'; fileName: string | null; raws: Record<string, string>[]; map: Record<string, string>; id?: string | null };

function Importer({ cards, onDone, seed }: { cards: RateCard[]; onDone: (m: Msg) => void; seed: Draft | null }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(seed ? 3 : 1);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(seed?.fileName ?? null);
  const [grid, setGrid] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, string>>(seed?.map ?? {});
  const [draft, setDraft] = useState<Draft | null>(seed);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const headers = grid[0] ?? [];
  const active = useMemo(() => new Map(cards.filter((c) => c.active).map((c) => [`${c.carrier_code}|${c.method}|${c.country}`, c])), [cards]);

  const runCheck = (d: Draft) => start(async () => {
    const res = await previewRatesAction(d.raws.map(toRow));
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Could not check the rows.' }); return; }
    setDraft(d); setPreview(res.data ?? []); setTicked(new Set()); setMsg(null); setStep(3);
  });
  // a seeded draft (New rate card form or an opened draft) goes straight to the check, once
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seed || seededRef.current) return;
    seededRef.current = true;
    runCheck(seed);
  });

  const invalid = preview?.filter((p) => p.action === 'invalid') ?? [];
  const changed = preview?.filter((p) => p.action === 'changed') ?? [];
  const fresh = preview?.filter((p) => p.action === 'new') ?? [];
  const keep = preview?.filter((p) => p.action !== 'invalid') ?? [];
  const errors: ErrorRow[] = invalid.map((p) => ({ row_no: p.row_no, reason: p.reason ?? 'Invalid', raw: draft?.raws[p.row_no - 1] ?? {} }));
  const untickedCount = changed.filter((c) => !ticked.has(c.rate_key)).length;
  const sendReason = !preview ? 'Check the rows first'
    : keep.length === 0 ? 'Every row has an error'
    : fresh.length + changed.length === 0 ? 'Every row matches the active cards'
    : untickedCount > 0 ? `Tick the ${untickedCount} card${untickedCount === 1 ? '' : 's'} to replace, or leave ${untickedCount === 1 ? 'it' : 'them'} out of the file`
    : undefined;
  const errorsCsv = `data:text/csv;charset=utf-8,${encodeURIComponent(
    ['row,reason,' + FIELDS.map((f) => f.key).join(','),
      ...errors.map((e) => [e.row_no, csvCell(e.reason), ...FIELDS.map((f) => csvCell(e.raw[f.key]))].join(','))].join('\n') + '\n')}`;

  const save = (submit: boolean) => start(async () => {
    if (!draft || !preview) return;
    const res = await saveRateImportAction({
      id: draft.id ?? null, source: draft.source, fileName: draft.fileName, columnMap: draft.map,
      rows: keep.map((p) => toRow(draft.raws[p.row_no - 1])), errors, replaceKeys: [...ticked],
      rowsInFile: draft.raws.length, submit,
    });
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Could not save.' }); return; }
    setStep(4); setMsg(null); onDone({ ok: true, text: res.message ?? 'Saved.' });
  });

  const steps = [
    { label: 'Upload', state: step > 1 ? 'done' : 'current' },
    { label: 'Map columns', state: step > 2 ? 'done' : step === 2 ? 'current' : 'upcoming' },
    { label: 'Check', state: step > 3 ? 'done' : step === 3 ? 'current' : 'upcoming' },
    { label: 'Send for approval', state: step === 4 ? 'current' : 'upcoming' },
  ] as const;

  return (
    <div className="flex flex-col gap-4" data-testid="rate-importer">
      <DsStepper ariaLabel="Import steps" steps={steps.map((x) => ({ label: x.label, state: x.state }))} />

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-center text-[13px]">
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${CSV_HEADER}\n${CSV_EXAMPLE}\n`)}`} download="rate-cards-template.csv" className="underline text-[#2A6FD1]">
              Download the template
            </a>
            <label className="flex items-center gap-2">
              <span>Choose a CSV file</span>
              <input type="file" accept=".csv,text/csv" aria-label="CSV file" data-testid="rate-csv-file" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) { setFileName(f.name); setText(await f.text()); }
              }} />
            </label>
          </div>
          <DsTextarea label="Or paste the CSV (header row first)" value={text} rows={6} className="font-mono text-[12px]"
            hint="Excel files: use File › Save as › CSV first." data-testid="rate-csv-text"
            onChange={(e) => setText(e.target.value)} placeholder={`${CSV_HEADER}\n${CSV_EXAMPLE}`} />
          <div>
            <DsButton disabled={!text.trim()} disabledReason={!text.trim() ? 'Choose a file or paste the CSV' : undefined} testId="rate-next-map"
              onClick={() => {
                const g = parseCsv(text);
                if (g.length < 2) { setMsg({ ok: false, text: 'The file needs a header row and at least one rate row.' }); return; }
                const head = g[0].map((h) => h.trim().toLowerCase());
                const auto: Record<string, string> = {};
                for (const f of FIELDS) { const i = head.indexOf(f.key); if (i >= 0) auto[f.key] = String(i); }
                setGrid(g); setMap(auto); setMsg(null); setStep(2);
              }}>Next: map columns</DsButton>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13px] text-[#5B6478]">{grid.length - 1} rows in {fileName ?? 'the pasted text'}. Match each field to a column in the file. Columns with the template names are matched already.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {FIELDS.map((f) => (
              <DsSelect key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} value={map[f.key] ?? ''} data-testid={`map-${f.key}`}
                onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                <option value="">{f.required ? 'Choose a column' : 'Not in this file'}</option>
                {headers.map((h, i) => <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>)}
              </DsSelect>
            ))}
          </div>
          <div className="flex gap-2">
            <DsButton variant="secondary" onClick={() => setStep(1)}>Back</DsButton>
            {(() => {
              const missing = FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label);
              return (
                <DsButton testId="rate-next-check" disabled={pending || missing.length > 0}
                  disabledReason={missing.length ? `Map: ${missing.join(', ')}` : undefined}
                  onClick={() => {
                    const raws = grid.slice(1).map((r) => Object.fromEntries(FIELDS.map((f) => [f.key, map[f.key] ? (r[Number(map[f.key])] ?? '').trim() : ''])));
                    const named = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== '').map(([k, v]) => [k, headers[Number(v)] ?? v]));
                    runCheck({ source: 'csv', fileName, raws, map: named });
                  }}>Next: check</DsButton>
              );
            })()}
          </div>
        </div>
      )}

      {step === 3 && preview && draft && (
        <div className="flex flex-col gap-3" data-testid="rate-check">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 m-0">
            {[['Rows in file', draft.raws.length], ['New', fresh.length], ['Changed', changed.length], ['Errors', invalid.length]].map(([k, v]) => (
              <div key={k as string} className="rounded-[8px] border border-[#E3E7EF] px-3 py-2">
                <dt className="text-[12px] text-[#5B6478]">{k}</dt><dd className="m-0 text-[18px] font-bold" data-testid={`check-${String(k).toLowerCase().replace(/ /g, '-')}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="ds-scroll">
            <table className="ds-tbl min-w-[860px]" data-testid="rate-import-preview">
              <thead><tr>
                <th scope="col">Row</th><th scope="col">Country</th><th scope="col">Carrier · service</th><th scope="col">Method</th>
                <th scope="col">Current</th><th scope="col">New</th><th scope="col">Change (500 g parcel)</th><th scope="col">Replace?</th>
              </tr></thead>
              <tbody>
                {preview.map((p) => {
                  const r = p.normalized;
                  const cur = active.get(p.rate_key);
                  const curP = cur ? cardPrice(cur, 500) : null;
                  const newP = p.action === 'invalid' ? null : cardPrice(r as never, 500);
                  const pct = curP && newP != null ? Math.round(((newP - curP) / curP) * 1000) / 10 : null;
                  return (
                    <tr key={p.row_no} data-testid={`preview-row-${p.row_no}`}>
                      <td>{p.row_no}</td>
                      <td>{r.country ? countryName(String(r.country)) : '—'}</td>
                      <td>{String(r.carrier_code || '—')} · <span className="font-mono">{String(r.carrier_service_code || '—')}</span></td>
                      <td>{METHOD_LABEL[String(r.method)] ?? String(r.method || '—')}</td>
                      <td className="text-[12.5px]">{cur ? <>{priceText(cur)} <span className="text-[#5B6478]">· v{cur.version}</span></> : '—'}</td>
                      <td className="text-[12.5px]">{p.action === 'invalid' ? '—' : priceText(r as never)}</td>
                      <td>
                        {p.action === 'invalid' && <DsBadge tone="bad">{p.reason ?? 'Error'}</DsBadge>}
                        {p.action === 'new' && <DsBadge tone="info">New</DsBadge>}
                        {p.action === 'unchanged' && <DsBadge tone="neutral">No change</DsBadge>}
                        {p.action === 'changed' && (
                          <DsBadge tone="warn">{pct == null ? 'Changed' : `${pct > 0 ? '+' : ''}${pct}%`}{p.reason ? ` · ${p.reason}` : ''}</DsBadge>
                        )}
                      </td>
                      <td>{p.action === 'changed' && (
                        <DsCheckbox label={<span className="sr-only">Replace {p.rate_key}</span>} checked={ticked.has(p.rate_key)}
                          data-testid={`tick-${p.rate_key}`}
                          onChange={(e) => { const s = new Set(ticked); if (e.target.checked) s.add(p.rate_key); else s.delete(p.rate_key); setTicked(s); }} />
                      )}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DsNotice tone="info" title="Nothing replaces an active card until a second person approves.">
            {invalid.length > 0 ? 'Rows with errors are left out. Download the error list to send back to the carrier.' : 'Paid orders keep the card they were quoted with.'}
          </DsNotice>
          <div className="flex flex-wrap gap-2 items-start">
            <DsButton testId="rate-send-approval" disabled={pending || Boolean(sendReason)} disabledReason={sendReason} onClick={() => save(true)}>Send for approval</DsButton>
            {invalid.length > 0 && <a className="ds-btn ds-btn-secondary" href={errorsCsv} download="rate-card-errors.csv" data-testid="rate-download-errors">Download errors</a>}
            <DsButton variant="secondary" disabled={pending || keep.length === 0} disabledReason={keep.length === 0 ? 'Every row has an error' : undefined}
              testId="rate-save-draft" onClick={() => save(false)}>Save as draft</DsButton>
            <DsButton variant="link" onClick={() => { setPreview(null); setStep(draft.source === 'csv' ? 2 : 1); }}>Back</DsButton>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[13.5px]">Done. Nothing changes until a second person approves it under “Waiting for approval”.</p>
          <div><DsButton variant="secondary" onClick={() => { setStep(1); setText(''); setPreview(null); setDraft(null); setFileName(null); }}>Import another price list</DsButton></div>
        </div>
      )}
      <Message m={msg} testId="rate-import-msg" />
    </div>
  );
}

/* ───────── New rate card (one card, same approval) ───────── */
function NewCardForm({ onCheck }: { onCheck: (d: Draft) => void }) {
  return (
    <form className="grid grid-cols-1 md:grid-cols-4 gap-3" data-testid="new-rate-card-form" action={(fd) => {
      const raw: Record<string, string> = {};
      for (const f of FIELDS) raw[f.key] = String(fd.get(f.key) ?? '').trim();
      for (const k of ['battery', 'liquid', 'magnet', 'powder']) raw[k] = fd.get(k) ? 'yes' : 'no';
      onCheck({ source: 'manual', fileName: null, raws: [raw], map: {} });
    }}>
      <DsInput label="Carrier code" name="carrier_code" required placeholder="yunexpress" />
      <DsSelect label="Method" name="method" required defaultValue="">
        <option value="" disabled>Choose</option><option value="economy">Economy</option><option value="standard">Standard</option><option value="express">Express</option>
      </DsSelect>
      <DsInput label="Service code" name="carrier_service_code" required />
      <DsInput label="Service name" name="service_label" />
      <DsInput label="Country (2 letters)" name="country" required maxLength={2} />
      <DsInput label="Base price (US$)" name="base_usd" required inputMode="decimal" />
      <DsInput label="Per weight step (US$)" name="per_100g_usd" required inputMode="decimal" />
      <DsInput label="Weight step (g)" name="step_g" inputMode="numeric" defaultValue="100" />
      <DsInput label="Max weight (g)" name="max_weight_g" inputMode="numeric" defaultValue="30000" />
      <DsInput label="Box-size divisor" name="volumetric_divisor" inputMode="numeric" defaultValue="5000" />
      <DsInput label="Delivery days, min" name="days_min" required inputMode="numeric" />
      <DsInput label="Delivery days, max" name="days_max" required inputMode="numeric" />
      <DsInput label="Fuel surcharge (%)" name="fuel_pct" inputMode="decimal" defaultValue="0" />
      <DsInput label="Remote-area fee (US$)" name="remote_area_fee_usd" inputMode="decimal" hint="Leave empty if none" />
      <fieldset className="md:col-span-2 flex flex-wrap gap-4 items-center border-0 p-0 m-0">
        <legend className="text-[13px] font-semibold mb-1">Restricted goods allowed</legend>
        <DsCheckbox label="Battery" name="battery" /><DsCheckbox label="Liquid" name="liquid" />
        <DsCheckbox label="Magnet" name="magnet" /><DsCheckbox label="Powder" name="powder" />
      </fieldset>
      <div className="md:col-span-4"><DsButton type="submit" testId="new-rate-card-check">Check</DsButton></div>
    </form>
  );
}

/* ───────── Test a quote ───────── */
function TestQuote({ countries }: { countries: string[] }) {
  const [res, setRes] = useState<{ rows: TestQuoteRow[]; dims: string | null; weight: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3" data-testid="test-quote">
      <form className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end" action={(fd) => start(async () => {
        const l = n(fd.get('l')); const w = n(fd.get('w')); const h = n(fd.get('h'));
        const weight = Number(fd.get('weight'));
        const r = await testQuoteAction({ country: String(fd.get('country') ?? ''), method: String(fd.get('method') ?? ''), weightG: weight, l, w, h });
        if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'Could not quote.' }); setRes(null); return; }
        setMsg(null); setRes({ rows: r.data ?? [], dims: l && w && h ? `${l}×${w}×${h}` : null, weight });
      })}>
        <DsSelect label="Country" name="country" required defaultValue={countries[0] ?? ''} containerClassName="col-span-2 md:col-span-1">
          {countries.length === 0 && <option value="">No active cards</option>}
          {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
        </DsSelect>
        <DsSelect label="Method" name="method" defaultValue="economy">
          <option value="economy">Economy</option><option value="standard">Standard</option><option value="express">Express</option>
        </DsSelect>
        <DsInput label="Actual weight (g)" name="weight" required inputMode="numeric" defaultValue="500" />
        <DsInput label="Box L (cm)" name="l" inputMode="decimal" />
        <DsInput label="W (cm)" name="w" inputMode="decimal" />
        <DsInput label="H (cm)" name="h" inputMode="decimal" />
        <div className="col-span-2 md:col-span-6">
          <DsButton type="submit" variant="secondary" disabled={pending || countries.length === 0} disabledReason={countries.length === 0 ? 'Publish a rate card first' : undefined} testId="test-quote-run">Quote</DsButton>
        </div>
      </form>
      {res && (res.rows.length === 0 ? (
        <p className="m-0 text-[13px]" data-testid="test-quote-none">No active card for this country and method. Merchants see “No rate set” — never 0.</p>
      ) : res.rows.map((r) => (
        <dl key={r.rate_card_id} className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1 m-0 text-[13px] border-t border-[#E3E7EF] pt-2" data-testid="test-quote-result">
          <dt className="text-[#5B6478]">Card</dt><dd className="m-0">{r.carrier_name ?? r.carrier_code} · <span className="font-mono">{r.carrier_service_code}</span> · v{r.version}</dd>
          <dt className="text-[#5B6478]">Box-size weight</dt>
          <dd className="m-0">{res.dims && r.box_weight_g != null ? `${res.dims} ÷ ${r.volumetric_divisor} = ${(r.box_weight_g / 1000).toFixed(2)} kg` : 'No box size entered'}</dd>
          <dt className="text-[#5B6478]">Billed weight</dt><dd className="m-0">{(r.billed_weight_g / 1000).toFixed(1)} kg (higher of the two, rounded up to 100 g)</dd>
          <dt className="text-[#5B6478]">Shipping cost</dt>
          <dd className="m-0 font-semibold">{r.over_max ? `Over the card’s ${(r.max_weight_g / 1000).toLocaleString('en-US')} kg limit` : `${money(r.price_cents, 'USD')} · card v${r.version}`}
            {r.remote_area_fee_may_apply && <span className="font-normal text-[#5B6478]"> · remote-area fee may apply</span>}</dd>
        </dl>
      )))}
      <Message m={msg} />
    </div>
  );
}

/* ───────── Page body ───────── */
type Filter = 'all' | 'active' | 'pending' | 'draft' | 'deactivated';
type TableRow =
  | { kind: 'card'; card: RateCard; status: 'active' | 'deactivated' }
  | { kind: 'proposal'; imp: RateImport; row: RateRow; status: 'pending' | 'draft' };

export function RatesClient({ cards, imports, access }: { cards: RateCard[]; imports: RateImport[]; access: RatesAccess }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [msg, setMsg] = useState<Msg>(null);
  const [seed, setSeed] = useState<Draft | null>(null);
  const [importerKey, setImporterKey] = useState(0);
  const [deactId, setDeactId] = useState<string | null>(null);
  const [deactReason, setDeactReason] = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pending, start] = useTransition();

  const userId = access.userId;
  const rows = useMemo<TableRow[]>(() => {
    const latest = new Map<string, number>();
    for (const c of cards) { const k = `${c.carrier_code}|${c.method}|${c.country}`; latest.set(k, Math.max(latest.get(k) ?? 0, c.version)); }
    const out: TableRow[] = [];
    for (const c of cards) {
      if (c.active) out.push({ kind: 'card', card: c, status: 'active' });
      else if (latest.get(`${c.carrier_code}|${c.method}|${c.country}`) === c.version) out.push({ kind: 'card', card: c, status: 'deactivated' });
      // older versions replaced by a newer one are history, not shown here
    }
    for (const imp of imports) {
      if (imp.status !== 'pending_approval' && !(imp.status === 'draft' && imp.proposed_by === userId)) continue;
      for (const r of imp.rows) out.push({ kind: 'proposal', imp, row: r, status: imp.status === 'draft' ? 'draft' : 'pending' });
    }
    return out;
  }, [cards, imports, userId]);
  const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.status === f).length);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const waiting = imports.filter((i) => i.status === 'pending_approval');
  const drafts = imports.filter((i) => i.status === 'draft' && i.proposed_by === access.userId);
  const countries = useMemo(() => [...new Set(cards.filter((c) => c.active).map((c) => c.country))].sort(), [cards]);
  const act = (p: Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rate cards">
        {([['all', 'All'], ['active', 'Active'], ['pending', 'Waiting for approval'], ['draft', 'Draft'], ['deactivated', 'Deactivated']] as const).map(([f, label]) => (
          <DsChip key={f} pressed={filter === f} onClick={() => setFilter(f)} testId={`rate-filter-${f}`}>{label} ({count(f)})</DsChip>
        ))}
      </div>

      <DsCard title="Rate cards" icon="truck" noPadding testId="rate-cards"
        subtitle="Prices are the carrier’s cost to Octopus. Merchants only ever see the shipping line in their landed cost. Box-size divisor is set per card (default 5000).">
        {shown.length === 0 ? (
          <div className="p-5">
            <DsEmptyState icon="truck" title={rows.length === 0 ? 'No rate cards yet' : 'Nothing in this view'}
              description={rows.length === 0 ? 'Import the carrier’s price list or add a card. Until a card is active, merchants see “No rate set” for that country.' : 'Choose another filter.'} />
          </div>
        ) : (
          <div className="ds-scroll">
            <table className="ds-tbl min-w-[1040px]" data-testid="rate-card-table">
              <thead><tr>
                <th scope="col">Carrier · service</th><th scope="col">Method</th><th scope="col">Country</th><th scope="col">Price</th>
                <th scope="col">Max weight</th><th scope="col">Restricted OK</th><th scope="col">Status</th>
                {access.canEditRates && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr></thead>
              <tbody>
                {shown.map((r) => {
                  if (r.kind === 'card') {
                    const c = r.card;
                    return (
                      <tr key={c.id} data-testid={`rate-card-${c.carrier_code}-${c.method}-${c.country}`}>
                        <td>{c.carrier_name ?? c.carrier_code} · <span className="font-mono">{c.carrier_service_code}</span></td>
                        <td>{METHOD_LABEL[c.method] ?? c.method}</td>
                        <td>{countryName(c.country)}</td>
                        <td className="text-[12.5px]">{priceText(c)}</td>
                        <td>{(c.max_weight_g / 1000).toLocaleString('en-US')} kg</td>
                        <td>{restricted(c)}</td>
                        <td><DsBadge tone={r.status === 'active' ? 'ok' : 'neutral'}>{r.status === 'active' ? 'Active' : 'Deactivated'}</DsBadge> <span className="font-mono text-[12px]">v{c.version}</span></td>
                        {access.canEditRates && (
                          <td>
                            {r.status === 'active' && (deactId === c.id ? (
                              <form className="flex gap-2 items-end" action={() => act(deactivateRateCardAction(c.id, deactReason).then((x) => { if (x.ok) setDeactId(null); return x; }))}>
                                <DsInput label="Reason" value={deactReason} onChange={(e) => setDeactReason(e.target.value)} required autoFocus />
                                <DsButton type="submit" variant="danger" disabled={pending || !deactReason.trim()} disabledReason={!deactReason.trim() ? 'Enter a reason' : undefined}>Deactivate</DsButton>
                                <DsButton variant="link" onClick={() => setDeactId(null)}>Cancel</DsButton>
                              </form>
                            ) : (
                              <DsButton variant="secondary" onClick={() => { setDeactId(c.id); setDeactReason(''); }} testId={`deactivate-${c.id}`}>Deactivate</DsButton>
                            ))}
                          </td>
                        )}
                      </tr>
                    );
                  }
                  const x = r.row;
                  return (
                    <tr key={`${r.imp.id}-${String(x.carrier_code)}-${String(x.method)}-${String(x.country)}`}>
                      <td>{String(x.carrier_code)} · <span className="font-mono">{String(x.carrier_service_code)}</span></td>
                      <td>{METHOD_LABEL[String(x.method)] ?? String(x.method)}</td>
                      <td>{countryName(String(x.country))}</td>
                      <td className="text-[12.5px]">{priceText(x as never)}</td>
                      <td>{x.max_weight_g ? `${(Number(x.max_weight_g) / 1000).toLocaleString('en-US')} kg` : '30 kg'}</td>
                      <td>{restricted(x)}</td>
                      <td><DsBadge tone={r.status === 'pending' ? 'warn' : 'info'}>{r.status === 'pending' ? 'Waiting for approval' : 'Draft'}</DsBadge></td>
                      {access.canEditRates && <td />}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>
      <Message m={msg} testId="rates-msg" />

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div className="flex flex-col gap-5">
          {access.canEditRates && (
            <section id="import" aria-labelledby="import-title" className="ds-card scroll-mt-20">
              <h2 id="import-title" className="m-0 text-[18px] font-bold text-[#1A174A]">Import a carrier price list</h2>
              <p className="mt-1 mb-3 text-[13px] text-[#5B6478]">CSV from the carrier. Preview first, nothing changes until approved.</p>
              <Importer key={importerKey} cards={cards} seed={seed} onDone={(m) => setMsg(m)} />
            </section>
          )}
          {access.canEditRates && (
            <section id="new-card" aria-labelledby="new-card-title" className="ds-card scroll-mt-20">
              <h2 id="new-card-title" className="m-0 text-[18px] font-bold text-[#1A174A]">New rate card</h2>
              <p className="mt-1 mb-3 text-[13px] text-[#5B6478]">One card, checked and approved the same way as a price list.</p>
              <NewCardForm onCheck={(d) => {
                setSeed(d); setImporterKey((k) => k + 1);
                document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' });
              }} />
            </section>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <DsCard title={`Waiting for approval (${waiting.length})`} icon="clock" testId="rate-waiting">
            {waiting.length === 0 ? <p className="m-0 text-[13px] text-[#5B6478]">Nothing is waiting.</p> : (
              <div className="flex flex-col gap-4">
                {waiting.map((w) => {
                  const mine = w.proposed_by === access.userId;
                  const keys = w.counts.keys ?? [];
                  return (
                    <div key={w.id} className="flex flex-col gap-2 border-b border-[#E3E7EF] pb-3 last:border-0" data-testid={`rate-waiting-${w.id}`}>
                      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 m-0 text-[13px]">
                        <dt className="text-[#5B6478]">Change</dt>
                        <dd className="m-0">{w.file_name ?? 'New rate card'} · {w.counts.new ?? 0} new, {w.counts.changed ?? 0} changed
                          {keys.length > 0 && <span className="block font-mono text-[11.5px] text-[#5B6478]">{keys.slice(0, 4).join(', ')}{keys.length > 4 ? ` +${keys.length - 4} more` : ''}</span>}</dd>
                        <dt className="text-[#5B6478]">Proposed by</dt><dd className="m-0">{w.proposed_by_name ?? 'Staff'} · {fmtDate(w.submitted_at ?? w.created_at, true)}</dd>
                        <dt className="text-[#5B6478]">Effective from</dt><dd className="m-0">When approved</dd>
                        <dt className="text-[#5B6478]">Orders already paid</dt><dd className="m-0">Keep the card they were quoted with</dd>
                      </dl>
                      {access.canEditRates && (rejectId === w.id ? (
                        <form className="flex flex-wrap gap-2 items-end" action={() => act(rejectRateImportAction(w.id, rejectReason).then((x) => { if (x.ok) setRejectId(null); return x; }))}>
                          <DsInput label="Why is it rejected?" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required autoFocus />
                          <DsButton type="submit" variant="danger" disabled={pending || !rejectReason.trim()} disabledReason={!rejectReason.trim() ? 'Enter a reason' : undefined}>Reject</DsButton>
                          <DsButton variant="link" onClick={() => setRejectId(null)}>Cancel</DsButton>
                        </form>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-start">
                          <DsButton disabled={pending || mine} disabledReason={mine ? 'You can’t approve a change you proposed.' : undefined}
                            testId={`rate-approve-${w.id}`} onClick={() => act(approveRateImportAction(w.id))}>Approve</DsButton>
                          <DsButton variant="secondary" disabled={pending} testId={`rate-reject-${w.id}`} onClick={() => { setRejectId(w.id); setRejectReason(''); }}>Reject</DsButton>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </DsCard>

          {drafts.length > 0 && (
            <DsCard title="Your drafts" icon="file" testId="rate-drafts">
              <div className="flex flex-col gap-3">
                {drafts.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span>{d.file_name ?? 'New rate card'} · {d.counts.new ?? 0} new, {d.counts.changed ?? 0} changed, {d.counts.errors ?? 0} left out · {fmtDate(d.created_at)}</span>
                    <span className="flex gap-2">
                      <DsButton variant="secondary" onClick={() => {
                        const raws = d.rows.map((r) => ({
                          carrier_code: String(r.carrier_code ?? ''), method: String(r.method ?? ''), carrier_service_code: String(r.carrier_service_code ?? ''),
                          service_label: String(r.service_label ?? ''), country: String(r.country ?? ''),
                          base_usd: r.base_cents == null ? '' : (Number(r.base_cents) / 100).toFixed(2),
                          per_100g_usd: r.per_100g_cents == null ? '' : (Number(r.per_100g_cents) / 100).toFixed(2),
                          step_g: String(r.step_g ?? ''), max_weight_g: String(r.max_weight_g ?? ''), volumetric_divisor: String(r.volumetric_divisor ?? ''),
                          days_min: String(r.days_min ?? ''), days_max: String(r.days_max ?? ''),
                          battery: r.allows_battery ? 'yes' : 'no', liquid: r.allows_liquid ? 'yes' : 'no', magnet: r.allows_magnet ? 'yes' : 'no', powder: r.allows_powder ? 'yes' : 'no',
                          fuel_pct: r.fuel_surcharge_bp == null ? '' : String(Number(r.fuel_surcharge_bp) / 100),
                          remote_area_fee_usd: r.remote_area_fee_cents == null ? '' : (Number(r.remote_area_fee_cents) / 100).toFixed(2),
                        }));
                        setSeed({ source: d.source, fileName: d.file_name, raws, map: {}, id: d.id }); setImporterKey((k) => k + 1);
                        document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' });
                      }}>Open</DsButton>
                      <DsButton variant="link" disabled={pending} onClick={() => act(deleteRateDraftAction(d.id))}>Delete draft</DsButton>
                    </span>
                  </div>
                ))}
              </div>
            </DsCard>
          )}

          <DsCard title="Test a quote" icon="scale">
            <TestQuote countries={countries} />
          </DsCard>
        </div>
      </div>
    </div>
  );
}
