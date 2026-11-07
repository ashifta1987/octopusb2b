import Link from 'next/link';
import { parts } from '@/components/store/seo';
import { NewBadge } from '@/components/ds';
import { REQUEST_TYPES } from './request-schema';

export const REQUEST_TAB_FALLBACK: Record<string, string> = {
  sourcing: 'Product sourcing|Find a product we don’t list yet', brand: 'Make My Brand|Your logo on verified products', '3pl': '3PL service|Warehousing and fulfillment',
  dropship: 'Dropshipping|Ship straight to your customers', sample: 'Sample request|Check quality before bulk', qc: 'QC inspection|Inspect before it ships',
  certification: 'Certification|CE, FCC, RoHS and more',
};

/** Request Center tabs (ADDON-44-F: Make My Brand [NEW] second). Scrolls sideways on phones. */
export function RequestTabs({ blocks, active, qs = '' }: { blocks: Record<string, string>; active: string; qs?: string }) {
  const order = ['sourcing', 'brand', ...REQUEST_TYPES.filter((t) => t !== 'sourcing')];
  return (
    <nav aria-label="Request type" className="mt-8 -mx-4 sm:mx-0">
      <ul className="flex lg:grid gap-2 lg:grid-cols-7 overflow-x-auto overscroll-x-contain px-4 sm:px-0 pb-1">
        {order.map((t) => {
          const [title, sub] = parts(blocks, `request.type.${t}`, REQUEST_TAB_FALLBACK[t]);
          const on = t === active;
          return (
            <li key={t} className="shrink-0 w-[200px] lg:w-auto">
              <Link href={`/request/${t}${qs}`} aria-current={on ? 'page' : undefined} data-testid={`request-tab-${t}`}
                className={`block h-full rounded-[14px] border px-4 py-3.5 ${on ? 'bg-navy border-navy text-white hover:text-white' : 'bg-white border-line hover:border-navy'}`}>
                <span className="font-semibold flex items-center gap-1.5">{title}{t === 'brand' && <NewBadge />}</span>
                <span className={`block text-[13px] mt-1 ${on ? 'text-[#C9CFDB]' : 'text-muted'}`}>{sub}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
