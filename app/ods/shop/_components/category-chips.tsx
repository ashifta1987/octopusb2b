'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FilterPills } from '@octopus/ui';

export type ChipCategory = { slug: string; name: string };

/**
 * ODS T4 · category chips on /shop (Part 5.2 §2): FilterPills, single choice ("All categories" + the level-1 categories),
 * scroll sideways on phones. The choice lives in the URL (`?category=<slug>`, other params kept; Back/Forward work) and
 * filters ALL six sections at once (the server re-renders them). The result is read out (aria-live).
 */
export function CategoryChips({ categories, value }: { categories: ChipCategory[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(value ?? 'all');
  const name = selected === 'all' ? null : categories.find((c) => c.slug === selected)?.name;
  return (
    <FilterPills
      data-testid="category-chips"
      label="Filter every section by category"
      mode="single"
      allowEmpty={false}
      value={[selected]}
      onChange={(ids) => {
        const next = ids[0] ?? 'all';
        setSelected(next);
        const sp = new URLSearchParams(window.location.search);
        if (next === 'all') sp.delete('category');
        else sp.set('category', next);
        const qs = sp.toString();
        start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
      }}
      items={[{ id: 'all', label: 'All categories', testId: 'chip-all' }, ...categories.map((c) => ({ id: c.slug, label: c.name, testId: `chip-${c.slug}` }))]}
      resultText={pending ? 'Updating every section…' : name ? `Showing ${name} in every section` : 'Showing all categories'}
    />
  );
}
