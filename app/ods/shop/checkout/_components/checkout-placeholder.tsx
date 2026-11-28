'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, CreditCard, ShieldAlert } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, Icon, Money, NamedTabLink, Stepper, buttonClass, cx, formatNumber } from '@octopus/ui';
import { writeSaved } from '@/components/store/pools/join-form';
import type { BuyLine, CartView } from '../../_lib/cart-types';
import { CART_PATH, cartTabHref, dueNowMinor, shipToText, todayStep } from '../../cart/_lib/cart-ui';
import { KindTag, LineImage } from '../../cart/_components/line-parts';

/**
 * ODS T5a · /shop/checkout placeholder (Part 5.9 look, Cart_Checkout). Online payment is T5b (card provider not chosen),
 * so NO money moves and NO orders are created here. The stepper is shown disabled; each Buy now line offers today's way
 * to complete it now (sample → the sample request; pool → today's join step with the units saved the T4 way;
 * stock / brand / service → Ask for a quote). Unverified company → "Verify your company to pay" (cart kept).
 */
export type CheckoutPlaceholderProps = { cart: CartView; titleLevel?: 1 | 2 };

const STEPS = [
  { id: 'delivery', label: 'Delivery', detail: 'Address', status: 'upcoming' as const },
  { id: 'shipping', label: 'Shipping', detail: 'Per parcel', status: 'upcoming' as const },
  { id: 'payment', label: 'Payment', detail: 'Wallet, card or bank transfer', status: 'upcoming' as const },
  { id: 'review', label: 'Review', detail: 'Check and place order', status: 'upcoming' as const },
];

function TodayAction({ line }: { line: BuyLine }) {
  const router = useRouter();
  const step = todayStep(line);
  if (step.kind === 'pool') {
    return (
      <Button
        variant="secondary"
        size="sm"
        iconEnd={ArrowRight}
        onClick={() => {
          // T4 way: today's JoinPoolForm reads the saved units as its starting quantity
          writeSaved(step.code, { qty: step.qty, savedAt: new Date().toISOString() });
          router.push(step.href);
        }}
        data-testid="today-action"
      >
        {step.label}
        <span className="sr-only">: {line.title}</span>
      </Button>
    );
  }
  return (
    <Link href={step.href} className={cx(buttonClass('secondary', 'sm'), 'shrink-0')} data-testid="today-action">
      {step.label}
      <span className="sr-only">: {line.title}</span>
      <Icon icon={ArrowRight} size="xs" className="rtl:-scale-x-100" />
    </Link>
  );
}

