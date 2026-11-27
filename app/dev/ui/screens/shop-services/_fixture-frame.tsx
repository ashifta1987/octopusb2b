import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { OdsThemeRoot, SectionBar, ShopHeader } from '@octopus/ui';

/**
 * Frame for the T4 Shop services fixtures (/dev/ui/screens/shop-pools, shop-pool, shop-turnkey, shop-services): staging
 * only (404 on live), ODS theme, the Shop header + section bar with SAMPLE counts, one H1 naming the fixture, then
 * every state. All data on these pages is sample data, labelled "Example".
 */
export function ShopFixtureFrame({ title, intro, current, children }: { title: string; intro: ReactNode; current?: string; children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen bg-ods-canvas">
      <ShopHeader cartCount={3} notificationsCount={1} sticky={false} cartHref="/shop/quote-list" accountHref="/account" />
      <SectionBar current={current} walletBalance={4250} />
      <main id="main" className="mx-auto flex w-full max-w-ods-content flex-col gap-10 px-ods-pad-page pt-6 pb-24">
        <div className="flex flex-col gap-2 border-b border-ods-line pb-4">
          <p className="m-0 text-ods-small font-semibold text-ods-slate">Staging fixtures · sample data</p>
          <h1 className="m-0 text-ods-h1 text-ods-navy">{title}</h1>
          <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">{intro}</p>
        </div>
        {children}
      </main>
    </OdsThemeRoot>
  );
}

/** One state: a labelled region with an "Example" tag (no heading, so the view inside keeps its own H2/H3 order). */
export function ShopFixtureState({ id, label, note, children }: { id: string; label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={`Example: ${label}`} data-testid={`fixture-${id}`} className="flex flex-col gap-3">
      <p className="m-0 flex flex-wrap items-center gap-2 text-ods-body font-semibold text-ods-navy">
        <span className="rounded-ods-pill bg-ods-warning-tint px-2 py-0.5 text-ods-small font-semibold text-ods-navy">Example</span>
        {label}
      </p>
      {note ? <p className="m-0 text-ods-small text-ods-slate">{note}</p> : null}
      <div className="rounded-ods-card border border-dashed border-ods-line-strong p-4">{children}</div>
    </section>
  );
}
