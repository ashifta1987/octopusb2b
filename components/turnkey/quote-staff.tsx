'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { depositCents, parseQty, quoteMargin, usdToCents } from '@/lib/turnkey/format';
import {
  addFactoryQuoteAction, discardQuoteDraftAction, saveClientQuoteAction, sendClientQuoteAction, setDepositPctAction, setDepositPctCustomAction, setProjectCustomAction, withdrawClientQuoteAction,
  type ClientLineInput, type FactoryLineInput,
} from '@/app/admin/turnkey/projects/actions';

type Msg = { ok: boolean; text: string } | null;
type Res = { ok: boolean; message?: string; error?: string };
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;
const centsOrNull = (v: string) => { const c = usdToCents(v); return c == null || Number.isNaN(c) ? null : c; };

export type FactoryLineOption = { id: string; label: string; unit_cost_cents: number };

/** Turnkey T4 — staff record a quote received from a factory (staff only: supplier name, reference, costs). */
export function FactoryQuoteForm({ projectId, code }: { projectId: string; code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplier, setSupplier] = useState('');
  const [ref, setRef] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<FactoryLineInput[]>([{ description: '', qty: '1', unitCostUsd: '' }]);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (i: number, k: keyof FactoryLineInput, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + (parseQty(l.qty) ?? 0) * (centsOrNull(l.unitCostUsd) ?? 0), 0);
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-fq-h" data-testid="tk-factory-form"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addFactoryQuoteAction(projectId, code, supplier, ref, validUntil, notes, lines); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' }); if (r.ok) { setSupplier(''); setRef(''); setNotes(''); setValidUntil(''); setLines([{ description: '', qty: '1', unitCostUsd: '' }]); router.refresh(); } }); }}>
      <h3 id="tk-fq-h" className="m-0 text-[15px] font-semibold">Add a factory quote (staff only)</h3>
      <Note msg={msg} id="tk-factory-msg" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="tk-fq-sup">Factory *</label><input id="tk-fq-sup" className="input min-h-11" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} data-testid="tk-factory-supplier" /></div>
        <div><label className="label" htmlFor="tk-fq-ref">Their quote reference</label><input id="tk-fq-ref" className="input min-h-11" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></div>
        <div><label className="label" htmlFor="tk-fq-valid">Valid until</label><input id="tk-fq-valid" type="date" className="input min-h-11" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      </div>
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className="label">Lines (cost in US$ per unit)</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_140px] gap-2">
            <input aria-label={`Line ${i + 1} description`} className="input min-h-11" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} maxLength={500} data-testid={`tk-factory-desc-${i}`} />
            <input aria-label={`Line ${i + 1} quantity`} className="input min-h-11" inputMode="numeric" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} data-testid={`tk-factory-qty-${i}`} />
            <input aria-label={`Line ${i + 1} unit cost in US dollars`} className="input min-h-11" inputMode="decimal" value={l.unitCostUsd} onChange={(e) => set(i, 'unitCostUsd', e.target.value)} data-testid={`tk-factory-cost-${i}`} />
          </div>
        ))}
        <div><button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setLines((ls) => [...ls, { description: '', qty: '1', unitCostUsd: '' }])}>Add line</button></div>
      </fieldset>
      <div><label className="label" htmlFor="tk-fq-notes">Internal notes</label><input id="tk-fq-notes" className="input min-h-11" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
      <p className="m-0 text-[13px] text-muted">Total cost: <span className="mono">{money(total)}</span></p>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !supplier.trim()} data-testid="tk-factory-save">Save factory quote</button></div>
    </form>
  );
}

/**
 * Turnkey T4 — staff build the next client quote version (white-label). Description, quantity and unit price are what the
 * client sees; the source factory line and unit cost stay staff-only and give the margin. The database refuses a line or
 * message that names a factory of this project.
 */
