'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Info, Users } from 'lucide-react';
import { Button, Field, Icon, Money, QuantityStepper, formatNumber } from '@octopus/ui';
import { writeSaved } from '@/components/store/pools/join-form';
import { currencyPrefix, defaultUnits, joinTotals, major, poolStep, snapUnits, unitWord, type PoolView } from '../_lib/pool-logic';
import { useMiniCart } from '../../_components/mini-cart';
import { cartTabHref, isCartNotReady, type CartAddFn } from '../../cart/_lib/cart-ui';

export type PoolJoinFormProps = {
  pool: Pick<PoolView, 'id' | 'code' | 'title' | 'unit' | 'currency' | 'minPledge' | 'depositPct' | 'tiers' | 'filledQty' | 'targetQty'>;
  /** Units step; pools have no step today, so 1. */
  step?: number;
  /** Start value (fixtures: the minimum to show the "below minimum" reason). Default = today's default pledge. */
  initialUnits?: number;
  /** Where Join pool continues: today's join step on the pool page (address, deposit payment, Group Buy Terms). */
  continueHref: string;
  /** T5a: Join pool adds a pool line to the cart (deposit held at checkout) and opens the mini-cart. Without it, or while the
   *  cart isn't set up ('cart-not-ready'), Join pool continues to today's join step as in T4. */
  cartAdd?: CartAddFn;
  /** Fixtures: no navigation, a sample message instead. */
  demo?: boolean;
  headingLevel?: 2 | 3;
};

/**
 * ODS T4 · Join this pool (Part 5.5): units from the minimum in steps (QuantityStepper), product total,
 * "Pay now ([deposit %] deposit, held)" with the pool's own deposit %, balance "When the pool fills, before shipping",
 * and the "What if the pool doesn't fill?" note. Same maths as today's JoinPoolForm.
 *
 * T5a: Join pool → cartAdd({ kind: 'pool', refId: pool id, qty }) + the mini-cart. Fallback (no cart yet): TODAY's join flow: the chosen units are stored with today's
 * "Save, decide later" helper (writeSaved → localStorage `octopus.pools.saved`, which today's JoinPoolForm reads as its
 * starting quantity) and the browser goes to `/pool/<code>#join-h`, where the existing form takes the delivery address,
 * the deposit payment (wallet with ConfirmCharge, or bank transfer) and the Group Buy Terms, and calls joinPool().
 */
export function PoolJoinForm({ pool, step: stepProp, initialUnits, continueHref, cartAdd, demo, headingLevel = 2 }: PoolJoinFormProps) {
  const mini = useMiniCart();
  const [pending, start] = useTransition();
  const [cartHref, setCartHref] = useState<string | null>(null);
  const H = headingLevel === 3 ? 'h3' : 'h2';
  const router = useRouter();
  const step = poolStep(stepProp);
  const [units, setUnits] = useState(() => initialUnits ?? snapUnits(defaultUnits(pool), { min: pool.minPledge, step }));
  const [note, setNote] = useState<string | null>(null);
  const totals = joinTotals(pool, units);
  const cur = currencyPrefix(pool.currency);
  const u = (n: number) => unitWord(pool.unit, n);
  const hint = `From ${formatNumber(pool.minPledge)} ${u(pool.minPledge)}${step > 1 ? `, in steps of ${formatNumber(step)}` : ''}.`;

  return (
    <section aria-labelledby="join-title" data-testid="join-form" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
      <H id="join-title" className="m-0 text-ods-h2 text-ods-navy">
        Join this pool
      </H>
      <Field label="Your units" hint={hint}>
        <QuantityStepper
          value={units}
          onValueChange={(n) => setUnits(snapUnits(n, { min: pool.minPledge, step }))}
          min={pool.minPledge}
          step={step}
          unit={u(2)}
          minReason={`The minimum for this pool is ${formatNumber(pool.minPledge)} ${u(pool.minPledge)}.`}
          data-testid="join-units"
        />
      </Field>
      {totals ? (
        <dl className="m-0 flex flex-col gap-2 text-ods-body">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-ods-slate">Product total</dt>
            <dd className="m-0 font-semibold text-ods-navy" data-testid="join-total">
              <Money amount={major(totals.productTotalMinor)} currency={cur} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-ods-slate">Pay now ({formatNumber(pool.depositPct)}% deposit, held)</dt>
            <dd className="m-0 font-semibold text-ods-navy" data-testid="join-deposit">
              <Money amount={major(totals.depositMinor)} currency={cur} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-ods-line pt-2">
            <dt className="font-semibold text-ods-navy">Balance</dt>
            <dd className="m-0 text-end">
              <span className="block font-semibold text-ods-navy">When the pool fills, before shipping</span>
              <span className="block text-ods-small text-ods-slate">
                About <Money amount={major(totals.balanceEstimateMinor)} currency={cur} /> at the price if the pool fills
              </span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="m-0 text-ods-body text-ods-slate">The pool price isn&apos;t set yet, so we can&apos;t show a total.</p>
      )}
      <div role="note" className="flex gap-3 rounded-ods-control border border-ods-line bg-ods-info-tint p-4 text-ods-body">
        <Icon icon={Info} size="sm" className="mt-0.5 shrink-0 text-ods-info" />
        <p className="m-0">
          <strong className="block text-ods-navy">What if the pool doesn&apos;t fill?</strong>
          Your deposit returns to your wallet on the closing date.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          iconStart={Users}
          disabled={!totals}
          loading={pending}
          loadingText="Adding…"
          disabledReason={!totals ? 'The pool price isn’t set yet.' : undefined}
          className="self-start"
          data-testid="join-submit"
          onClick={() => {
            if (demo) {
              setNote(`Sample: this would continue to the join step for ${formatNumber(units)} ${u(units)}.`);
              return;
            }
            const legacy = () => {
              writeSaved(pool.code, { qty: units, savedAt: new Date().toISOString() });
              router.push(continueHref);
            };
            if (!cartAdd) return legacy();
            start(async () => {
              setNote(null);
              setCartHref(null);
              const r = await cartAdd({ kind: 'pool', refId: pool.id, qty: units });
              if (isCartNotReady(r)) return legacy();
              if (!r.ok) return setNote(r.message);
              const added = `${formatNumber(units)} ${u(units)} in pool ${pool.code} added`;
              if (mini) mini.show(r.cart, added);
              setNote(`${added} to your cart. The deposit is held when you check out.`);
              setCartHref(cartTabHref('buy'));
            });
          }}
        >
          Join pool
        </Button>
        <p className="m-0 text-ods-small text-ods-slate">Next you choose the delivery address and how to pay the deposit, and accept the Group Buy Terms.</p>
        <p role="status" aria-live="polite" className={note ? 'm-0 text-ods-small text-ods-slate' : 'sr-only'}>
          {note ?? ''}
          {note && cartHref ? (
            <>
              {' '}
              <Link href={cartHref} className="font-semibold text-ods-blue underline underline-offset-4">
                View cart
              </Link>
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
