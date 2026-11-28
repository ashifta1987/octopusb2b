'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, Info, Trash2, Undo2 } from 'lucide-react';
import { Field, Icon, Money, NumberInput, QuantityStepper, Select, cx, formatNumber } from '@octopus/ui';
import type { BuyLine, QuoteLine } from '../../_lib/cart-types';
import { CUSTOMISATION_OPTIONS } from '../../_lib/cart-types';
import { KIND_LABEL, customisationLabel, money, noticeText, restQuoteHref, type CustomisationId } from '../_lib/cart-ui';
import { KindTag, LineImage } from './line-parts';

/**
 * ODS T5a · cart lines (Part 5.8). Presentational + local edit state; every write goes through the callbacks (the cart
 * page passes the server actions and replaces its CartView with the one each action returns).
 *  - BuyLineRow   type tag, image, name, sub-line, QuantityStepper (min / step / max), unit price, line total, green note,
 *                 re-check notice, Save for later, Remove. Phones: stacked (image + text, then stepper + price).
 *  - QuoteLineRow quantity, optional target price (US$), customisation Select, below-MOQ warning "Raise it or join a pool".
 *  - SavedLineRow Move to cart, Remove.
 * `disabledBy` = the id of the page note that says why actions are off (viewer role), linked with aria-describedby.
 */

const linkBtn = 'inline-flex min-h-[calc(var(--ods-control-h)-12px)] items-center gap-1 text-ods-small font-semibold underline underline-offset-4 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60';

function LineActions({ onSave, onRemove, saveLabel = 'Save for later', disabled, disabledBy, title }: { onSave: () => void; onRemove: () => void; saveLabel?: string; disabled?: boolean; disabledBy?: string; title: string }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4">
      <button type="button" className={cx(linkBtn, 'text-ods-blue')} onClick={onSave} disabled={disabled} aria-describedby={disabled ? disabledBy : undefined}>
        <Icon icon={saveLabel === 'Move to cart' ? Undo2 : Bookmark} size="xs" />
        {saveLabel}
        <span className="sr-only">: {title}</span>
      </button>
      <button type="button" className={cx(linkBtn, 'text-ods-danger')} onClick={onRemove} disabled={disabled} aria-describedby={disabled ? disabledBy : undefined}>
        <Icon icon={Trash2} size="xs" />
        Remove
        <span className="sr-only">: {title}</span>
      </button>
    </div>
  );
}

function LineTitle({ title, href }: { title: string; href: string | null }) {
  return (
    <h3 className="m-0 mt-1 text-ods-body font-bold text-ods-navy">
      {href ? (
        <Link href={href} className="hover:underline">
          {title}
        </Link>
      ) : (
        title
      )}
    </h3>
  );
}

export function LineNotice({ notice, title, line }: { notice: NonNullable<BuyLine['notice']>; title: string; line?: BuyLine }) {
  const rest = notice.kind === 'stock-reduced' && line ? restQuoteHref(line, notice.fromQty - notice.toQty) : null;
  const warn = notice.kind === 'price-changed' || notice.kind === 'stock-reduced' || notice.kind === 'unavailable';
  return (
    <p
      className={cx('m-0 mt-2 flex items-start gap-2 rounded-ods-control px-3 py-2 text-ods-small text-ods-text', warn ? 'bg-ods-warning-tint' : 'bg-ods-info-tint')}
      data-testid="line-notice"
      data-notice={notice.kind}
    >
      <Icon icon={warn ? AlertTriangle : Info} size="xs" className={cx('mt-0.5 shrink-0', warn ? 'text-ods-warning' : 'text-ods-info')} />
      <span>
        {noticeText(notice, { title })}
        {rest && notice.kind === 'stock-reduced' ? (
          <>
            {' '}
            <Link href={rest} className="font-semibold text-ods-blue underline underline-offset-4">
              Ask for a quote for the rest ({formatNumber(notice.fromQty - notice.toQty)})
            </Link>
          </>
        ) : null}
      </span>
    </p>
  );
}

export type BuyLineRowProps = {
  line: BuyLine;
  canAct: boolean;
  disabledBy?: string;
  pending?: boolean;
  onQty: (qty: number) => void;
  onSave: () => void;
  onRemove: () => void;
};

