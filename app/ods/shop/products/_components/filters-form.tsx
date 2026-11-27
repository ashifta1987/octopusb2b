'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, NumberInput, Select, cx } from '@octopus/ui';
import { LEAD_OPTIONS, MOQ_OPTIONS, productsHref, type ProductFilterState } from '../_lib/filters';
import type { CategoryOption } from '../_lib/types';

export type FiltersFormProps = {
  state: ProductFilterState;
  categories: CategoryOption[];
  /** Currency label for the price boxes ("US$"). */
  currency: string;
  basePath?: string;
  /** instant (desktop column): every change updates the URL. deferred (phone sheet): applied by the sheet's "Show results". */
  mode?: 'instant' | 'deferred';
  /** Form id, so a button outside it (the sheet footer) can submit it. */
  formId?: string;
  /** deferred mode: called with the new URL instead of navigating (the sheet closes first, then navigates). */
  onApply?: (href: string) => void;
  'data-testid'?: string;
};

const SHIPS_TO_REASON = 'Products don’t list destination countries yet. Choose your country in the quote request.';

/**
 * Product filters (Part 5.3): Category, Price, Minimum order, Delivery, Verified supplier, Samples available, Customisable
 * (+ Also in an MOQ pool). Ships to is shown disabled with the reason (no destination data on products).
 * Works without JavaScript as a GET form; with JS it pushes the new URL (filters live in the URL, Part 2.8).
 */
export function FiltersForm({ state, categories, currency, basePath = '/shop/products', mode = 'instant', formId, onApply, 'data-testid': testId }: FiltersFormProps) {
  const router = useRouter();
  const uid = useId();
  const [draft, setDraft] = useState<ProductFilterState>(state);
  const [minText, setMinText] = useState(state.min != null ? String(state.min) : '');
  const [maxText, setMaxText] = useState(state.max != null ? String(state.max) : '');
  const [priceError, setPriceError] = useState<string | null>(null);

  const go = (next: ProductFilterState) => {
    const href = productsHref(state, { ...next, page: 1, sort: state.sort, q: state.q }, basePath);
    if (mode === 'deferred' && onApply) onApply(href);
    else router.push(href, { scroll: false });
  };
  const change = (patch: Partial<ProductFilterState>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (mode === 'instant') go(next);
  };
  const readPrices = (): { min: number | null; max: number | null } | null => {
    const parse = (t: string) => (t.trim() === '' ? null : Number(t.replace(/,/g, '')));
    const min = parse(minText);
    const max = parse(maxText);
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0))) {
      setPriceError('Price: enter an amount like 1.85, or leave it empty.');
      return null;
    }
    if (min != null && max != null && min > max) {
      setPriceError('Price: the minimum is higher than the maximum.');
      return null;
    }
    setPriceError(null);
    return { min, max };
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const prices = readPrices();
    if (!prices) return;
    go({ ...draft, ...prices });
  };
  const applyPrices = () => {
    if (mode !== 'instant') return;
    const prices = readPrices();
    if (prices && (prices.min !== state.min || prices.max !== state.max)) go({ ...draft, ...prices });
  };

  return (
    <form id={formId} method="get" action={basePath} onSubmit={submit} noValidate data-testid={testId} className="flex flex-col gap-4" aria-label="Product filters">
      {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
      {state.sort !== 'best' ? <input type="hidden" name="sort" value={state.sort} /> : null}

      <Field label="Category">
        <Select name="category" value={draft.category ?? ''} onChange={(e) => change({ category: e.target.value || null })}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.level > 1 ? `\u00A0\u00A0\u00A0${c.name}` : c.name}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-ods-label font-semibold text-ods-text">Price per unit ({currency})</legend>
        <div className="grid grid-cols-2 gap-2">
          <Field label={<span className="font-normal text-ods-slate">Min</span>}>
            <NumberInput name="min" value={minText} onValueChange={(raw) => setMinText(raw)} onBlur={applyPrices} min={0} decimals={2} aria-invalid={priceError ? true : undefined} aria-describedby={priceError ? `${uid}-perr` : undefined} />
          </Field>
          <Field label={<span className="font-normal text-ods-slate">Max</span>}>
            <NumberInput name="max" value={maxText} onValueChange={(raw) => setMaxText(raw)} onBlur={applyPrices} min={0} decimals={2} aria-invalid={priceError ? true : undefined} aria-describedby={priceError ? `${uid}-perr` : undefined} />
          </Field>
        </div>
        <p id={`${uid}-perr`} role="status" aria-live="polite" className={cx('m-0 text-ods-small font-medium text-ods-danger', !priceError && 'sr-only')}>
          {priceError ?? ''}
        </p>
      </fieldset>

      <Field label="Minimum order">
        <Select name="moq" value={draft.moq != null ? String(draft.moq) : ''} onChange={(e) => change({ moq: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any</option>
          {MOQ_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Up to {n.toLocaleString('en-US')}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Delivery">
        <Select name="lead" value={draft.lead != null ? String(draft.lead) : ''} onChange={(e) => change({ lead: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any</option>
          {LEAD_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Within {n} days
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Ships to" disabled disabledReason={SHIPS_TO_REASON}>
        <Select disabled value="" onChange={() => {}}>
          <option value="">Any country</option>
        </Select>
      </Field>

      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="mb-0.5 text-ods-label font-semibold text-ods-text">Show only</legend>
        <Checkbox name="verified" value="1" label="Verified supplier" checked={draft.verified} onCheckedChange={(v) => change({ verified: v })} />
        <Checkbox name="samples" value="1" label="Samples available" checked={draft.samples} onCheckedChange={(v) => change({ samples: v })} />
        <Checkbox name="custom" value="1" label="Customisable" description="Logo, colour or packaging" checked={draft.custom} onCheckedChange={(v) => change({ custom: v })} />
        <Checkbox name="pool" value="1" label="Also in an MOQ pool" checked={draft.pool} onCheckedChange={(v) => change({ pool: v })} />
      </fieldset>

      {mode === 'instant' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          <Link href={productsHref(state, { category: null, min: null, max: null, moq: null, lead: null, verified: false, samples: false, custom: false, pool: false }, basePath)} className="inline-flex min-h-ods-control items-center font-semibold text-ods-blue underline underline-offset-4">
            Clear filters
          </Link>
        </div>
      ) : null}
    </form>
  );
}
