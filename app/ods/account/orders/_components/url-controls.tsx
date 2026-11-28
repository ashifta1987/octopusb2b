'use client';

import { useRouter } from 'next/navigation';
import { CardTabs, FilterPills, Segmented, Select, type CardTabItem, type FilterPillItem, type SegmentedOption } from '@octopus/ui';
import { ODS_BUTTON_ICONS, type OdsIconKey } from './ods-button';

/**
 * URL-state wrappers (Part 2.8) for the ODS My account commerce lists: each option carries the href it navigates to,
 * so the server page owns the state (`?status=`, `?service=`, `?view=`, `?sort=`, `?filter=`, `?period=`) and Back /
 * Forward / shared links work. Shared by requests, orders, wallet and invoices.
 */
type Hrefs = Record<string, string>;

export function UrlCardTabs({ items, value, hrefs, label, testId }: { items: CardTabItem[]; value: string; hrefs: Hrefs; label: string; testId?: string }) {
  const router = useRouter();
  return (
    <CardTabs
      items={items}
      value={value}
      allowDeselect={false}
      onChange={(id) => id && hrefs[id] && router.push(hrefs[id], { scroll: false })}
      label={label}
      data-testid={testId}
    />
  );
}

export function UrlFilterPills({ items, value, hrefs, label, resultText, testId }: { items: FilterPillItem[]; value: string; hrefs: Hrefs; label: string; resultText?: string; testId?: string }) {
  const router = useRouter();
  return (
    <FilterPills
      items={items}
      mode="single"
      allowEmpty={false}
      value={[value]}
      onChange={(ids) => {
        const id = ids[0];
        if (id && hrefs[id]) router.push(hrefs[id], { scroll: false });
      }}
      label={label}
      resultText={resultText}
      data-testid={testId}
    />
  );
}

export function UrlSegmented({ options, value, hrefs, label, testId }: { options: (Omit<SegmentedOption, 'icon'> & { icon?: OdsIconKey })[]; value: string; hrefs: Hrefs; label: string; testId?: string }) {
  const router = useRouter();
  return <Segmented options={options.map((o) => ({ ...o, icon: o.icon ? ODS_BUTTON_ICONS[o.icon] : undefined }))} value={value} onChange={(v) => hrefs[v] && router.push(hrefs[v], { scroll: false })} label={label} data-testid={testId} />;
}

export function UrlSelect({ id, label, options, value, hrefs, testId }: { id: string; label: string; options: [string, string][]; value: string; hrefs: Hrefs; testId?: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => hrefs[e.target.value] && router.push(hrefs[e.target.value], { scroll: false })} className="min-w-44" data-testid={testId}>
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );
}