export function BuyLineRow({ line: l, canAct, disabledBy, pending, onQty, onSave, onRemove }: BuyLineRowProps) {
  const [qty, setQty] = useState(l.qty);
  const qtyId = useId();
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const change = (n: number) => {
    setQty(n);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onQty(n), 450);
  };
  const isPool = l.kind === 'pool';
  const big = isPool && l.depositMinor != null ? l.depositMinor : l.lineTotalMinor;
  const small = isPool && l.depositMinor != null ? 'deposit held now' : l.kind === 'sample' ? 'sample fee' : `${money(l.unitPriceMinor)} each`;
  const hint = [l.minQty > 1 ? `min ${formatNumber(l.minQty)}` : null, l.step > 1 ? `steps of ${formatNumber(l.step)}` : null, l.maxQty != null ? `max ${formatNumber(l.maxQty)}` : null].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-3 border-t border-ods-line py-4 first:border-t-0 ods-tablet:grid ods-tablet:grid-cols-[72px_minmax(0,1fr)_auto_minmax(120px,auto)] ods-tablet:items-start ods-tablet:gap-4" data-testid="buy-line" data-kind={l.kind} aria-busy={pending || undefined}>
      <div className="flex gap-3 ods-tablet:contents">
        <LineImage image={l.image} />
        <div className="min-w-0 flex-1">
          <KindTag kind={l.kind} />
          <LineTitle title={l.title} href={l.href} />
          {l.subLine ? <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{l.subLine}</p> : null}
          {l.note ? <p className="m-0 mt-1 text-ods-small text-ods-success">{l.note}</p> : null}
          {l.notice ? <LineNotice notice={l.notice} title={l.title} line={l} /> : null}
          <LineActions title={l.title} onSave={onSave} onRemove={onRemove} disabled={!canAct || pending} disabledBy={disabledBy} />
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 ods-tablet:contents">
        <div className="flex flex-col gap-1">
          <label htmlFor={qtyId} className="sr-only">
            Quantity of {l.title}
          </label>
          <QuantityStepper
            id={qtyId}
            value={qty}
            onValueChange={change}
            min={l.minQty}
            max={l.maxQty ?? undefined}
            step={l.step}
            disabled={!canAct}
            minReason={`The minimum is ${formatNumber(l.minQty)}.`}
            maxReason={l.maxQty != null ? `Only ${formatNumber(l.maxQty)} available.` : undefined}
            data-testid="line-qty"
          />
          {hint ? <span className="text-ods-small text-ods-slate">{hint}</span> : null}
        </div>
        <div className="text-end">
          <p className="m-0 text-ods-body font-bold text-ods-navy" data-testid="line-total">
            <span className="sr-only">{isPool ? 'Deposit for this line: ' : 'Line total: '}</span>
            <Money amount={big / 100} />
          </p>
          <p className="m-0 text-ods-small text-ods-slate">{small}</p>
          {isPool && l.depositMinor != null ? (
            <p className="m-0 text-ods-small text-ods-slate">
              of <Money amount={l.lineTotalMinor / 100} />
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export type QuoteDraft = { qty: number | null; target: string; customisation: string };

export type QuoteLineRowProps = {
  line: QuoteLine;
  canAct: boolean;
  disabledBy?: string;
  pending?: boolean;
  /** Called on every quantity edit (the page re-checks "below MOQ" for Send). */
  onDraft: (qty: number | null) => void;
  /** Save the line (blur of a field, or a new customisation). */
  onCommit: (d: { qty: number; targetPriceMinor: number | null; customisation: CustomisationId | null }) => void;
  onSave: () => void;
  onRemove: () => void;
};

const toMinor = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, '').trim());
  return raw.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export function QuoteLineRow({ line: l, canAct, disabledBy, pending, onDraft, onCommit, onSave, onRemove }: QuoteLineRowProps) {
  const [qtyRaw, setQtyRaw] = useState(String(l.qty));
  const [target, setTarget] = useState(l.targetPriceMinor != null ? (l.targetPriceMinor / 100).toFixed(2) : '');
  const [custom, setCustom] = useState(l.customisation ?? 'none');
  const qty = Number(qtyRaw.replace(/,/g, ''));
  const qtyOk = Number.isInteger(qty) && qty > 0;
  const below = qtyOk ? qty < l.moq : true;
  const commit = (next: Partial<{ custom: string }> = {}) => {
    if (!qtyOk) return;
    const c = next.custom ?? custom;
    onCommit({ qty, targetPriceMinor: toMinor(target), customisation: c === 'none' ? null : (c as CustomisationId) });
  };
  const unitWord = l.unit || 'units';
  return (
    <li className="flex flex-col gap-3 border-t border-ods-line py-4 first:border-t-0 ods-desktop:grid ods-desktop:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.6fr)] ods-desktop:items-start ods-desktop:gap-4" data-testid="quote-line" aria-busy={pending || undefined}>
      <div className="flex gap-3 ods-desktop:contents">
        <LineImage image={l.image} />
        <div className="min-w-0 flex-1">
          <KindTag kind="quote" />
          <LineTitle title={l.title} href={l.href} />
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">
            Minimum {formatNumber(l.moq)} {unitWord}
          </p>
          {below ? (
            <p className="m-0 mt-1 text-ods-small font-semibold text-ods-danger" data-testid="below-moq">
              Below the minimum ({formatNumber(l.moq)}). Raise it
              {l.poolHref ? (
                <>
                  {' '}or{' '}
                  <Link href={l.poolHref} className="text-ods-blue underline underline-offset-4">
                    join a pool
                  </Link>
                </>
              ) : null}
              .
            </p>
          ) : null}
          {l.notice ? <LineNotice notice={l.notice} title={l.title} /> : null}
          <LineActions title={l.title} onSave={onSave} onRemove={onRemove} disabled={!canAct || pending} disabledBy={disabledBy} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 ods-tablet:grid-cols-3">
        <Field label={`Quantity (${unitWord})`} disabled={!canAct}>
          <NumberInput
            value={qtyRaw}
            min={1}
            onValueChange={(raw, n) => {
              setQtyRaw(raw);
              onDraft(n != null && Number.isInteger(n) ? n : null);
            }}
            onBlur={() => commit()}
            disabled={!canAct}
            data-testid="quote-qty"
          />
        </Field>
        <Field label="Target price (US$)" optional disabled={!canAct}>
          <NumberInput value={target} onValueChange={(raw) => setTarget(raw)} onBlur={() => commit()} decimals={2} min={0} placeholder="Optional" disabled={!canAct} data-testid="quote-target" />
        </Field>
        <Field label="Customisation" disabled={!canAct} className="col-span-2 ods-tablet:col-span-1">
          <Select
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              commit({ custom: e.target.value });
            }}
            disabled={!canAct}
            data-testid="quote-custom"
          >
            {CUSTOMISATION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </li>
  );
}

