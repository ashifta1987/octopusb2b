import Link from 'next/link';
import { cx } from '../cx';
import { Logo } from '../logo';

export type SiteFooterLink = { label: string; href: string };
export type SiteFooterColumn = { title: string; links: SiteFooterLink[] };

export type SiteFooterProps = {
  /** Up to four link columns (introduction site: Services, Help, Company, Legal). Internal URLs only. */
  columns: SiteFooterColumn[];
  /** One line under the logo. */
  summary?: string;
  /** Legal name from the company profile, shown as "© <year> <legal name>". Hidden when missing. */
  legalName?: string | null;
  year?: number;
  /** Language and currency, e.g. "English · US$". */
  localeLabel?: string;
  /** Landmark name of the link list (default "Footer"). */
  navLabel?: string;
  className?: string;
};

/**
 * SiteFooter (introduction site, Part 4.1 §12): navy-dark band with the logo with tagline (white, → `/`), a summary line,
 * up to four link columns, the legal name and "English · US$". Server-safe (no client code).
 * Phones (< 768 px): logo on top, columns in two columns, bottom row stacks.
 */
export function SiteFooter({ columns, summary, legalName, year, localeLabel = 'English · US$', navLabel = 'Footer', className }: SiteFooterProps) {
  return (
    <footer className={cx('bg-ods-navy-dark text-white', className)}>
      <div className="mx-auto max-w-ods-content px-ods-pad-page pt-12 pb-8">
        <div className="grid gap-8 ods-desktop:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)]">
          <div className="max-w-[320px]">
            <Logo variant="white-tagline" area="public" />
            {summary ? <p className="mt-3 text-ods-label text-white/80">{summary}</p> : null}
          </div>
          <nav aria-label={navLabel}>
            <div className="grid grid-cols-2 gap-6 ods-tablet:grid-cols-4">
              {columns.slice(0, 4).map((col) => (
                <div key={col.title}>
                  <h2 className="text-ods-label font-bold text-white">{col.title}</h2>
                  <ul className="mt-2 grid">
                    {col.links.map((l) => (
                      <li key={l.href + l.label}>
                        <Link href={l.href} className="inline-flex min-h-[calc(var(--ods-control-h)-8px)] items-center rounded-ods-control text-ods-table text-white/80 hover:text-white hover:underline">
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-white/15 pt-6 text-ods-small text-white/75 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
          {legalName ? (
            <p>
              © {year ? `${year} ` : ''}
              {legalName}
            </p>
          ) : (
            <span />
          )}
          <p>{localeLabel}</p>
        </div>
      </div>
    </footer>
  );
}
