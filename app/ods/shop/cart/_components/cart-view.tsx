'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Info, PackageOpen, Send, ShieldAlert, ShoppingCart, Truck } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, Field, Icon, Input, Money, NamedTabLink, Select, Tabs, Textarea, buttonClass, cx, formatNumber } from '@octopus/ui';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import type { CartActionResult, CartTab, CartView } from '../../_lib/cart-types';
import { useMiniCart } from '../../_components/mini-cart';
import {
  CHECKOUT_PATH, checkoutLabel, checkoutReason, dutyText, newIdemKey, recheckSummary, sendLabel, sendReason, shipToText, summaryRows,
  type CartPageActions,
} from '../_lib/cart-ui';
import { BuyLineRow, QuoteLineRow, SavedLineRow } from './cart-lines';

/**
 * ODS T5a · /shop/cart (Part 5.8, Match Cart_Page / M_Cart_Page / States-Cart). Presentational: the page passes the
 * re-checked CartView (getCart({ recheck: true })) and the cart server actions; every action returns the whole cart,
 * which replaces the state here and in the mini-cart context (header count). No money moves here.
 * Phones: stacked lines and a checkout bar fixed above the BottomNav.
 */
export type CartPageViewProps = {
  cart: CartView;
  initialTab: CartTab;
  actions: CartPageActions;
  /** Fixtures: start in the "quote request sent" state. */
  initialSent?: { code: string; lines: number } | null;
};

type Msg = { tone: 'error' | 'ok'; text: string } | null;

