'use client';

import { useRouter } from 'next/navigation';
import { FilterPills } from '@octopus/ui';
import { SECTION_ORDER, SHOP_SECTIONS, type ShopSectionKey } from '../../_lib/sections';
import { searchHref } from '../_lib/types';

/** Pill type filter for /shop/search (?type=). Single choice; "All" clears it. The result count is read out politely. */
export function SearchTypePills({ q, type, counts, total, basePath }: { q: string; type: ShopSectionKey | null; counts: Partial<Record<ShopSectionKey, number>>; total: number; basePath?: string }) {
  const router = useRouter();
  const shown = type ? (counts[type] ?? 0) : total;
  return (
    <FilterPills
      label="Filter results by type"
      mode="single"
      allowEmpty={false}
      value={[type ?? 'all']}
      onChange={(ids) => {
        const id = ids[0];
        router.push(searchHref(q, id && id !== 'all' ? (id as ShopSectionKey) : null, basePath), { scroll: false });
      }}
      items={[
        { id: 'all', label: 'All', count: total, testId: 'type-all' },
        ...SECTION_ORDER.map((k) => ({ id: k, label: SHOP_SECTIONS[k].title, count: counts[k] ?? 0, testId: `type-${k}` })),
      ]}
      resultText={`${shown.toLocaleString('en-US')} ${shown === 1 ? 'result' : 'results'}`}
      resultTestId="search-count"
      data-testid="search-types"
    />
  );
}
