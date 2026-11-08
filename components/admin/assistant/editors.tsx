'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/admin/client';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
type FormAction = (prev: R | null, fd: FormData) => Promise<R>;

/** Sensitive-topic chips: add (Enter / Add) and remove (×), saved as a JSON list. */
export function TopicsEditor({ initial, action, disabled }: { initial: string[]; action: FormAction; disabled?: boolean }) {
  const [topics, setTopics] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim().toLowerCase().replace(/\s+/g, ' ');
    if (v.length >= 2 && v.length <= 40 && !topics.includes(v)) setTopics([...topics, v]);
    setInput('');
  };
  return (
    <ActionForm action={action} submitLabel="Save topics" hideSubmit={disabled}>
      <input type="hidden" name="topics" value={JSON.stringify(topics)} />
      <ul className="flex flex-wrap gap-2" aria-label="Sensitive topics">
        {topics.length === 0 && <li className="text-sm text-muted">No topics — add at least one.</li>}
        {topics.map((t) => (
          <li key={t} className="inline-flex items-center gap-1 rounded-full bg-bad-bg text-bad pl-3 pr-1 py-1 text-sm font-semibold">
            {t}
            {!disabled && (
              <button type="button" className="w-6 h-6 rounded-full hover:bg-white/60 grid place-items-center" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}>×</button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="flex gap-2 mt-3">
          <label htmlFor="topic-add" className="sr-only">New topic</label>
          <input id="topic-add" className="input" value={input} maxLength={40} placeholder="e.g. chargeback"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="btn btn-ghost" onClick={add} disabled={!input.trim()}>Add</button>
        </div>
      )}
    </ActionForm>
  );
}

type Row = { key: number; country: string; team: string };

/** Team–country map rows (country code → team) plus the default team. */
export function CountryMapEditor({ initial, teams, action, disabled }: { initial: Record<string, string>; teams: string[]; action: FormAction; disabled?: boolean }) {
  const [def, setDef] = useState(initial.default ?? 'Sourcing');
  const [rows, setRows] = useState<Row[]>(() => Object.entries(initial).filter(([k]) => k !== 'default').map(([country, team], i) => ({ key: i, country, team })));
  const [next, setNext] = useState(rows.length);
  const upd = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <ActionForm action={action} submitLabel="Save team map" hideSubmit={disabled}>
      <input type="hidden" name="rows" value={JSON.stringify(rows.map(({ country, team }) => ({ country, team })))} />
      <datalist id="team-names">{teams.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="grid grid-cols-[110px_1fr_40px] gap-2 items-end">
        <span className="label mb-0">Country</span><span className="label mb-0">Team</span><span />
        <span className="text-sm font-semibold self-center">Default</span>
        <span>
          <label htmlFor="team-default" className="sr-only">Default team</label>
          <input id="team-default" name="default_team" className="input" list="team-names" value={def} onChange={(e) => setDef(e.target.value)} disabled={disabled} required />
        </span>
        <span />
        {rows.map((r, i) => (
          <div key={r.key} className="contents">
            <span>
              <label htmlFor={`cc-${r.key}`} className="sr-only">Country code row {i + 1}</label>
              <input id={`cc-${r.key}`} className="input mono uppercase" maxLength={2} value={r.country} placeholder="DE" onChange={(e) => upd(r.key, { country: e.target.value.toUpperCase() })} disabled={disabled} />
            </span>
            <span>
              <label htmlFor={`tm-${r.key}`} className="sr-only">Team row {i + 1}</label>
              <input id={`tm-${r.key}`} className="input" list="team-names" value={r.team} placeholder="Sourcing EU" onChange={(e) => upd(r.key, { team: e.target.value })} disabled={disabled} />
            </span>
            {!disabled ? <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>×</button> : <span />}
          </div>
        ))}
      </div>
      {!disabled && <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => { setRows([...rows, { key: next, country: '', team: '' }]); setNext(next + 1); }}>+ Add country</button>}
      <p className="text-xs text-muted mt-2">Team names must match the staff profile team (Staff &amp; roles). Unmapped countries use the default team.</p>
    </ActionForm>
  );
}
