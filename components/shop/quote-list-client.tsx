'use client';
import Link from 'next/link';
import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { money } from '@/lib/format';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import { ProductImage } from '@/components/store/product-card';
import { updateQuoteItem, removeQuoteItem, sendQuoteList } from '@/app/shop/actions';
import { PanelLink } from './panel-link';

export type QuoteLine = {
  id: string; productId: string; quantity: number; notes: string; title: string; slug: string | null; image: string | null;
  unit: string; moq: number; available: boolean; price: number | null; currency: string;
};
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
const n = (x: number) => x.toLocaleString('en-US');

/** CH-1 quote list: edit quantities (MOQ shown and checked), notes, remove; "Send all as one request" → one RFQ-<n> with lines. */
export function QuoteListClient({ lines, canAct, roleReason, defaultCountry, feeLabel }: {
  lines: QuoteLine[]; canAct: boolean; roleReason: string; defaultCountry: string | null; feeLabel: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.quantity)])));
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, l.notes])));
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; lines: number } | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const below = lines.filter((l) => l.available && Number(qty[l.id]) < l.moq);
  const gone = lines.filter((l) => !l.available);
  const blocked = below.length > 0 || gone.length > 0;

  const save = (l: QuoteLine) => start(async () => {
    const q = Number(qty[l.id]);
    if (!Number.isInteger(q) || q <= 0) { setErr(`Quantity for ${l.title}: enter a whole number above 0.`); return; }
    if (q === l.quantity && (notes[l.id] ?? '') === l.notes) return;
    const r = await updateQuoteItem(l.id, q, notes[l.id] ?? '');
    if (!r.ok) setErr(r.error); else { setErr(null); router.refresh(); }
  });
  const remove = (l: QuoteLine) => start(async () => {
    const r = await removeQuoteItem(l.id);
    if (!r.ok) setErr(r.error); else { setErr(null); router.refresh(); }
  });
  const send = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      // save any edited quantities first, so what is sent is what is shown
      for (const l of lines) {
        const q = Number(qty[l.id]);
        if (l.available && (q !== l.quantity || (notes[l.id] ?? '') !== l.notes)) {
          const u = await updateQuoteItem(l.id, q, notes[l.id] ?? '');
          if (!u.ok) { setErr(u.error); return; }
        }
      }
      const r = await sendQuoteList({ country: String(fd.get('country') ?? ''), city: String(fd.get('city') ?? ''), notes: String(fd.get('notes') ?? ''), idem: key.current });
      if (!r.ok) { setErr(r.error); return; }
      key.current = newKey();
      setDone({ code: r.code, lines: r.lines });
      router.refresh();
    });
  };

  if (done) {
    return (
      <div className="mt-6 card p-6" role="status" data-testid="quote-list-done">
        <h2 className="m-0 text-[22px] font-bold">Request {done.code} sent with {done.lines} {done.lines === 1 ? 'product' : 'products'}</h2>
        <p className="m-0 mt-1 text-[15px] text-black">We confirm the details and send quotes from verified suppliers, usually within 2–3 business days. Your quote list is empty again.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <PanelLink href={`/account/sourcing/${done.code}`} className="min-h-11 px-4 rounded-[10px] bg-coral text-white font-semibold no-underline hover:bg-coral-text hover:text-white" testId="quote-list-open">Open {done.code} in my account panel</PanelLink>
          <Link href="/shop/products" className="btn btn-ghost">Keep shopping</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <ul className="list-none m-0 p-0 flex flex-col gap-3" data-testid="quote-list-items">
        {lines.map((l) => {
          const q = Number(qty[l.id]);
          const low = l.available && q < l.moq;
          return (
            <li key={l.id} className="card p-4 grid grid-cols-[72px_1fr] sm:grid-cols-[96px_1fr] gap-4" data-testid="quote-line">
              <ProductImage src={l.image} alt={l.title} className="aspect-square rounded-[10px]" width={96} height={96} />
              <div className="min-w-0 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="m-0 text-[16px] font-semibold leading-snug">
                    {l.slug ? <Link href={`/shop/products/${l.slug}`} className="text-ink underline underline-offset-4 decoration-line-strong hover:text-coral-text">{l.title}</Link> : l.title}
                  </h2>
                  {canAct && (
                    <button type="button" onClick={() => remove(l)} disabled={pending} className="btn btn-ghost btn-sm !min-h-11 !px-3" aria-label={`Remove ${l.title} from the quote list`}>
                      <Trash2 size={16} strokeWidth={1.9} aria-hidden />
                    </button>
                  )}
                </div>
                {!l.available ? <p className="m-0 text-[14px] text-bad font-semibold">No longer available. Remove it to send the list.</p> : (
                  <>
                    <div className="text-[14px] text-muted">{l.price != null ? <>From {money(l.price, l.currency)} / unit · </> : null}MOQ {n(l.moq)} {l.unit}</div>
                    <div className="grid sm:grid-cols-[160px_1fr] gap-3">
                      <label className="block"><span className="label">Quantity ({l.unit})</span>
                        <input type="number" min={l.moq} step={1} value={qty[l.id] ?? ''} disabled={!canAct}
                          onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} onBlur={() => canAct && save(l)}
                          aria-invalid={low} aria-describedby={low ? `${uid}-${l.id}-e` : undefined} className="input" data-testid="line-qty" />
                      </label>
                      <label className="block"><span className="label">Notes (optional)</span>
                        <input value={notes[l.id] ?? ''} maxLength={1000} disabled={!canAct} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} onBlur={() => canAct && save(l)} className="input" />
                      </label>
                    </div>
                    {low && <p id={`${uid}-${l.id}-e`} className="m-0 text-[13px] text-bad font-semibold">Quantity is below the minimum order. Enter at least {n(l.moq)}.</p>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={send} className="card p-5 flex flex-col gap-4 lg:sticky lg:top-4" noValidate aria-labelledby={`${uid}-send`} data-testid="quote-list-send">
        <h2 id={`${uid}-send`} className="m-0 text-[20px] font-bold">Send as one request</h2>
        <p className="m-0 text-[14px] text-black">{lines.length} {lines.length === 1 ? 'product' : 'products'} · one request code · sourcing fee {feeLabel}.</p>
        <label className="block"><span className="label">Ship to *</span>
          <select name="country" required defaultValue={defaultCountry ?? ''} className="input" disabled={!canAct} data-testid="list-country">
            <option value="">Choose a country</option>
            {COUNTRY_OPTIONS.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">City or port (optional)</span><input name="city" maxLength={80} className="input" disabled={!canAct} /></label>
        <label className="block"><span className="label">Notes for our sourcing team</span><textarea name="notes" rows={3} maxLength={2000} className="input min-h-24 py-2" disabled={!canAct} /></label>
        {err && <p role="alert" className="m-0 text-[14px] text-bad font-semibold" data-testid="quote-list-error">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={!canAct || pending || blocked} aria-describedby={`${uid}-why`} data-testid="send-list">
          {pending ? 'Sending…' : 'Send all as one request'}
        </button>
        <p id={`${uid}-why`} className="m-0 text-[13px] text-muted">
          {!canAct ? roleReason
            : gone.length ? 'Remove the products that are no longer available first.'
              : below.length ? `Raise the quantity of ${below.map((l) => l.title).join(', ')} to at least the MOQ first.`
                : 'We send quotes for every product in one place.'}
        </p>
      </form>
    </div>
  );
}
