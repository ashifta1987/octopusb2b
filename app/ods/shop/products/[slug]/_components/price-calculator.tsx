'use client';

import { useId } from 'react';
import { Field, Money, NumberInput, formatMoney } from '@octopus/ui';
import type { PriceResult, PriceTier } from '../../_lib/price';

const n = (x: number) => x.toLocaleString('en-US');
const rangeText = (r: { from: number; to: number | null }) => (r.to == null ? `${n(r.from)}+` : `${n(r.from)}–${n(r.to)}`);

/** The reason shown under the calculator and next to the disabled Request quote (2.6: always say why). */
export function calcReason(result: PriceResult, opts: { unitPlural: string; pool: boolean }): string | null {
  if (result.status === 'invalid') return 'Quantity: enter a whole number above 0.';
  if (result.status === 'below-moq') return `Minimum order is ${n(result.minimum)} ${opts.unitPlural}. Raise the quantity${opts.pool ? ' or join the MOQ pool' : ''}.`;
  return null;
}

/** Price by quantity table (tiers already in the platform currency, cents). */
export function TierTable({ tiers, unit, currency, highlight }: { tiers: PriceTier[]; unit: string; currency: string; highlight?: number }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label="Price by quantity" tabIndex={0}>
      <table className="w-full border-collapse text-ods-body" data-testid="price-tiers">
        <thead>
          <tr className="bg-ods-canvas text-ods-small text-ods-slate">
            <th scope="col" className="px-4 py-2 text-start font-semibold">
              Quantity
            </th>
            <th scope="col" className="px-4 py-2 text-start font-semibold">
              Price per {unit}
            </th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => {
            const next = tiers[i + 1];
            const on = i === highlight;
            return (
              <tr key={t.minQty} className={on ? 'bg-ods-blue-tint font-semibold' : 'border-t border-ods-line'} aria-current={on ? 'true' : undefined}>
                <td className="px-4 py-2.5 tabular-nums">{rangeText({ from: t.minQty, to: next ? next.minQty - 1 : null })}</td>
                <td className="px-4 py-2.5">
                  <Money amount={t.unitCents / 100} currency={currency} />
                  {on ? <span className="sr-only"> (your quantity)</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type PriceCalculatorProps = {
  quantity: string;
  onQuantityChange: (raw: string) => void;
  result: PriceResult;
  reason: string | null;
  unit: string;
  unitPlural: string;
  moq: number;
  currency: string;
};

/**
 * Price calculator (Part 5.4 item 6): quantity → tier, unit price, total, next tier. Controlled (the quantity is
 * shared with Request quote / Add to cart). Below the MOQ it says "Minimum order is N <units>" (data-testid calc-reason)
 * and the page disables Request quote with the same reason. Results are a polite live region.
 */
export function PriceCalculator({ quantity, onQuantityChange, result, reason, unit, unitPlural, moq, currency }: PriceCalculatorProps) {
  const uid = useId();
  const money = (cents: number) => <Money amount={cents / 100} currency={currency} />;
  return (
    <div className="flex flex-col gap-3">
      <Field label={`Quantity (${unitPlural})`} hint={`Minimum order ${n(moq)} ${unitPlural}`}>
        <NumberInput value={quantity} onValueChange={(raw) => onQuantityChange(raw)} min={1} step={1} decimals={0} inputMode="numeric" aria-describedby={reason ? `${uid}-why` : undefined} data-testid="calc-qty" />
      </Field>
      {reason ? (
        <p id={`${uid}-why`} className="m-0 text-ods-small font-medium text-ods-danger" data-testid="calc-reason">
          {reason}
        </p>
      ) : null}
      <dl className="m-0 flex flex-col gap-2 text-ods-body" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-ods-slate">Price per {unit}</dt>
          <dd className="m-0 text-end">
            {result.status === 'ok' ? (
              <>
                {money(result.unitCents)} <span className="text-ods-slate">({rangeText(result.range)} tier)</span>
              </>
            ) : result.status === 'no-tiers' ? (
              'Price on request'
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-ods-slate">Product total</dt>
          <dd className="m-0 text-end font-semibold text-ods-navy" data-testid="calc-total">
            {result.status === 'ok' ? money(result.totalCents) : result.status === 'no-tiers' ? 'In your quote' : '—'}
          </dd>
        </div>
        {result.status === 'ok' ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-ods-line pt-2">
            <dt className="font-semibold text-ods-navy">Next tier</dt>
            <dd className="m-0 text-end font-semibold text-ods-navy" data-testid="calc-next">
              {result.next
                ? `${n(result.next.tier.minQty)}+ ${unitPlural} at ${formatMoney(result.next.tier.unitCents / 100, { currency })} (${n(result.next.unitsToGo)} more)`
                : 'You have the best price'}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
