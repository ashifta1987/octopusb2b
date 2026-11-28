'use client';

import { useRouter } from 'next/navigation';
import { FilterPills } from '@octopus/ui';
import type { WaitingActionType } from '@/lib/core/waiting-items';
import { WAITING_TYPE_LABEL, WAITING_TYPE_ORDER } from '../_lib/status';

/** Action needed filter (Part 6.3): All · Pay · Approve · Review · Reply, single choice, in the URL as ?type=. */
export function ActionFilters({ type, counts, total, basePath = '/account/action' }: { type: WaitingActionType | null; counts: Record<WaitingActionType, number>; total: number; basePath?: string }) {
  const router = useRouter();
  const shown = type ? counts[type] : total;
  return (
    <FilterPills
      label="Filter by what you need to do"
      mode="single"
      allowEmpty={false}
      value={[type ?? 'all']}
      onChange={(ids) => {
        const id = ids[0];
        const sep = basePath.includes('?') ? '&' : '?';
        router.push(id && id !== 'all' ? `${basePath}${sep}type=${id}` : basePath, { scroll: false });
      }}
      items={[
        { id: 'all', label: 'All', count: total, testId: 'action-filter-all' },
        ...WAITING_TYPE_ORDER.map((t) => ({ id: t, label: WAITING_TYPE_LABEL[t], count: counts[t], testId: `action-filter-${t}` })),
      ]}
      resultText={`${shown} ${shown === 1 ? 'item' : 'items'}`}
      resultTestId="action-count"
      data-testid="action-filters"
    />
  );
}
