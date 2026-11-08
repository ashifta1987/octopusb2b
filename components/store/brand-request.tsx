'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Icon, NewBadge, Notice } from '@/components/ds';
import { createBrandProject, type BrandPayload } from '@/app/(store)/request/brand/actions';

export type BrandProduct = { id: string; title: string; image_url: string | null };
export type MethodOpt = { key: string; name: string; body: string; moq: number | null; days: string | null };

const PACKAGING = [
  { key: 'standard', name: 'Plain box with your label', body: 'Factory box with your sticker or printed label.' },
  { key: 'colour_box', name: 'Branded colour box', body: 'Retail box printed with your brand and product details.' },
  { key: 'gift_box', name: 'Premium gift box', body: 'Rigid box for gifting and higher price points.' },
  { key: 'unsure', name: 'Not sure yet', body: 'Your account manager suggests options.' },
];
const MARKETS: [string, string][] = [['AE', 'UAE'], ['SA', 'Saudi Arabia'], ['KW', 'Kuwait'], ['QA', 'Qatar'], ['US', 'United States'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['AU', 'Australia']];
const STORES = ['Shopify', 'WooCommerce', 'Not yet'];
const LOGO = /\.(svg|ai|eps|pdf|png)$/i;
const STEP_NAMES = ['Product', 'Brand', 'Delivery and stores'];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex items-center min-h-11 px-4 rounded-full border text-[14px] font-medium ${on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line-strong hover:border-ink'}`}>{children}</button>;
}
function RadioCard({ name, value, checked, onChange, title, body, extra }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; body?: string; extra?: React.ReactNode }) {
  return (
    <label className={`flex gap-3 rounded-[12px] border p-4 cursor-pointer ${checked ? 'border-ink bg-tint shadow-[inset_0_0_0_1px_var(--ink)]' : 'border-line-strong bg-white hover:border-ink'}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 w-4 h-4 accent-ink" />
      <span className="min-w-0"><span className="block font-semibold text-ink text-[15px]">{title}</span>{body && <span className="block text-[13px] text-muted mt-0.5">{body}</span>}{extra}</span>
    </label>
  );
}

/** ADDON-44-F board 26 — Make My Brand request: 3 steps, private logo upload, summary, creates MB-xxxx. */
export function BrandRequestWizard({ products, methods, initialProduct, orgId, mode, loginHref, countries }: {
  products: BrandProduct[]; methods: MethodOpt[]; initialProduct: string | null; orgId: string | null;
  mode: 'ready' | 'guest' | 'no-org'; loginHref: string; countries: [string, string][];
}) {
  const [step, setStep] = useState(0);
  const [productId, setProductId] = useState<string | null>(initialProduct);
  const [link, setLink] = useState('');
  const [useLink, setUseLink] = useState(false);
  const [qty, setQty] = useState('');
  const [markets, setMarkets] = useState<string[]>([]);
  const [method, setMethod] = useState('');
  const [packaging, setPackaging] = useState('');
  const [colours, setColours] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [dest, setDest] = useState<'warehouse' | 'bulk' | ''>('');
  const [bulkCountry, setBulkCountry] = useState('');
  const [stores, setStores] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const product = products.find((p) => p.id === productId) ?? null;
  const qtyOk = qty === '' || (/^\d+$/.test(qty) && +qty > 0);
  const reasons = [
    [!(useLink ? /^https?:\/\/\S+/.test(link) : productId) && (useLink ? 'Paste a product link starting with https://' : 'Choose a product'), !qtyOk && 'Enter the quantity as a whole number', markets.length === 0 && 'Choose at least one target market'].filter(Boolean) as string[],
    [!method && 'Choose a branding method', !packaging && 'Choose packaging', files.length === 0 && 'Upload your logo'].filter(Boolean) as string[],
    [!dest && 'Choose where your stock goes', dest === 'bulk' && !bulkCountry && 'Choose the country for the bulk shipment', stores.length === 0 && 'Tell us about your store'].filter(Boolean) as string[],
  ];

  async function addFiles(list: FileList | null) {
    setFileErr(null);
    const picked = Array.from(list ?? []);
    for (const f of picked) {
      if (!LOGO.test(f.name)) { setFileErr(`${f.name}: use SVG, AI, EPS, PDF or PNG.`); return; }
      if (f.size > 20 * 1024 * 1024) { setFileErr(`${f.name}: files up to 20 MB.`); return; }
      if (/\.png$/i.test(f.name)) {
        const dims = await new Promise<{ w: number; h: number }>((res) => { const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res({ w: 0, h: 0 }); img.src = URL.createObjectURL(f); });
        if (Math.max(dims.w, dims.h) < 2000) { setFileErr(`${f.name} is ${dims.w} × ${dims.h} px. PNG logos need at least 2000 px on the long side, or send SVG, AI or PDF.`); return; }
      }
    }
    setFiles((x) => [...x, ...picked].slice(0, 5));
  }

  async function send() {
    if (!orgId) return;
    setErr(null);
    const paths: string[] = [];
    try {
      const sb = createClient();
      for (const [i, f] of files.entries()) {
        setBusy(`Uploading logo ${i + 1} of ${files.length}…`);
        const path = `${orgId}/${crypto.randomUUID()}-${f.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-60)}`;
        const up = await sb.storage.from('brand-logos').upload(path, f, { contentType: f.type || 'application/octet-stream' });
        if (up.error) throw new Error(`Upload failed for ${f.name}: ${up.error.message}`);
        paths.push(path);
      }
      setBusy('Sending your request…');
      const payload: BrandPayload = {
        product_id: useLink ? null : productId, product_link: useLink ? link : undefined, quantity: qty || undefined, markets,
        method, packaging, colours: colours || undefined, logo_paths: paths, stock_destination: dest as 'warehouse' | 'bulk',
        bulk_country: dest === 'bulk' ? bulkCountry : undefined, stores, note: note || undefined,
      };
      const r = await createBrandProject(payload);
      if (!r.ok) throw new Error(r.error);
      setDone(r.ref);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the request.');
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="card p-6 sm:p-8 text-center" data-testid="brand-success">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ok-bg text-ok"><Icon name="check" /></span>
        <h2 className="mt-3 text-[22px] font-extrabold">Request sent</h2>
        <p className="mt-1 text-black">Your brand project reference is <b className="mono text-ink" data-testid="brand-ref">{done}</b>. Your account manager has been told and sends a proof and a quote before you pay anything.</p>
        <Link href={`/account/brand?project=${done}`} className="btn btn-primary btn-pub mt-5">Open my brand project</Link>
      </div>
    );
  }

  const section = (title: string, n: number) => (
    <div className="flex items-center justify-between gap-2 border-b border-line pb-2"><h3 className="font-bold text-ink">{title}</h3><button type="button" onClick={() => setStep(n)} className="text-coral-text font-semibold text-[14px] min-h-11 px-2">Edit</button></div>
  );

  return (
    <div className="card p-5 sm:p-7" data-testid="brand-wizard">
      {mode === 'guest' && <div className="mb-5"><Notice>Sign in to send a brand request. <Link href={loginHref} className="inline-flex items-center min-h-11 underline font-semibold">Sign in or create an account</Link>.</Notice></div>}
      {mode === 'no-org' && <div className="mb-5"><Notice tone="warn">Please <Link href="/onboarding" className="underline font-semibold">complete your company profile</Link> before sending requests.</Notice></div>}

      <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
        {STEP_NAMES.map((n, i) => (
          <li key={n} aria-current={i === step ? 'step' : undefined}>
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-coral' : 'bg-line'}`} />
            <div className={`mt-2 text-[13px] ${i === step ? 'font-bold text-ink' : 'text-muted'}`}><span className="mono">{i + 1}</span> · {n}</div>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-6">
        {step === 0 && (
          <>
            <fieldset>
              <legend className="label">Product <span className="text-bad" aria-hidden>*</span></legend>
              {!useLink ? (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3" data-testid="brand-products">
                  {products.map((p) => (
                    <label key={p.id} className={`rounded-[12px] border overflow-hidden cursor-pointer ${productId === p.id ? 'border-ink shadow-[inset_0_0_0_2px_var(--ink)]' : 'border-line-strong hover:border-ink'}`}>
                      <input type="radio" name="product" value={p.id} checked={productId === p.id} onChange={() => setProductId(p.id)} className="sr-only" />
                      <div className="relative aspect-square bg-pearl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.image_url && <img src={p.image_url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                        {productId === p.id && <span className="absolute top-2 right-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink text-white"><Icon name="check" size={14} /></span>}
                      </div>
                      <div className="p-2.5 text-[13px] font-semibold text-ink line-clamp-2">{p.title}</div>
                    </label>
                  ))}
                </div>
              ) : (
                <input className="input" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Product link" />
              )}
              <button type="button" className="mt-2 text-coral-text font-semibold text-[14px] min-h-11" onClick={() => setUseLink((x) => !x)}>{useLink ? 'Choose from verified products instead' : 'I have a product link'}</button>
              <p className="text-[12.5px] text-muted">Only products from verified suppliers can be branded. A link is checked by your account manager first.</p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="mb-qty" className="label">Quantity (units)</label><input id="mb-qty" inputMode="numeric" className="input" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Your account manager confirms the minimum" /></div>
            </div>
            <fieldset><legend className="label">Target markets <span className="text-bad" aria-hidden>*</span></legend><div className="flex flex-wrap gap-2">{MARKETS.map(([c, n]) => <Chip key={c} on={markets.includes(c)} onClick={() => toggle(markets, c, setMarkets)}>{n}</Chip>)}</div></fieldset>
          </>
        )}

        {step === 1 && (
          <>
            <fieldset><legend className="label">Branding method <span className="text-bad" aria-hidden>*</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[...methods, { key: 'unsure', name: 'Not sure yet', body: 'Your account manager recommends what works for this product.', moq: null, days: null }].map((m) => (
                  <RadioCard key={m.key} name="method" value={m.key} checked={method === m.key} onChange={() => setMethod(m.key)} title={m.name} body={m.body}
                    extra={m.key !== 'unsure' ? <span className="block text-[12.5px] text-muted mt-1">Minimum {m.moq ? `${m.moq.toLocaleString('en-US')} units` : 'to be confirmed'} · extra time {m.days ?? 'to be confirmed'}</span> : null} />
                ))}
              </div>
            </fieldset>
            <fieldset><legend className="label">Packaging <span className="text-bad" aria-hidden>*</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">{PACKAGING.map((p) => <RadioCard key={p.key} name="packaging" value={p.key} checked={packaging === p.key} onChange={() => setPackaging(p.key)} title={p.name} body={p.body} />)}</div>
            </fieldset>
            <div>
              <label htmlFor="mb-logo" className="label">Your logo <span className="text-bad" aria-hidden>*</span></label>
              <label htmlFor="mb-logo" className="flex flex-col items-center justify-center gap-1.5 rounded-[12px] border-2 border-dashed border-line-strong bg-pearl p-6 text-center cursor-pointer hover:border-ink"
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }} data-testid="logo-drop">
                <Icon name="doc" size={24} className="text-muted" />
                <span className="font-semibold text-ink">Drop your logo here or choose a file</span>
                <span className="text-[12.5px] text-muted">SVG, AI, EPS, PDF, or PNG at least 2000 px · up to 20 MB</span>
              </label>
              <input id="mb-logo" type="file" multiple accept=".svg,.ai,.eps,.pdf,.png" className="sr-only" onChange={(e) => void addFiles(e.target.files)} />
              {fileErr && <p className="text-[13px] text-bad mt-1.5" role="alert">{fileErr}</p>}
              {files.length > 0 && (
                <ul className="mt-2 space-y-1.5">{files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-[14px]"><span className="truncate">{f.name}</span><button type="button" className="text-bad font-semibold min-h-11 px-2" onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}>Remove</button></li>
                ))}</ul>
              )}
              <p className="mt-2 text-[12.5px] text-muted flex gap-1.5"><Icon name="shield" size={15} />Your files are private: only you, your account manager and the approved proof go to the factory.</p>
            </div>
            <div><label htmlFor="mb-col" className="label">Brand colours</label><input id="mb-col" className="input" value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Pantone or hex codes, e.g. Pantone 2945 C" /></div>
          </>
        )}

        {step === 2 && (
          <>
            <fieldset><legend className="label">Where does your stock go? <span className="text-bad" aria-hidden>*</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <RadioCard name="dest" value="warehouse" checked={dest === 'warehouse'} onChange={() => setDest('warehouse')} title="Octopus warehouse" body="Kept as your stock and shipped order by order from your store." />
                <RadioCard name="dest" value="bulk" checked={dest === 'bulk'} onChange={() => setDest('bulk')} title="Bulk to a country" body="Cartons shipped to your own warehouse or distributor." />
              </div>
              {dest === 'bulk' && (
                <div className="mt-3 max-w-[320px]"><label htmlFor="mb-country" className="label">Country</label>
                  <select id="mb-country" className="input" value={bulkCountry} onChange={(e) => setBulkCountry(e.target.value)}><option value="">Select country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
              )}
            </fieldset>
            <fieldset><legend className="label">Your store <span className="text-bad" aria-hidden>*</span></legend><div className="flex flex-wrap gap-2">{STORES.map((s) => <Chip key={s} on={stores.includes(s)} onClick={() => setStores(s === 'Not yet' ? ['Not yet'] : [...stores.filter((x) => x !== 'Not yet' && x !== s), ...(stores.includes(s) ? [] : [s])])}>{s}</Chip>)}</div></fieldset>
            <div><label htmlFor="mb-note" className="label">Anything else?</label><textarea id="mb-note" rows={3} className="input py-2.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deadline, inspiration, questions" /></div>

            <div className="rounded-[12px] border border-line p-4 space-y-4" data-testid="brand-summary">
              <div>{section('Product', 0)}<p className="mt-2 text-[14px] text-black">{useLink ? link : product?.title}{qty ? ` · ${(+qty).toLocaleString('en-US')} units` : ''} · {markets.map((m) => MARKETS.find(([c]) => c === m)?.[1]).join(', ')}</p></div>
              <div>{section('Brand', 1)}<p className="mt-2 text-[14px] text-black">{[...methods, { key: 'unsure', name: 'Not sure yet' }].find((m) => m.key === method)?.name} · {PACKAGING.find((p) => p.key === packaging)?.name} · {files.length} logo file{files.length === 1 ? '' : 's'}{colours ? ` · ${colours}` : ''}</p></div>
            </div>
            <div className="rounded-[12px] bg-pearl border border-line p-4 text-[14px]">
              <div className="flex justify-between font-semibold text-ink"><span className="flex items-center gap-2">Make My Brand request <NewBadge /></span><span>Free</span></div>
              <p className="mt-1 text-black">Your account manager sends a quote with the final price, delivery date, duties and shipping before you pay anything.</p>
            </div>
          </>
        )}
      </div>

      {err && <div className="mt-5"><Notice tone="bad">{err}</Notice></div>}
      {reasons[step].length > 0 && <p className="mt-5 text-[13px] text-muted" data-testid="next-reason">To continue: {reasons[step].join(' · ')}.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || !!busy}>Back</button>
        {step < 2 ? (
          <button type="button" className="btn btn-primary" disabled={reasons[step].length > 0} onClick={() => setStep((s) => s + 1)} data-testid="brand-next">Next</button>
        ) : mode === 'ready' ? (
          <button type="button" className="btn btn-primary" disabled={reasons[2].length > 0 || reasons[1].length > 0 || reasons[0].length > 0 || !!busy} onClick={send} data-testid="brand-send">{busy ?? 'Send request'}</button>
        ) : (
          <Link href={loginHref} className="btn btn-primary">Sign in to send</Link>
        )}
      </div>
      <p className="mt-3 text-[13px] text-muted">You get a reference number right away. Follow it in My account › Make My Brand.</p>
    </div>
  );
}