export function CartPageView({ cart: initial, initialTab, actions, initialSent = null }: CartPageViewProps) {
  const mini = useMiniCart();
  const [cart, setCart] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState('');
  const [sent, setSent] = useState(initialSent);
  const [shipOpen, setShipOpen] = useState(false);
  const idem = useRef(newIdemKey());
  const roleId = useId();
  const s = cart.summary;
  const disabledBy = cart.canAct ? undefined : roleId;

  const apply = (r: CartActionResult, okText?: string) => {
    if (r.ok) {
      setCart(r.cart);
      mini?.sync(r.cart);
      setMsg(okText ? { tone: 'ok', text: okText } : null);
      return true;
    }
    setMsg({ tone: 'error', text: r.message });
    if (r.code === 'SHIP_TO_REQUIRED') setShipOpen(true);
    return false;
  };
  const run = (key: string, fn: () => Promise<CartActionResult>, okText?: string) =>
    start(async () => {
      setBusy(key);
      try {
        apply(await fn(), okText);
      } catch {
        setMsg({ tone: 'error', text: 'Something went wrong. Nothing was changed; try again.' });
      } finally {
        setBusy(null);
      }
    });

  const quoteLines = cart.quote.map((l) => {
    const d = qtyDraft[l.id];
    const q = d === undefined ? l.qty : d;
    return { ...l, belowMoq: q == null ? true : q < l.moq };
  });
  const sReason = sendReason(cart, quoteLines);
  const cReason = checkoutReason(cart, s.buyCount);
  const recheck = dismissed ? null : recheckSummary(cart.notices);

  const send = () =>
    start(async () => {
      setBusy('send');
      try {
        const r = await actions.sendQuoteRequest({ notes: notes.trim(), idem: idem.current });
        if (apply(r) && r.ok && r.data) {
          idem.current = newIdemKey();
          setNotes('');
          setQtyDraft({});
          setSent({ code: r.data.code, lines: r.data.lines });
        }
      } catch {
        setMsg({ tone: 'error', text: 'We couldn’t send the request. Nothing was sent; try again.' });
      } finally {
        setBusy(null);
      }
    });

  const buyPanel = (
    <section aria-labelledby="cart-buy-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
      <PanelHead id="cart-buy-h" icon={ShoppingCart} title={`Buy now · ${formatNumber(s.buyCount)} ${s.buyCount === 1 ? 'item' : 'items'}`} desc="Fixed prices: samples, ready stock, pool deposits, branding and warehouse services." />
      {cart.buy.length ? (
        <ul role="list" className="m-0 mt-2 list-none p-0">
          {cart.buy.map((l) => (
            <BuyLineRow
              key={`${l.id}-${l.qty}`}
              line={l}
              canAct={cart.canAct}
              disabledBy={disabledBy}
              pending={busy === l.id}
              onQty={(qty) => run(l.id, () => actions.cartUpdateQty({ id: l.id, qty }))}
              onSave={() => run(l.id, () => actions.cartSaveForLater({ id: l.id, line: 'buy', saved: true }), `${l.title} saved for later.`)}
              onRemove={() => run(l.id, () => actions.cartRemove({ id: l.id, line: 'buy' }), `${l.title} removed.`)}
            />
          ))}
        </ul>
      ) : s.headerCount === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Add samples, ready stock or products you want a quote for."
          headingLevel={3}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button href="/shop">Browse the shop</Button>
              <Button href="/request/sourcing" variant="secondary" iconStart={Send}>
                Request a product
              </Button>
            </div>
          }
        />
      ) : (
        <EmptyState icon={PackageOpen} title="Nothing to buy now" description="Samples, ready stock and pool places you add show here with a fixed price." headingLevel={3} action={<Button href="/shop" variant="secondary">Browse the shop</Button>} />
      )}
    </section>
  );

  const quotePanel = (
    <section aria-labelledby="cart-quote-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
      <PanelHead id="cart-quote-h" icon={Send} title={`Get a quote · ${formatNumber(s.quoteCount)} ${s.quoteCount === 1 ? 'product' : 'products'}`} desc="Prices come back as a quote (RFQ number) in My account › Sourcing requests." />
      {sent ? (
        <div role="status" className="mt-3 flex flex-col gap-3 rounded-ods-card border border-ods-teal bg-ods-success-tint p-4 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between" data-testid="quote-sent">
          <div>
            <p className="m-0 text-ods-body font-bold text-ods-navy">
              {sent.code} sent for {formatNumber(sent.lines)} {sent.lines === 1 ? 'product' : 'products'}.
            </p>
            <p className="m-0 mt-1 text-ods-small text-ods-text">Our sourcing team replies in My account › Sourcing requests.</p>
          </div>
          <NamedTabLink tab="account" href={`/account/requests/${encodeURIComponent(sent.code)}`} className={cx(buttonClass('secondary', 'md'), 'shrink-0')} data-testid="quote-sent-link">
            Open {sent.code}
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            <span className="sr-only">(opens the My account tab)</span>
          </NamedTabLink>
        </div>
      ) : null}
      {cart.quote.length ? (
        <>
          <ul role="list" className="m-0 mt-2 list-none p-0">
            {cart.quote.map((l) => (
              <QuoteLineRow
                key={`${l.id}-${l.qty}-${l.targetPriceMinor}-${l.customisation}`}
                line={l}
                canAct={cart.canAct}
                disabledBy={disabledBy}
                pending={busy === l.id}
                onDraft={(q) => setQtyDraft((m) => ({ ...m, [l.id]: q }))}
                onCommit={(d) => {
                  if (d.qty === l.qty && d.targetPriceMinor === l.targetPriceMinor && (d.customisation ?? null) === (l.customisation === 'none' ? null : l.customisation)) return;
                  run(l.id, async () => {
                    const r = await actions.quoteUpdate({ id: l.id, ...d });
                    if (!r.ok && r.code === 'cart-not-ready') {
                      return { ...r, message: 'Target price and customisation can be saved once the new cart is live. Add them in the notes below for now.' };
                    }
                    return r;
                  });
                }}
                onSave={() => run(l.id, () => actions.cartSaveForLater({ id: l.id, line: 'quote', saved: true }), `${l.title} saved for later.`)}
                onRemove={() => run(l.id, () => actions.cartRemove({ id: l.id, line: 'quote' }), `${l.title} removed.`)}
              />
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3 border-t border-ods-line pt-4">
            <Field label="Notes for all products" optional disabled={!cart.canAct}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Delivery date, packaging, anything else" disabled={!cart.canAct} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button iconStart={Send} onClick={send} loading={busy === 'send'} loadingText="Sending…" disabled={!!sReason} data-testid="send-quote" aria-describedby={sReason ? 'send-reason' : undefined}>
                {sendLabel(cart.quote.length)}
              </Button>
              {sReason ? (
                <p id="send-reason" className="m-0 text-ods-small font-semibold text-ods-danger" data-testid="send-reason">
                  {sReason}
                </p>
              ) : null}
            </div>
            <p className="m-0 text-ods-small text-ods-slate">One request for all the products above. Follow it in My account › Sourcing requests.</p>
          </div>
        </>
      ) : sent ? null : (
        <EmptyState icon={Send} title="No products waiting for a quote" description="Use Add to cart on a factory product. We send one quote request for all of them." headingLevel={3} action={<Button href="/shop/products" variant="secondary">Find products</Button>} />
      )}
    </section>
  );

  const savedPanel = (
    <section aria-labelledby="cart-saved-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
      <PanelHead id="cart-saved-h" icon={PackageOpen} title={`Saved for later · ${formatNumber(s.savedCount)}`} desc="Kept here without buying or asking for a quote. Move a line back when you're ready." />
      {cart.saved.length ? (
        <ul role="list" className="m-0 mt-2 list-none p-0">
          {cart.saved.map((l) => (
            <SavedLineRow
              key={l.id}
              line={l}
              canAct={cart.canAct}
              disabledBy={disabledBy}
              pending={busy === l.id}
              onMove={() => run(l.id, () => actions.cartSaveForLater({ id: l.id, line: l.line, saved: false }), `${l.title} moved back to your cart.`)}
              onRemove={() => run(l.id, () => actions.cartRemove({ id: l.id, line: l.line }), `${l.title} removed.`)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState icon={PackageOpen} title="Nothing saved for later" description="Use Save for later on a line to keep it here." headingLevel={3} />
      )}
    </section>
  );

  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 px-ods-pad-page py-6 pb-28 ods-tablet:pb-6" data-testid="cart-page">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Cart' }]} />
      <div className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-end ods-tablet:justify-between">
        <div>
          <h1 className="m-0 text-ods-h1 text-ods-navy">Your cart</h1>
          <p className="m-0 mt-1 text-ods-body text-ods-slate">Buy now pays at checkout. Get a quote sends one request for prices.</p>
        </div>
        <ShipTo cart={cart} open={shipOpen} setOpen={setShipOpen} disabledBy={disabledBy} onSave={(country, city) => run('ship', () => actions.cartSetShipTo({ country, city: city || undefined }), 'Delivery country saved.')} pending={busy === 'ship'} />
      </div>

      {!cart.canAct ? (
        <Note id={roleId} tone="info" icon={Info} testId="role-note" title="You can look, but not change the cart">
          {cart.roleReason ?? 'Your role can browse only.'}
        </Note>
      ) : null}
      {!cart.verified ? (
        <Note tone="warning" icon={ShieldAlert} testId="unverified-note" title="Verify your company to pay">
          You can fill the cart and send quote requests now. Paying opens after verification; your cart is kept.{' '}
          <NamedTabLink tab="account" href="/account/kyc" className="font-semibold text-ods-blue underline underline-offset-4">
            Verify in My account
            <span className="sr-only"> (opens the My account tab)</span>
          </NamedTabLink>
        </Note>
      ) : null}
      {recheck ? (
        <section aria-labelledby="recheck-h" className="flex flex-col gap-3 rounded-ods-card border border-ods-warning/40 bg-ods-warning-tint p-4 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between" data-testid="recheck-banner">
          <div className="min-w-0">
            <h2 id="recheck-h" className="m-0 text-ods-body font-bold text-ods-navy">
              {recheck.title}
            </h2>
            <ul className="m-0 mt-1 ps-5 text-ods-small text-ods-text">
              {recheck.lines.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <Button variant="secondary" onClick={() => setDismissed(true)} className="shrink-0 self-start ods-tablet:self-center" data-testid="recheck-ok">
            {recheck.hasPrice ? 'OK, update' : 'OK'}
          </Button>
        </section>
      ) : null}
      <p role="status" aria-live="polite" className={msg ? cx('m-0 rounded-ods-control px-3 py-2 text-ods-small font-semibold', msg.tone === 'error' ? 'bg-ods-danger-tint text-ods-danger' : 'bg-ods-success-tint text-ods-navy') : 'sr-only'} data-testid="cart-message">
        {msg?.text ?? ''}
      </p>

      <div className="grid items-start gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs
          label="Cart parts"
          param="tab"
          defaultValue={initialTab}
          data-testid="cart-tabs"
          panelClassName="pt-4"
          items={[
            { id: 'buy', label: 'Buy now', count: s.buyCount, panel: buyPanel, testId: 'cart-tab-buy' },
            { id: 'quote', label: 'Get a quote', count: s.quoteCount, panel: quotePanel, testId: 'cart-tab-quote' },
            { id: 'saved', label: 'Saved for later', count: s.savedCount, panel: savedPanel, testId: 'cart-tab-saved' },
          ]}
        />
        <Summary cart={cart} reason={cReason} />
      </div>

      {s.buyCount ? (
        <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-(--z-sticky) border-t border-ods-line bg-ods-surface px-ods-pad-page py-3 shadow-ods-pop ods-tablet:hidden" data-testid="checkout-bar">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-ods-small text-ods-slate">Buy now subtotal</p>
              <p className="m-0 text-ods-h2 font-bold text-ods-navy">
                <Money amount={s.subtotalMinor / 100} />
              </p>
            </div>
            <Button href={CHECKOUT_PATH} disabled={!!cReason} aria-describedby={cReason ? 'checkout-reason' : undefined}>
              Checkout
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelHead({ id, icon, title, desc }: { id: string; icon: typeof Send; title: string; desc: string }) {
  return (
    <div className="border-b border-ods-line pb-3">
      <h2 id={id} className="m-0 flex items-center gap-2 text-ods-h2 text-ods-navy">
        <Icon icon={icon} size="sm" className="text-ods-blue" />
        {title}
      </h2>
      <p className="m-0 mt-1 text-ods-small text-ods-slate">{desc}</p>
    </div>
  );
}

function Note({ id, tone, icon, title, children, testId }: { id?: string; tone: 'info' | 'warning'; icon: typeof Info; title: string; children: ReactNode; testId: string }) {
  return (
    <div id={id} className={cx('flex items-start gap-3 rounded-ods-card border p-4', tone === 'warning' ? 'border-ods-warning/40 bg-ods-warning-tint' : 'border-ods-line bg-ods-info-tint')} data-testid={testId}>
      <Icon icon={icon} size="md" className={cx('mt-0.5 shrink-0', tone === 'warning' ? 'text-ods-warning' : 'text-ods-info')} />
      <div className="min-w-0">
        <p className="m-0 text-ods-body font-bold text-ods-navy">{title}</p>
        <p className="m-0 mt-1 text-ods-small text-ods-text">{children}</p>
      </div>
    </div>
  );
}

function ShipTo({ cart, open, setOpen, onSave, pending, disabledBy }: { cart: CartView; open: boolean; setOpen: (v: boolean) => void; onSave: (country: string, city: string) => void; pending: boolean; disabledBy?: string }) {
  const place = shipToText(cart.shipTo);
  const formId = useId();
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const country = String(fd.get('country') ?? '');
    if (!country) {
      setErr('Choose a country.');
      return;
    }
    setErr(null);
    onSave(country, String(fd.get('city') ?? '').trim());
    setOpen(false);
  };
  return (
    <div className="flex flex-col gap-2 ods-tablet:items-end" data-testid="ship-to">
      <p className="m-0 flex flex-wrap items-center gap-x-1 text-ods-body text-ods-text">
        <Icon icon={Truck} size="sm" className="text-ods-slate" />
        Ships to <strong className="text-ods-navy">{place ?? 'not set yet'}</strong>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="inline-flex min-h-[calc(var(--ods-control-h)-12px)] items-center font-semibold text-ods-blue underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => setOpen(!open)}
          disabled={!cart.canAct || pending}
          aria-describedby={cart.canAct ? undefined : disabledBy}
          data-testid="ship-to-change"
        >
          {place ? 'Change' : 'Set'}
          <span className="sr-only"> delivery country</span>
        </button>
      </p>
      {open ? (
        <form id={formId} onSubmit={submit} noValidate className="flex w-full flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 ods-tablet:w-[420px]" data-testid="ship-to-form">
          <Field label="Country" required error={err ?? undefined}>
            <Select name="country" defaultValue={cart.shipTo.country ?? ''} placeholder="Choose a country">
              {COUNTRY_OPTIONS.map(([c, label]) => (
                <option key={c} value={c}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City or port" optional>
            <Input name="city" maxLength={80} defaultValue={cart.shipTo.city ?? ''} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending} loadingText="Saving…">
              Save
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Summary({ cart, reason }: { cart: CartView; reason: string | null }) {
  const s = cart.summary;
  const rows = summaryRows(s);
  const place = cart.shipTo.city ?? cart.shipTo.countryName ?? cart.shipTo.country;
  const parcels = cart.buy.some((l) => l.kind === 'sample') && cart.buy.some((l) => l.kind === 'stock');
  return (
    <div className="flex flex-col gap-4 ods-desktop:sticky ods-desktop:top-[calc(var(--shop-header-h,68px)+16px)]">
      <section aria-labelledby="cart-summary-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card" data-testid="summary">
        <h2 id="cart-summary-h" className="m-0 text-ods-h2 text-ods-navy">
          Buy now: summary
        </h2>
        <dl className="m-0 mt-3 flex flex-col gap-2 text-ods-table">
          {rows.map((r) => (
            <div key={r.kind} className="flex items-baseline justify-between gap-3">
              <dt className="text-ods-slate">{r.label}</dt>
              <dd className="m-0 font-semibold text-ods-navy">
                <Money amount={r.minor / 100} />
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ods-slate">Shipping{place ? ` to ${place}` : ''}</dt>
            <dd className="m-0 text-end text-ods-text">Chosen at checkout</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3" data-testid="summary-duty">
            <dt className="text-ods-slate">Duty and VAT</dt>
            <dd className="m-0 text-end text-ods-text">{dutyText(s.dutyEstimate)}</dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ods-line pt-3">
            <dt className="text-ods-body font-bold text-ods-navy">Subtotal</dt>
            <dd className="m-0 text-ods-h2 font-bold text-ods-navy" data-testid="summary-subtotal">
              <Money amount={s.subtotalMinor / 100} />
            </dd>
          </div>
        </dl>
        {s.heldDepositMinor > 0 ? (
          <p className="m-0 mt-2 text-ods-small text-ods-slate">
            Includes <Money amount={s.heldDepositMinor / 100} /> of pool deposits, held until the pool fills and returned if it doesn&apos;t.
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <Button href={CHECKOUT_PATH} fullWidth disabled={!!reason} data-testid="checkout-link" aria-describedby={reason ? 'checkout-reason' : undefined}>
            {checkoutLabel(s.buyCount)}
          </Button>
          {reason ? (
            <p id="checkout-reason" className="m-0 text-center text-ods-small text-ods-slate">
              {reason}
            </p>
          ) : (
            <p className="m-0 text-center text-ods-small text-ods-slate">Online payment opens in the next step. Your cart is saved.</p>
          )}
        </div>
      </section>
      {parcels ? (
        <div className="rounded-ods-card border border-ods-line bg-ods-info-tint p-4 text-ods-small text-ods-text">
          <p className="m-0 font-bold text-ods-navy">Ships in more than one parcel</p>
          <p className="m-0 mt-1">Samples go by express; ready stock by sea or air. You choose at checkout.</p>
        </div>
      ) : null}
    </div>
  );
}