export function SavedLineRow({ line, canAct, disabledBy, pending, onMove, onRemove }: { line: BuyLine | QuoteLine; canAct: boolean; disabledBy?: string; pending?: boolean; onMove: () => void; onRemove: () => void }) {
  const isBuy = line.line === 'buy';
  const meta = isBuy ? `${KIND_LABEL[line.kind]} · quantity ${formatNumber(line.qty)}` : `Get a quote · ${formatNumber(line.qty)} ${line.unit || 'units'} · ${customisationLabel(line.customisation)}`;
  return (
    <li className="flex gap-3 border-t border-ods-line py-4 first:border-t-0" data-testid="saved-line" data-line={line.line} aria-busy={pending || undefined}>
      <LineImage image={line.image} size={48} />
      <div className="min-w-0 flex-1">
        <KindTag kind={isBuy ? line.kind : 'quote'} />
        <LineTitle title={line.title} href={line.href} />
        <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{meta}</p>
        <LineActions title={line.title} saveLabel="Move to cart" onSave={onMove} onRemove={onRemove} disabled={!canAct || pending} disabledBy={disabledBy} />
      </div>
      {isBuy ? (
        <span className="shrink-0 text-ods-body font-semibold text-ods-navy">
          <Money amount={line.lineTotalMinor / 100} />
        </span>
      ) : null}
    </li>
  );
}
