'use client';
import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import { submitShopRfq, submitSample } from '@/app/shop/actions';
import { uploadFile } from '@/app/account/sourcing/actions';
import { PanelLink } from './panel-link';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
const CUSTOM = ['Logo print', 'Custom colour', 'Branded colour box'];
const FILE_TYPES = '.jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx'; // the existing request-files rules (AI files: export a PDF)
const n = (x: number) => x.toLocaleString('en-US');

function Err({ id, msg }: { id: string; msg?: string | null }) {
  return msg ? <p id={id} className="m-0 mt-1 text-[13px] text-bad font-semibold">{msg}</p> : null;
}

/**
 * CH-1 request form (Shop_Products "Request a quote", pre-filled from the product page): quantity with MOQ check, target
 * price, ship to, customisation, notes, files → RFQ-<n>. The sourcing fee comes from settings (shown, charged in the RPC).
 * Files go to the new request with the existing request-files upload (same storage rules, safe file names).
 */
export function ShopRequestForm({ productId, title, moq, unit, defaultCountry, feeLabel }: {
  productId: string; title: string; moq: number; unit: string; defaultCountry: string | null; feeLabel: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [qty, setQty] = useState(String(moq));
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [done, setDone] = useState<{ code: string; ref: string; fileErrors: string[] } | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const q = Number(qty);
  const belowMoq = qty !== '' && Number.isFinite(q) && q > 0 && q < moq;
  const qtyMsg = belowMoq ? `Quantity is below the minimum order. Enter at least ${n(moq)}.` : err?.field === 'quantity' ? err.msg : null;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (belowMoq) { setErr({ msg: `Quantity is below the minimum order. Enter at least ${n(moq)}.`, field: 'quantity' }); return; }
    start(async () => {
      setErr(null);
      const r = await submitShopRfq({
        productId, quantity: Number(fd.get('quantity')), targetPrice: String(fd.get('target') ?? ''), country: String(fd.get('country') ?? ''),
        city: String(fd.get('city') ?? ''), customisation: fd.getAll('custom').map(String), notes: String(fd.get('notes') ?? ''), idem: key.current,
      });
      if (!r.ok) { setErr({ msg: r.error, field: r.field }); return; }
      const fileErrors: string[] = [];
      for (const f of fd.getAll('files')) {
        if (!(f instanceof File) || f.size === 0) continue;
        const up = new FormData();
        up.set('kind', 'rfq'); up.set('id', r.id); up.set('ref', r.code); up.set('file_kind', 'reference'); up.set('file', f);
        const res = await uploadFile(up);
        if (!res.ok) fileErrors.push(`${f.name}: ${res.error}`);
      }
      key.current = newKey();
      setDone({ code: r.code, ref: r.code, fileErrors });
      router.refresh();
    });
  };

  if (done) {
    return (
      <div className="card p-5" role="status" data-testid="rfq-done">
        <h3 className="m-0 text-[20px] font-bold">Request {done.code} sent</h3>
        <p className="m-0 mt-1 text-[15px] text-black">We confirm the details and send quotes from verified suppliers, usually within 2–3 business days.</p>
        {done.fileErrors.length > 0 && <p className="m-0 mt-2 text-[14px] text-bad">Some files did not upload: {done.fileErrors.join('; ')}. Add them on the request page.</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <PanelLink href={`/account/sourcing/${done.ref}`} className="min-h-11 px-4 rounded-[10px] bg-coral text-white font-semibold no-underline hover:bg-coral-text hover:text-white" testId="rfq-open">Open {done.code} in my account panel</PanelLink>
          <button type="button" className="btn btn-ghost" onClick={() => setDone(null)}>Send another request</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-4 sm:grid-cols-2" noValidate data-testid="rfq-form" aria-labelledby={`${uid}-h`}>
      <div className="sm:col-span-2">
        <h3 id={`${uid}-h`} className="m-0 text-[20px] font-bold">Request a quote</h3>
        <p className="m-0 mt-0.5 text-[14px] text-muted">Pre-filled from the product page</p>
      </div>
      <div className="sm:col-span-2"><span className="label">Product</span><p className="m-0 text-[15px] font-semibold">{title}</p></div>
      <label className="block">
        <span className="label">Quantity ({unit}) *</span>
        <input name="quantity" type="number" inputMode="numeric" min={moq} step={1} required value={qty} onChange={(e) => setQty(e.target.value)}
          aria-invalid={!!qtyMsg} aria-describedby={`${uid}-moq ${uid}-qerr`} className="input" data-testid="rfq-qty" />
        <span id={`${uid}-moq`} className="block mt-1 text-[13px] text-muted">MOQ {n(moq)}</span>
        <Err id={`${uid}-qerr`} msg={qtyMsg} />
      </label>
      <label className="block">
        <span className="label">Target price per unit (optional, USD)</span>
        <input name="target" inputMode="decimal" placeholder="e.g. 1.70" aria-invalid={err?.field === 'targetPrice'} aria-describedby={`${uid}-terr`} className="input" />
        <Err id={`${uid}-terr`} msg={err?.field === 'targetPrice' ? err.msg : null} />
      </label>
      <label className="block">
        <span className="label">Ship to *</span>
        <select name="country" required defaultValue={defaultCountry ?? ''} aria-invalid={err?.field === 'country'} aria-describedby={`${uid}-cerr`} className="input" data-testid="rfq-country">
          <option value="">Choose a country</option>
          {COUNTRY_OPTIONS.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
        </select>
        <Err id={`${uid}-cerr`} msg={err?.field === 'country' ? err.msg : null} />
      </label>
      <label className="block"><span className="label">City or port (optional)</span><input name="city" maxLength={80} className="input" placeholder="e.g. Dubai" /></label>
      <fieldset className="sm:col-span-2 border-0 p-0 m-0">
        <legend className="label">Customisation</legend>
        <div className="flex flex-wrap gap-x-6">
          {CUSTOM.map((c) => <label key={c} className="flex items-center gap-2 min-h-11 text-[15px]"><input type="checkbox" name="custom" value={c} className="w-5 h-5" />{c}</label>)}
        </div>
      </fieldset>
      <label className="block sm:col-span-2"><span className="label">Notes for our sourcing team</span><textarea name="notes" maxLength={2000} rows={3} className="input min-h-24 py-2" /></label>
      <label className="block sm:col-span-2">
        <span className="label">Files (logo, artwork, reference photos)</span>
        <input name="files" type="file" multiple accept={FILE_TYPES} className="block w-full text-[14px] min-h-11" aria-describedby={`${uid}-fhint`} />
        <span id={`${uid}-fhint`} className="block mt-1 text-[13px] text-muted">JPG, PNG, WEBP, PDF, Word or Excel, up to 20 MB each. Artwork in AI format: save it as PDF.</span>
      </label>
      <div className="sm:col-span-2 rounded-[12px] bg-tint px-4 py-3 text-[14px] text-black">
        <b>What happens next.</b> We confirm the details and send quotes from verified suppliers, usually within 2–3 business days. Your request gets a code like RFQ-1052.
        {' '}Sourcing fee: {feeLabel ?? 'not set'}.
      </div>
      {err && !['quantity', 'country', 'targetPrice'].includes(err.field ?? '') && <p role="alert" className="sm:col-span-2 m-0 text-[14px] text-bad font-semibold" data-testid="rfq-error">{err.msg}</p>}
      {err && ['quantity', 'country', 'targetPrice'].includes(err.field ?? '') && <p role="alert" className="sr-only">{err.msg}</p>}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || belowMoq} aria-describedby={belowMoq ? `${uid}-qerr` : undefined} data-testid="rfq-submit">{pending ? 'Sending…' : 'Send request'}</button>
        {belowMoq && <span className="text-[13px] text-muted">Raise the quantity to at least {n(moq)} to send.</span>}
      </div>
    </form>
  );
}

/** CH-1 "Order a sample" → SRV-<n> (existing sample service; the sample fee comes from settings). */
export function SampleForm({ productId, title, defaultCountry, feeLabel }: { productId: string; title: string; defaultCountry: string | null; feeLabel: string | null }) {
  const uid = useId();
  const router = useRouter();
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [done, setDone] = useState<{ code: string | null; id: string } | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      setErr(null);
      const r = await submitSample({ productId, productTitle: title, quantity: Number(fd.get('quantity')), country: String(fd.get('country') ?? ''), city: String(fd.get('city') ?? ''), notes: String(fd.get('notes') ?? ''), idem: key.current });
      if (!r.ok) { setErr({ msg: r.error, field: r.field }); return; }
      key.current = newKey();
      setDone({ code: r.code, id: r.id });
      router.refresh();
    });
  };
  if (done) {
    return (
      <div className="card p-5" role="status" data-testid="sample-done">
        <h3 className="m-0 text-[20px] font-bold">Sample request {done.code ?? ''} sent</h3>
        <p className="m-0 mt-1 text-[15px] text-black">We confirm the sample price and shipping, then ship it to you.</p>
        <div className="mt-4"><PanelLink href={`/account/sourcing/${done.code ?? done.id}`} className="min-h-11 font-semibold text-coral-text underline underline-offset-4">Follow it in my account panel</PanelLink></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="card p-5 grid gap-4 sm:grid-cols-3" noValidate data-testid="sample-form" aria-labelledby={`${uid}-h`}>
      <div className="sm:col-span-3"><h3 id={`${uid}-h`} className="m-0 text-[20px] font-bold">Order a sample</h3><p className="m-0 mt-0.5 text-[14px] text-muted">Sample fee: {feeLabel ?? 'not set'}. You get a code like SRV-1016.</p></div>
      <label className="block"><span className="label">Number of samples *</span>
        <input name="quantity" type="number" min={1} max={5} defaultValue={1} required className="input" aria-invalid={err?.field === 'quantity'} aria-describedby={`${uid}-q`} />
        <span id={`${uid}-q`} className="block mt-1 text-[13px] text-muted">1 to 5</span>
      </label>
      <label className="block"><span className="label">Ship to *</span>
        <select name="country" required defaultValue={defaultCountry ?? ''} className="input" aria-invalid={err?.field === 'country'}>
          <option value="">Choose a country</option>
          {COUNTRY_OPTIONS.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
        </select>
      </label>
      <label className="block"><span className="label">City (optional)</span><input name="city" maxLength={80} className="input" /></label>
      <label className="block sm:col-span-3"><span className="label">Notes (colour, size, anything to check)</span><textarea name="notes" maxLength={2000} rows={2} className="input min-h-20 py-2" /></label>
      {err && <p role="alert" className="sm:col-span-3 m-0 text-[14px] text-bad font-semibold">{err.msg}</p>}
      <div className="sm:col-span-3"><button type="submit" className="btn btn-dark" disabled={pending} data-testid="sample-submit">{pending ? 'Sending…' : 'Order a sample'}</button></div>
    </form>
  );
}