export function CheckoutPlaceholder({ cart, titleLevel = 1 }: CheckoutPlaceholderProps) {
  const H = titleLevel === 2 ? 'h2' : 'h1';
  const S = titleLevel === 2 ? 'h3' : 'h2';
  const s = cart.summary;
  const place = shipToText(cart.shipTo);
  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 px-ods-pad-page py-6" data-testid="checkout-placeholder" data-verified={cart.verified}>
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Cart', href: CART_PATH }, { label: 'Checkout' }]} />
      <div>
        <H className="m-0 text-ods-h1 text-ods-navy">Checkout</H>
        <p className="m-0 mt-1 text-ods-body text-ods-slate">
          {formatNumber(s.buyCount)} {s.buyCount === 1 ? 'item' : 'items'}
          {place ? ` · ships to ${place}` : ''}
        </p>
      </div>

      <div aria-disabled="true" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card opacity-70" data-testid="checkout-stepper">
        <Stepper steps={STEPS} current={-1} label="Checkout steps (not open yet)" />
      </div>

      {!cart.verified ? (
        <section aria-labelledby="verify-h" className="flex flex-col gap-3 rounded-ods-card border border-ods-warning/40 bg-ods-warning-tint p-ods-pad-card ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between" data-testid="checkout-verify">
          <div className="flex items-start gap-3">
            <Icon icon={ShieldAlert} size="lg" className="mt-0.5 shrink-0 text-ods-warning" />
            <div>
              <S id="verify-h" className="m-0 text-ods-body font-bold text-ods-navy">
                Verify your company to pay.
              </S>
              <p className="m-0 mt-1 text-ods-small text-ods-text">Your cart is saved. You can still finish samples, pools and quotes the ways below.</p>
            </div>
          </div>
          <NamedTabLink tab="account" href="/account/kyc" className={cx(buttonClass('primary', 'md'), 'shrink-0')}>
            Verify in My account
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            <span className="sr-only">(opens the My account tab)</span>
          </NamedTabLink>
        </section>
      ) : null}

      <section aria-labelledby="pay-soon-h" className="flex items-start gap-3 rounded-ods-card border border-ods-line bg-ods-info-tint p-ods-pad-card">
        <Icon icon={CreditCard} size="lg" className="mt-0.5 shrink-0 text-ods-info" />
        <div>
          <S id="pay-soon-h" className="m-0 text-ods-body font-bold text-ods-navy">
            Online payment opens in the next step. Your cart is saved.
          </S>
          <p className="m-0 mt-1 text-ods-small text-ods-text">Until then, finish each item the way it works today. Nothing is charged on this page.</p>
        </div>
      </section>

      <div className="grid items-start gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="today-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
          <S id="today-h" className="m-0 text-ods-h2 text-ods-navy">
            Finish your items now
          </S>
          {cart.buy.length ? (
            <ul role="list" className="m-0 mt-2 list-none p-0">
              {cart.buy.map((l) => (
                <li key={l.id} className="flex flex-col gap-3 border-t border-ods-line py-4 first:border-t-0 ods-tablet:flex-row ods-tablet:items-center" data-testid="checkout-line" data-kind={l.kind}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <LineImage image={l.image} size={48} />
                    <div className="min-w-0">
                      <KindTag kind={l.kind} />
                      <p className="m-0 mt-1 text-ods-body font-semibold text-ods-navy">
                        {l.title} <span className="font-normal text-ods-slate">× {formatNumber(l.qty)}</span>
                      </p>
                      {l.subLine ? <p className="m-0 text-ods-small text-ods-slate">{l.subLine}</p> : null}
                    </div>
                  </div>
                  <span className="text-ods-body font-semibold text-ods-navy">
                    <Money amount={dueNowMinor(l) / 100} />
                  </span>
                  <TodayAction line={l} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing to check out" description="Add samples, ready stock or a pool place to your cart first." headingLevel={titleLevel === 2 ? 4 : 3} action={<Button href={CART_PATH} variant="secondary">Back to your cart</Button>} />
          )}
          {s.quoteCount ? (
            <p className="m-0 mt-3 border-t border-ods-line pt-3 text-ods-small text-ods-text">
              {formatNumber(s.quoteCount)} {s.quoteCount === 1 ? 'product is' : 'products are'} still waiting for a quote.{' '}
              <Link href={cartTabHref('quote')} className="font-semibold text-ods-blue underline underline-offset-4">
                Send the quote request
              </Link>
            </p>
          ) : null}
        </section>
        <section aria-labelledby="co-sum-h" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
          <S id="co-sum-h" className="m-0 text-ods-h2 text-ods-navy">
            Order summary
          </S>
          <dl className="m-0 mt-3 flex flex-col gap-2 text-ods-table">
            {cart.buy.map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate text-ods-text">
                  {l.title} × {formatNumber(l.qty)}
                </dt>
                <dd className="m-0 font-semibold text-ods-navy">
                  <Money amount={dueNowMinor(l) / 100} />
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ods-slate">Shipping</dt>
              <dd className="m-0 text-ods-text">Chosen at checkout</dd>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ods-line pt-3">
              <dt className="font-bold text-ods-navy">Subtotal</dt>
              <dd className="m-0 text-ods-h2 font-bold text-ods-navy">
                <Money amount={s.subtotalMinor / 100} />
              </dd>
            </div>
          </dl>
          <Button fullWidth disabled disabledReason="Online payment opens in the next step." className="mt-4" data-testid="place-order">
            Place order
          </Button>
        </section>
      </div>
    </div>
  );
}
