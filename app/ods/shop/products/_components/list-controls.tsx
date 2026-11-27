'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Select, Sheet } from '@octopus/ui';
import { PRODUCT_SORTS, productsHref, type ProductFilterState, type ProductSort } from '../_lib/filters';
import type { CategoryOption } from '../_lib/types';
import { FiltersForm } from './filters-form';

/** Sort (URL ?sort=). Changing it goes back to page 1. */
export function SortSelect({ state, basePath = '/shop/products', id }: { state: ProductFilterState; basePath?: string; id?: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id ?? 'products-sort'} className="text-ods-small font-semibold whitespace-nowrap text-ods-text">
        Sort by
      </label>
      <Select
        id={id ?? 'products-sort'}
        value={state.sort}
        onChange={(e) => router.push(productsHref(state, { sort: e.target.value as ProductSort }, basePath), { scroll: false })}
        className="min-w-44"
        data-testid="sort"
      >
        {PRODUCT_SORTS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Phones and tablets (< 1200 px): "Filters (n)" opens the filters in a full-screen Sheet; "Show results" applies them.
 * Back closes the sheet (Sheet closeOnBack) and focus returns to this button.
 */
export function FiltersSheetButton({ state, categories, currency, activeCount, basePath }: { state: ProductFilterState; categories: CategoryOption[]; currency: string; activeCount: number; basePath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Close the sheet first (it removes its own Back-button history entry), then navigate — otherwise its history.back()
  // would undo the new URL.
  const apply = (href: string) => {
    setOpen(false);
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', go);
      window.clearTimeout(t);
      router.push(href, { scroll: false });
    };
    window.addEventListener('popstate', go);
    const t = window.setTimeout(go, 400);
  };
  return (
    <>
      <Button variant="secondary" iconStart={SlidersHorizontal} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="filters-button">
        Filters{activeCount ? ` (${activeCount})` : ''}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        variant="full"
        testId="filters-sheet"
        footer={
          <Button type="submit" form="products-filters-sheet" fullWidth>
            Show results
          </Button>
        }
      >
        <FiltersForm state={state} categories={categories} currency={currency} basePath={basePath} mode="deferred" formId="products-filters-sheet" onApply={apply} data-testid="filters-sheet-form" />
      </Sheet>
    </>
  );
}
