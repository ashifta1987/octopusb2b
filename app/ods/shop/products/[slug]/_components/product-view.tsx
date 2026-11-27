'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Box, Plus, Send, Sparkles, Tag, Users } from 'lucide-react';
import { Breadcrumbs, Button, Card, EmptyState, Icon, Money, RadioCards, Segmented, Tabs, cx, formatMoney } from '@octopus/ui';
import { priceForQuantity } from '../../_lib/price';
import type { AddToCartFn, LoadSimilarFn, ProductPageVM, ShopActor, SubmitRfqFn, SubmitSampleFn } from '../../_lib/types';
import { ProductGallery } from './gallery';
import { PriceCalculator, TierTable, calcReason } from './price-calculator';
import { RfqDrawer, SampleDrawer } from './request-drawers';
import { SimilarProducts } from './similar-products';

export type ProductPageViewProps = {
  product: ProductPageVM;
  actor: ShopActor;
  submitRfq?: SubmitRfqFn;
  submitSample?: SubmitSampleFn;
  addToCart?: AddToCartFn;
  loadSimilar?: LoadSimilarFn;
  /** recordView (Recently viewed) — called once after the page shows in the browser. */
  onView?: (productId: string) => Promise<void>;
  /** Start quantity (default the MOQ). */
  initialQuantity?: number;
  /** Open the quote drawer on load (?quote=1 from a card's Request quote). */
  openQuote?: boolean;
  /** Fixtures: cards in Similar products don't call the server. */
  demo?: boolean;
};

const n = (x: number) => x.toLocaleString('en-US');
const NO_SAMPLE_REASON = 'Samples aren’t offered for this product. Ask in your quote request.';
const MMB_HREF = (id: string) => `/request/brand?product=${encodeURIComponent(id)}`;

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ods-line py-2.5" data-testid={testId}>
      <dt className="text-ods-slate">{label}</dt>
      <dd className="m-0 text-end text-ods-text">{children}</dd>
    </div>
  );
}

/**
 * /shop/products/[slug] (Part 5.4, Match Nav_ProductTabs / Shop_ProductPage / M_Shop_ProductPage). Presentational: the
 * page passes customer-safe props and today's server actions. White-label: "Ships from China" only; no supplier name,
 * code, model number, cost or margin is ever in the props.
 */