export function ClientQuoteBuilder({ projectId, code, factoryLines, initial, depositPct }: {
  projectId: string; code: string; factoryLines: FactoryLineOption[]; depositPct: number | null;
  initial: { message: string; validUntil: string; lines: ClientLineInput[] } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const empty: ClientLineInput = { description: '', qty: '1', unitPriceUsd: '', factoryLineId: '', unitCostUsd: '' };
  const [message, setMessage] = useState(initial?.message ?? '');
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? '');
  const [lines, setLines] = useState<ClientLineInput[]>(initial?.lines.length ? initial.lines : [empty]);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (i: number, patch: Partial<ClientLineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (parseQty(l.qty) ?? 0) * (centsOrNull(l.unitPriceUsd) ?? 0), 0);
  const costs = lines.filter((l) => l.description.trim()).map((l) => {
    const unit = centsOrNull(l.unitCostUsd) ?? factoryLines.find((f) => f.id === l.factoryLineId)?.unit_cost_cents ?? null;
    return unit == null ? null : unit * (parseQty(l.qty) ?? 0);
  });
  const complete = costs.length > 0 && costs.every((c) => c != null);
  const margin = quoteMargin(total, complete ? costs.reduce<number>((s, c) => s + (c ?? 0), 0) : null, complete);
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-cq-h" data-testid="tk-quote-builder"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveClientQuoteAction(projectId, code, message, validUntil, lines); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' }); if (r.ok) router.refresh(); }); }}>
      <h3 id="tk-cq-h" className="m-0 text-[15px] font-semibold">{initial ? 'Edit the draft' : 'Build the next client quote'}</h3>
      <Note msg={msg} id="tk-quote-builder-msg" />
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-3">
        <legend className="label">Lines — the client sees description, quantity, unit price and total only</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_130px] gap-2 border border-line rounded-[10px] p-3">
            <input aria-label={`Client line ${i + 1} description`} className="input min-h-11" value={l.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={500} data-testid={`tk-quote-desc-${i}`} />
            <input aria-label={`Client line ${i + 1} quantity`} className="input min-h-11" inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} data-testid={`tk-quote-qty-${i}`} />
            <input aria-label={`Client line ${i + 1} unit price in US dollars`} className="input min-h-11" inputMode="decimal" value={l.unitPriceUsd} onChange={(e) => set(i, { unitPriceUsd: e.target.value })} data-testid={`tk-quote-price-${i}`} />
            <select aria-label={`Client line ${i + 1} source factory line (staff only)`} className="input min-h-11 sm:col-span-2" value={l.factoryLineId}
              onChange={(e) => set(i, { factoryLineId: e.target.value })} data-testid={`tk-quote-source-${i}`}>
              <option value="">No factory line</option>
              {factoryLines.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <input aria-label={`Client line ${i + 1} unit cost in US dollars (staff only; empty = from the factory line)`} placeholder="Cost (staff only)" className="input min-h-11"
              inputMode="decimal" value={l.unitCostUsd} onChange={(e) => set(i, { unitCostUsd: e.target.value })} data-testid={`tk-quote-cost-${i}`} />
          </div>
        ))}
        <div><button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setLines((ls) => [...ls, empty])}>Add line</button></div>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="tk-cq-msg">Message to the client</label><input id="tk-cq-msg" className="input min-h-11" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} data-testid="tk-quote-message" /></div>
        <div><label className="label" htmlFor="tk-cq-valid">Valid until</label><input id="tk-cq-valid" type="date" className="input min-h-11" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      </div>
      <dl className="m-0 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-[13.5px]" data-testid="tk-quote-preview">
        <dt className="text-muted">Client total</dt><dd className="m-0 mono">{money(total)}</dd>
        <dt className="text-muted">Deposit</dt><dd className="m-0">{depositPct ? `${depositPct}% · ${money(depositCents(total, depositPct))}` : 'Not set — an admin sets the deposit % first'}</dd>
        <dt className="text-muted">Margin (staff only)</dt><dd className="m-0" data-testid="tk-quote-margin">{margin ? `${money(margin.cents)}${margin.pct != null ? ` (${margin.pct}%)` : ''}` : 'Unknown until every line has a cost'}</dd>
      </dl>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending} data-testid="tk-quote-save">Save draft</button></div>
    </form>
  );
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (p: () => Promise<Res>, after?: () => void) => start(async () => { const r = await p(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) { after?.(); router.refresh(); } });
  return { pending, msg, run };
}

export function QuoteDraftActions({ quoteId, code, canSend }: { quoteId: string; code: string; canSend: boolean }) {
  const { pending, msg, run } = useAct();
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id="tk-quote-send-msg" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending || !canSend} onClick={() => run(() => sendClientQuoteAction(quoteId, code))} data-testid="tk-quote-send">Send to the client</button>
        <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => run(() => discardQuoteDraftAction(quoteId, code))}>Discard draft</button>
      </div>
    </div>
  );
}

