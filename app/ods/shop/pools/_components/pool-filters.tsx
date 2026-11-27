'use client';

import { useRouter } from 'next/navigation';
import { FilterPills, Field, Select } from '@octopus/ui';
import { POOL_FILTERS, POOL_SORTS, poolsListHref, type PoolFilter, type PoolSort } from '../_lib/pool-logic';

/**
 * ODS T4 · /shop/pools URL state (Part 2.8): the status pills (?status=) and the sort (?sort=) push a new URL, so Back /
 * Forward and shared links work. The result count is read out by FilterPills' polite live region.
 */
export function PoolStatusPills({
  status,
  sort,
  category,
  counts,
  resultText,
}: {
  status: PoolFilter;
  sort: PoolSort;
  category?: string | null;
  /** null = that list couldn't be loaded right now (no count shown, never 0). */
  counts: Record<PoolFilter, number | null>;
  resultText: string;
}) {
  const router = useRouter();
  return (
    <FilterPills
      mode="single"
      allowEmpty={false}
      label="Filter pools"
      value={[status]}
      items={POOL_FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] ?? undefined, testId: `pool-filter-${f.id}` }))}
      onChange={(ids) => {
        const next = (ids[0] ?? 'open') as PoolFilter;
        router.push(poolsListHref({ status: next, sort, category }), { scroll: false });
      }}
      resultText={resultText}
      data-testid="pool-filters"
    />
  );
}

export function PoolSortSelect({ status, sort, category }: { status: PoolFilter; sort: PoolSort; category?: string | null }) {
  const router = useRouter();
  return (
    <Field label="Sort by" className="w-full ods-tablet:w-56">
      <Select
        value={sort}
        onChange={(e) => router.push(poolsListHref({ status, sort: e.target.value as PoolSort, category }), { scroll: false })}
        data-testid="pool-sort"
      >
        {POOL_SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
