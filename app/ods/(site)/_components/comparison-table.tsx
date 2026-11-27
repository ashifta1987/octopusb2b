import { cx, Icon } from '@octopus/ui';
import type { SiteSettings } from '@/lib/ods-site';
import { SITE_SERVICES } from './services';

/**
 * Comparison table (Part 4.1 §5): rows Minimum order, Who holds stock, Typical time, You pay; six service columns.
 * Phones: the table scrolls sideways inside its own focusable box with the first column sticky, plus a hint.
 */
export function ComparisonTable({ settings }: { settings: SiteSettings }) {
  const rows: { label: string; get: (slug: (typeof SITE_SERVICES)[number]['slug']) => string }[] = [
    { label: 'Minimum order', get: (s) => settings.facts[s].minimum },
    { label: 'Who holds stock', get: (s) => settings.facts[s].holds_stock },
    { label: 'Typical time', get: (s) => settings.facts[s].typical_time },
    { label: 'You pay', get: (s) => settings.facts[s].you_pay_short },
  ];
  return (
    <>
      <div
        data-testid="comparison-table"
        role="region"
        aria-labelledby="comparison-caption"
        tabIndex={0}
        className="overflow-x-auto rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card"
      >
        <table className="w-full min-w-[920px] border-collapse text-start text-ods-table">
          <caption id="comparison-caption" className="sr-only">
            The six services compared: minimum order, who holds stock, typical time and what you pay
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 z-[1] w-[150px] bg-ods-surface px-4 py-3 text-start text-ods-label font-bold text-ods-slate">
                Topic
              </th>
              {SITE_SERVICES.map((s) => (
                <th key={s.slug} scope="col" className={cx('border-t-4 px-4 py-3 text-start align-bottom', s.cls.border)}>
                  <span className={cx('inline-flex items-center gap-1.5 text-ods-label font-bold', s.cls.text)}>
                    <Icon icon={s.icon} size="sm" />
                    {s.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-ods-line">
                <th scope="row" className="sticky start-0 z-[1] bg-ods-surface px-4 py-3 text-start font-bold text-ods-navy shadow-[1px_0_0_var(--ods-line)]">
                  {r.label}
                </th>
                {SITE_SERVICES.map((s) => (
                  <td key={s.slug} className="px-4 py-3 align-top text-ods-text">
                    {r.get(s.slug)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-ods-small text-ods-slate ods-desktop:hidden">Swipe the table sideways to see all six.</p>
    </>
  );
}
