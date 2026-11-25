'use client';

import { useState, useTransition } from 'react';
import { importTurnkeyCatalogueAction, type TkPreviewRow } from './actions';

const HEADER = 'project_id,title,category,summary,image,image_alt,floor_area_m2,from_usd,sort';
const EXAMPLE = 'robotic-cafe,Robotic cafe,Food & drink,Self-serve coffee robot kiosk,turnkey/robotic-cafe.webp,Robot arm making coffee,25,,10';

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const TONE: Record<string, string> = { new: 'bg-ok-bg text-ok', update: 'bg-warn-bg text-warn', unchanged: 'bg-fill text-muted', invalid: 'bg-bad-bg text-bad' };
const LABEL: Record<string, string> = { new: 'New', update: 'Changes an existing project', unchanged: 'No change', invalid: 'Error' };

/** Turnkey T1: import the owner's project sheet. Preview first; nothing changes until Import; existing projects only when ticked. */
export function ImportClient() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<TkPreviewRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const invalid = preview?.filter((p) => p.action === 'invalid').length ?? 0;
  const updates = preview?.filter((p) => p.action === 'update') ?? [];
  const blocked = !preview ? 'Preview first' : invalid ? 'Fix the rows with errors first' : updates.some((u) => !ticked.has(u.project_id)) ? 'Tick every project you want to change' : !preview.some((p) => p.action === 'new' || p.action === 'update') ? 'Nothing to import' : null;

  return (
    <section className="card p-5" aria-labelledby="tk-import-h" data-testid="tk-import">
      <h2 id="tk-import-h" className="text-[18px] font-semibold m-0">Import the project sheet (CSV)</h2>
      <p className="text-[13.5px] text-muted mt-1">Columns: <span className="mono">{HEADER}</span>. Preview first: nothing changes until you import, and an existing project changes only when you tick it.</p>
      <div className="flex flex-wrap gap-3 items-center text-[13px] mt-2">
        <a className="underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${HEADER}\n${EXAMPLE}\n`)}`} download="turnkey-projects-template.csv">Download the template</a>
        <label className="flex items-center gap-2">Choose a file <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
      </div>
      <label className="block mt-3 text-[13px]">
        <span className="text-muted">Or paste the CSV</span>
        <textarea className="input mt-1 w-full min-h-[110px] mono text-[12px]" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={`${HEADER}\n${EXAMPLE}`} data-testid="tk-import-text" />
      </label>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn btn-ghost min-h-11" disabled={pending || !text.trim()} data-testid="tk-import-preview" onClick={() => start(async () => {
          const g = parseCsv(text);
          if (g.length < 2) { setMsg({ ok: false, text: 'Paste the header row and at least one project.' }); return; }
          const head = g[0].map((h) => h.trim().toLowerCase());
          if (!head.includes('title') || !head.includes('category')) { setMsg({ ok: false, text: 'The header needs at least title and category.' }); return; }
          const rs = g.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
          const res = await importTurnkeyCatalogueAction(rs, false, []);
          if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Preview failed.' }); return; }
          setRows(rs); setPreview(res.rows ?? []); setTicked(new Set()); setMsg(null);
        })}>Preview</button>
        {preview && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary min-h-11" disabled={pending || Boolean(blocked)} aria-describedby={blocked ? 'tk-import-why' : undefined} data-testid="tk-import-apply"
              onClick={() => start(async () => {
                const res = await importTurnkeyCatalogueAction(rows, true, [...ticked]);
                setMsg({ ok: res.ok, text: res.ok ? res.message ?? 'Imported.' : res.error ?? 'Import failed.' });
                if (res.ok) { setPreview(null); setText(''); }
              })}>Import</button>
            {blocked && <span id="tk-import-why" className="text-[13px] text-muted">{blocked}</span>}
          </span>
        )}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 mb-0 text-[13.5px] ${msg.ok ? 'text-ok' : 'text-bad'}`} data-testid="tk-import-msg">{msg.text}</p>}
      {preview && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]" data-testid="tk-import-preview-table">
            <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Row</th><th className="py-2 pr-3">Project</th><th className="py-2 pr-3">Result</th><th className="py-2 pr-3">Details</th><th className="py-2">Change?</th></tr></thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.row_no} className="border-t border-line">
                  <td className="py-2 pr-3">{p.row_no}</td>
                  <td className="py-2 pr-3 mono">{p.project_id || '—'}</td>
                  <td className="py-2 pr-3"><span className={`pill ${TONE[p.action]}`}>{LABEL[p.action]}</span></td>
                  <td className="py-2 pr-3">{p.reason ?? Object.entries(p.changes ?? {}).map(([k, v]) => <div key={k}>{k}: {String(v.from ?? '—')} → {String(v.to ?? '—')}</div>)}</td>
                  <td className="py-2">{p.action === 'update' && (
                    <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" checked={ticked.has(p.project_id)} onChange={(e) => { const s = new Set(ticked); if (e.target.checked) s.add(p.project_id); else s.delete(p.project_id); setTicked(s); }} /><span className="sr-only">Change {p.project_id}</span></label>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