export function ProductPageView({ product: p, actor, submitRfq, submitSample, addToCart, loadSimilar, onView, initialQuantity, openQuote, demo }: ProductPageViewProps) {
  const [qty, setQty] = useState(String(initialQuantity ?? p.moq));
  const [custom, setCustom] = useState<string>('none');
  const [rfqOpen, setRfqOpen] = useState(!!openQuote);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [ship, setShip] = useState<'sea' | 'air'>('sea');
  const [cartPending, startCart] = useTransition();
  const [cartMsg, setCartMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    onView?.(p.id).catch(() => {});
  }, [onView, p.id]);
  useEffect(() => {
    // cards link to "#request" (toSourcingCard quoteHref) or "?quote=1": open the quote drawer (subscribe to the hash)
    const sync = () => {
      if (window.location.hash === '#request' && actor.canAct) setRfqOpen(true);
    };
    const t = window.setTimeout(sync, 0);
    window.addEventListener('hashchange', sync);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('hashchange', sync);
    };
  }, [actor.canAct]);

  const quantity = Number(qty.replace(/,/g, ''));
  const result = useMemo(() => priceForQuantity(p.tiers, qty.trim() === '' ? null : quantity, p.moq), [p.tiers, p.moq, qty, quantity]);
  const reason = calcReason(result, { unitPlural: p.unitPlural, pool: !!p.pool });
  const qtyOk = result.status === 'ok' || result.status === 'no-tiers';
  const quoteReason = !actor.canAct ? (actor.reason ?? 'Your role can browse only.') : result.status === 'below-moq' ? `Minimum order ${n(result.minimum)} ${p.unitPlural}.` : result.status === 'invalid' ? 'Enter a quantity first.' : undefined;
  const cartReason = !actor.canAct ? 'Your role can browse only.' : !qtyOk ? 'Raise the quantity to the minimum first.' : undefined;
  const sampleReason = !actor.canAct ? 'Your role can browse only.' : !p.samplesAvailable ? NO_SAMPLE_REASON : undefined;
  const fromCents = p.tiers.length ? Math.min(...p.tiers.map((t) => t.unitCents)) : null;
  const sampleText = p.sampleCents == null ? 'On request' : p.sampleCents === 0 ? 'Free' : formatMoney(p.sampleCents / 100, { currency: p.currency });
  const highlight = result.status === 'ok' ? result.tierIndex : undefined;

  const addCart = () =>
    startCart(async () => {
      if (!addToCart) return;
      setCartMsg(null);
      const r = await addToCart(p.id, quantity);
      setCartMsg(r.ok ? { ok: true, text: `Added to your cart (${r.count}).` } : { ok: false, text: r.error });
    });

  const badges = [
    ...(p.verified ? [{ label: 'Verified supplier', cls: 'bg-ods-success-tint text-ods-success' }] : []),
    ...(p.customisable ? [{ label: 'Customisable', cls: 'bg-ods-info-tint text-ods-info' }] : []),
    ...(p.samplesAvailable ? [{ label: 'Samples available', cls: 'bg-ods-info-tint text-ods-info' }] : []),
  ];

  const specsPanel = p.specs.length ? (
    <Card title="Specifications" headingLevel={2} bodyClassName="p-0">
      <table className="hidden w-full border-collapse text-ods-body ods-tablet:table" data-testid="specs-table">
        <thead>
          <tr className="bg-ods-canvas text-ods-small text-ods-slate">
            <th scope="col" className="w-1/3 px-4 py-2 text-start font-semibold">
              Spec
            </th>
            <th scope="col" className="px-4 py-2 text-start font-semibold">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {p.specs.map((s, i) => (
            <tr key={s.name + i} className="border-t border-ods-line">
              <th scope="row" className="px-4 py-2.5 text-start font-normal text-ods-text">
                {s.name}
              </th>
              <td className="px-4 py-2.5">{s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="m-0 flex flex-col ods-tablet:hidden" data-testid="specs-list">
        {p.specs.map((s, i) => (
          <div key={s.name + i} className="border-t border-ods-line px-4 py-2.5 first:border-t-0">
            <dt className="text-ods-small text-ods-slate">{s.name}</dt>
            <dd className="m-0 text-ods-body">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  ) : (
    <Card>
      <EmptyState title="No specifications listed yet" description="Ask for the details you need in your quote request." headingLevel={2} />
    </Card>
  );

  const customisePanel = (
    <Card title="Customise it" headingLevel={2}>
      {p.customise.length ? (
        <div className="flex flex-col gap-4">
          <RadioCards
            legend="Customisation for your quote"
            legendHidden
            columns={2}
            value={custom}
            onValueChange={setCustom}
            options={[
              ...p.customise.map((c) => ({ value: c.value, label: c.label, description: `${c.minimum} · ${c.description}` })),
              { value: 'none', label: 'No customisation', description: 'The product as listed.' },
            ]}
            hint="Your choice is added to the quote request."
            data-testid="customise-options"
          />
          <Button variant="secondary" iconStart={Sparkles} href={MMB_HREF(p.id)} className="self-start">
            Add your brand with Make My Brand
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-ods-body text-ods-text">This product isn’t listed as customisable. Ask in your quote request, or brand it with Make My Brand.</p>
          <Button variant="secondary" iconStart={Sparkles} href={MMB_HREF(p.id)}>
            Add your brand with Make My Brand
          </Button>
        </div>
      )}
    </Card>
  );

  const shippingPanel = (
    <Card title="Shipping and duties" headingLevel={2}>
      <dl className="m-0 text-ods-body">
        <Fact label="Ships from">{p.shipsFrom}</Fact>
        {p.incoterm ? <Fact label="Incoterm">{p.incoterm}</Fact> : null}
        <Fact label="Shipping estimate">{p.shippingEstimate ? `Sea: ${p.shippingEstimate.sea ?? 'quoted at order'} · Air: ${p.shippingEstimate.air ?? 'quoted at order'}` : 'Quoted at order'}</Fact>
        {p.hsCode ? <Fact label="HS code">{`${p.hsCode}${p.hsIndicative ? ' (indicative)' : ''}`}</Fact> : null}
        <Fact label="Import duties">Depend on your country; confirmed in your quote</Fact>
        {p.packing ? <Fact label="Packing">{p.packing}</Fact> : null}
      </dl>
      {p.shippingNotes.map((t) => (
        <p key={t} className="m-0 mt-3 text-ods-small text-ods-slate">
          {t}
        </p>
      ))}
      <p className="m-0 mt-3 text-ods-small text-ods-slate">Certificates and test reports are sent on request with your quote.</p>
    </Card>
  );

  const questionsPanel = (
    <Card title="Questions" headingLevel={2}>
      {p.questions.length ? (
        <div className="flex flex-col divide-y divide-ods-line" data-testid="questions">
          {p.questions.map((q) => (
            <details key={q.q} className="group py-1">
              <summary className="flex min-h-ods-control cursor-pointer items-center font-semibold text-ods-navy">{q.q}</summary>
              <p className="m-0 pb-3 text-ods-body text-ods-text">{q.a}</p>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState title="No questions yet" description="Ask yours in the quote request. Our sourcing team answers within the quote." headingLevel={3} />
      )}
    </Card>
  );

  const detailsPanel = (
    <Card title="Details" headingLevel={2}>
      {p.description ? <p className="m-0 max-w-[75ch] text-ods-body whitespace-pre-line text-ods-text">{p.description}</p> : <p className="m-0 text-ods-body text-ods-slate">No description yet. Ask for details in your quote request.</p>}
    </Card>
  );

  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-6 px-ods-pad-page py-6" data-testid="product-page">
      <Breadcrumbs items={p.breadcrumbs} />

      <div className="grid items-start gap-8 ods-desktop:grid-cols-2">
        <ProductGallery images={p.images} title={p.title} />

        <div className="flex min-w-0 flex-col gap-4">
          {badges.length ? (
            <ul role="list" className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="product-badges">
              {badges.map((b) => (
                <li key={b.label} className={cx('inline-flex items-center rounded-ods-pill px-2.5 py-0.5 text-ods-small font-semibold', b.cls)}>
                  {b.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <h1 className="m-0 text-ods-h1 text-ods-navy">{p.title}</h1>
            {p.summary ? <p className="m-0 mt-2 text-ods-body text-ods-slate">{p.summary}</p> : null}
          </div>

          <Card title={<span className="inline-flex items-center gap-2"><Icon icon={Tag} size="sm" />Price by quantity</span>} headingLevel={2} bodyClassName="p-0">
            {p.tiers.length ? (
              <TierTable tiers={p.tiers} unit={p.unit} currency={p.currency} highlight={highlight} />
            ) : (
              <p className="m-0 px-ods-pad-card pb-ods-pad-card text-ods-body text-ods-slate" data-testid="price-on-request">
                Price on request: send a quote request and we quote you.
              </p>
            )}
          </Card>

          <Card title={<span className="inline-flex items-center gap-2"><Icon icon={Tag} size="sm" />Price for your quantity</span>} headingLevel={2} data-testid="price-calculator">
            <PriceCalculator quantity={qty} onQuantityChange={setQty} result={result} reason={reason} unit={p.unit} unitPlural={p.unitPlural} moq={p.moq} currency={p.currency} />
          </Card>

          <dl className="m-0 text-ods-body" data-testid="product-facts">
            {fromCents != null ? (
              <Fact label="From">
                <Money amount={fromCents / 100} currency={p.currency} suffix={`per ${p.unit}`} />
              </Fact>
            ) : null}
            <Fact label="Minimum order">{`${n(p.moq)} ${p.moq === 1 ? p.unit : p.unitPlural}`}</Fact>
            <Fact label="Delivery">{p.leadDays ? `${p.leadDays} days after deposit` : 'On request'}</Fact>
            <Fact label="Sample">{p.samplesAvailable ? sampleText : 'Not offered'}</Fact>
            <Fact label="Ships from" testId="ships-from">
              {p.shipsFrom}
            </Fact>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ods-line py-2.5" data-testid="shipping-estimate">
              <dt className="text-ods-slate">Estimated shipping</dt>
              <dd className="m-0 flex flex-wrap items-center justify-end gap-3 text-end">
                {p.shippingEstimate ? (
                  <>
                    <Segmented label="Shipping method" value={ship} onChange={(v) => setShip(v as 'sea' | 'air')} options={[{ value: 'sea', label: 'Sea' }, { value: 'air', label: 'Air' }]} />
                    <span aria-live="polite">{(ship === 'sea' ? p.shippingEstimate.sea : p.shippingEstimate.air) ?? 'Quoted at order'}</span>
                  </>
                ) : (
                  'Quoted at order'
                )}
              </dd>
            </div>
          </dl>

          {p.pool ? (
            <p className="m-0 flex flex-wrap items-center gap-2 rounded-ods-card bg-ods-blue-tint px-4 py-3 text-ods-body text-ods-text" data-testid="pool-note">
              <Icon icon={Users} size="sm" />
              This product is in an open MOQ pool: buy below the factory minimum.
              <Link href={`/shop/pools/${encodeURIComponent(p.pool.code)}`} className="font-semibold text-ods-navy underline underline-offset-4">
                See the pool
              </Link>
            </p>
          ) : null}

          <div className="flex flex-wrap items-start gap-3" data-testid="product-actions">
            <Button iconStart={Send} onClick={() => setRfqOpen(true)} disabled={!!quoteReason} disabledReason={quoteReason} data-testid="request-quote">
              Request quote
            </Button>
            {addToCart || demo ? (
              <Button variant="secondary" iconStart={Plus} onClick={addCart} loading={cartPending} loadingText="Adding…" disabled={!!cartReason} disabledReason={cartReason} data-testid="add-to-cart">
                Add to cart
              </Button>
            ) : null}
            <Button variant="secondary" iconStart={Box} onClick={() => setSampleOpen(true)} disabled={!!sampleReason} disabledReason={sampleReason} data-testid="order-sample">
              Order a sample
            </Button>
          </div>
          <p role="status" aria-live="polite" className={cx('m-0 text-ods-small', cartMsg ? (cartMsg.ok ? 'text-ods-success' : 'text-ods-danger') : 'sr-only')}>
            {cartMsg?.text ?? ''}
            {cartMsg?.ok ? (
              <>
                {' '}
                <Link href="/shop/quote-list" className="font-semibold text-ods-blue underline underline-offset-4">
                  View cart
                </Link>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <Tabs
        label="Product sections"
        param="tab"
        sticky
        stickyTop="var(--ods-shop-sticky-top, 0px)"
        data-testid="product-tabs"
        defaultValue="details"
        items={[
          { id: 'details', label: 'Details', panel: detailsPanel, testId: 'tab-details' },
          { id: 'specifications', label: 'Specifications', panel: specsPanel, testId: 'tab-specifications' },
          { id: 'customise', label: 'Customise', panel: customisePanel, testId: 'tab-customise' },
          { id: 'shipping', label: 'Shipping and duties', panel: shippingPanel, testId: 'tab-shipping' },
          { id: 'questions', label: 'Questions', count: p.questions.length, panel: questionsPanel, testId: 'tab-questions' },
          {
            id: 'similar',
            label: 'Similar products',
            testId: 'tab-similar',
            panel: () => (
              <section aria-labelledby="similar-h" className="flex flex-col gap-4">
                <h2 id="similar-h" className="m-0 text-ods-h2 text-ods-navy">
                  Similar products
                </h2>
                <SimilarProducts productId={p.id} categoryId={p.categoryId} load={loadSimilar} canAct={actor.canAct} demo={demo} />
              </section>
            ),
          },
        ]}
      />

      <RfqDrawer
        open={rfqOpen}
        onClose={() => setRfqOpen(false)}
        productId={p.id}
        title={p.title}
        quantity={qtyOk ? quantity : p.moq}
        moq={p.moq}
        unitPlural={p.unitPlural}
        defaultCountry={actor.country}
        customisation={custom !== 'none' ? [custom] : []}
        submit={submitRfq}
      />
      <SampleDrawer open={sampleOpen} onClose={() => setSampleOpen(false)} productId={p.id} title={p.title} defaultCountry={actor.country} feeText={sampleText} submit={submitSample} />
    </div>
  );
}
