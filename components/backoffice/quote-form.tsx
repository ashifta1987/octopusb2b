'use client';
import { ActionForm, type ActionResult } from './action-form';
import { INCOTERMS } from './product-schema';
import { CURRENCY_PREFIX, asCurrency } from '@/lib/format';

/** Quote form used by distributors (on behalf of assigned suppliers) and back office (any supplier). */
export function QuoteForm({ action, suppliers, defaultQty, defaultIncoterm, unit, idPrefix, currency }: {
  action: (fd: FormData) => Promise<ActionResult>; suppliers: { id: string; label: string; disabled?: boolean }[];
  defaultQty: number; defaultIncoterm?: string | null; unit?: string | null; idPrefix: string;
  /** Platform currency — send_quote locks quotes in it (SPEC §15.1). */
  currency: string;
}) {
  if (!suppliers.length) return <p className="text-sm text-muted">No suppliers available to quote for (check assignments and “RFQ replies” switches).</p>;
  const id = (k: string) => `${idPrefix}-${k}`;
  const cur = asCurrency(currency);
  return (
    <ActionForm action={action} submitLabel="Send quote" resetOnSuccess confirm={`Send this quote to the buyer? Prices are in ${cur}.`}>
      <p className="text-sm text-muted mb-3">Prices in <b className="text-navy">{cur}</b> ({CURRENCY_PREFIX[cur]}) — the platform currency. The quote locks this currency and the current approved rate.</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-3">
          <label htmlFor={id('sup')} className="label">Supplier *</label>
          <select id={id('sup')} name="supplier_id" className="input" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id} disabled={s.disabled}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={id('price')} className="label">Unit price ({cur}) *</label>
          <input id={id('price')} name="unit_price" type="number" step="0.001" min="0.001" required className="input mono" />
        </div>
        <div>
          <label htmlFor={id('qty')} className="label">Quantity{unit ? ` (${unit})` : ''} *</label>
          <input id={id('qty')} name="quantity" type="number" min={1} defaultValue={defaultQty} required className="input mono" />
        </div>
        <div>
          <label htmlFor={id('inc')} className="label">Incoterm</label>
          <select id={id('inc')} name="incoterm" className="input" defaultValue={defaultIncoterm && INCOTERMS.includes(defaultIncoterm) ? defaultIncoterm : 'FOB'}>
            {INCOTERMS.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={id('lead')} className="label">Lead time (days) *</label>
          <input id={id('lead')} name="lead_days" type="number" min={0} defaultValue={15} required className="input mono" />
        </div>
        <div>
          <label htmlFor={id('ship')} className="label">Shipping ({cur})</label>
          <input id={id('ship')} name="shipping" type="number" step="0.01" min="0" defaultValue="0" className="input mono" />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor={id('notes')} className="label">Notes to buyer</label>
          <textarea id={id('notes')} name="notes" className="input min-h-16 py-2" placeholder="Packaging, certificates, payment terms…" />
        </div>
      </div>
    </ActionForm>
  );
}
