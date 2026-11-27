import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { Logo, OdsThemeRoot, cx } from '@octopus/ui';

/**
 * Frame for the T4 catalogue fixtures (/dev/ui/screens/shop-products, shop-product, shop-search): staging only (404 on
 * live), ODS theme, landmarks. The fixture renders ONE full page (with its own single H1) chosen with ?state=, so every
 * state screenshots as a real page. Everything inside is SAMPLE data. Simple stand-in until the FRAME builder's Shop
 * frame component exists.
 */
export function CatalogueFixtureFrame({ path, states, current, children }: { path: string; states: { id: string; label: string }[]; current: string; children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen bg-ods-canvas">
      <header className="border-b border-ods-line bg-ods-navy">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center justify-between gap-3 px-ods-pad-page py-3">
          <Logo variant="mark-white" area="shop" height={28} priority />
          <p className="m-0 text-ods-small text-white">Staging fixture · sample data, not real products</p>
        </div>
      </header>
      <nav aria-label="Fixture states" className="border-b border-ods-line bg-ods-surface">
        <ul role="list" className="mx-auto m-0 flex max-w-ods-content list-none flex-wrap gap-2 px-ods-pad-page py-2">
          {states.map((s) => (
            <li key={s.id}>
              <Link
                href={`${path}?state=${s.id}`}
                aria-current={s.id === current ? 'page' : undefined}
                data-testid={`fixture-state-${s.id}`}
                className={cx(
                  'inline-flex min-h-[calc(var(--ods-control-h)-8px)] items-center rounded-ods-pill border px-3 text-ods-small font-semibold no-underline',
                  s.id === current ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong text-ods-navy hover:border-ods-navy',
                )}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" data-testid={`fixture-${current}`}>
        {children}
      </main>
    </OdsThemeRoot>
  );
}

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