export function QuoteWithdraw({ quoteId, code }: { quoteId: string; code: string }) {
  const { pending, msg, run } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-qw-${quoteId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => withdrawClientQuoteAction(quoteId, code, reason), () => setReason('')); }}>
      <label className="label" htmlFor={id}>Withdraw this version (the client sees the reason)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Withdraw</button>
      </div>
      <Note msg={msg} id={`tk-qw-msg-${quoteId}`} />
    </form>
  );
}

/** Admins: the deposit % of new quotes (D5: from settings; the design gives no value, so it starts unset). */
export function DepositSetting({ current }: { current: number | null }) {
  const { pending, msg, run } = useAct();
  const [pct, setPct] = useState(current ? String(current) : '');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setDepositPctAction(pct)); }} data-testid="tk-deposit-setting">
      <label className="label" htmlFor="tk-deposit-pct">Deposit on accepted quotes (%)</label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input id="tk-deposit-pct" className="input min-h-11 sm:w-32" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="tk-deposit-pct" aria-describedby="tk-deposit-help" />
        <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !pct.trim()} data-testid="tk-deposit-save">Save</button>
      </div>
      <p id="tk-deposit-help" className="m-0 text-[12.5px] text-muted">{current ? `Now ${current}%.` : 'Not set: quotes cannot be sent until it is.'} A sent quote keeps the % it was sent with.</p>
      <Note msg={msg} id="tk-deposit-msg" />
    </form>
  );
}

/** DS16: admins set the deposit % for custom / branded projects (setting turnkey.deposit_pct_custom). */
export function DepositCustomSetting({ current }: { current: number | null }) {
  const { pending, msg, run } = useAct();
  const [pct, setPct] = useState(current ? String(current) : '');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setDepositPctCustomAction(pct)); }} data-testid="tk-deposit-custom-setting">
      <label className="label" htmlFor="tk-deposit-custom-pct">Deposit on custom / branded quotes (%)</label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input id="tk-deposit-custom-pct" className="input min-h-11 sm:w-32" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="tk-deposit-custom-pct" aria-describedby="tk-deposit-custom-help" />
        <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !pct.trim()} data-testid="tk-deposit-custom-save">Save</button>
      </div>
      <p id="tk-deposit-custom-help" className="m-0 text-[12.5px] text-muted">{current ? `Now ${current}%.` : 'Not set: quotes for custom / branded projects cannot be sent until it is.'} A sent quote keeps the % it was sent with.</p>
      <Note msg={msg} id="tk-deposit-custom-msg" />
    </form>
  );
}

/**
 * DS16: Turnkey editors mark a project custom / branded (owner 26 Nov: 50 % deposit) or standard (30 %). The database freezes the %
 * on each sent quote; a quote already sent keeps its %, so send a new version after changing this.
 */
export function CustomBrandedToggle({ projectId, code, custom, standardPct, customPct, canEdit }: {
  projectId: string; code: string; custom: boolean; standardPct: number | null; customPct: number | null; canEdit: boolean;
}) {
  const { pending, msg, run } = useAct();
  const [reason, setReason] = useState('');
  const pctLabel = (p: number | null) => (p ? `${p}%` : 'not set');
  const id = `tk-custom-${projectId}`;
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2 border border-line rounded-[10px] p-3" data-testid="tk-custom-branded">
      <h3 id={`${id}-h`} className="m-0 text-[15px] font-semibold">Order type: {custom ? 'custom / branded' : 'standard'}</h3>
      <p className="m-0 text-[13.5px] text-muted" data-testid="tk-custom-deposit">
        Deposit on the next quote you send: <strong>{pctLabel(custom ? customPct : standardPct)}</strong> ({custom ? 'custom / branded' : 'standard'}; standard {pctLabel(standardPct)}, custom / branded {pctLabel(customPct)}).
      </p>
      {canEdit && (
        <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => setProjectCustomAction(projectId, code, !custom, reason), () => setReason('')); }}>
          <div className="flex flex-col gap-1 flex-1">
            <label className="label" htmlFor={`${id}-reason`}>Why (internal)</label>
            <input id={`${id}-reason`} className="input min-h-11" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="tk-custom-reason" />
          </div>
          <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || reason.trim().length < 3} data-testid="tk-custom-toggle">
            {custom ? 'Mark as standard' : 'Mark as custom / branded'}
          </button>
        </form>
      )}
      <Note msg={msg} id="tk-custom-msg" />
    </section>
  );
}
