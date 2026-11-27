import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { Logo, OdsThemeRoot } from '@octopus/ui';

/**
 * Frame for the T3 sign-in fixtures (/dev/ui/screens/login-states, welcome-setup, invite): staging only (404 on live),
 * ODS theme, one H1, landmarks. Everything inside is SAMPLE data, labelled "Example".
 */
export function AuthFixtureFrame({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen bg-ods-canvas">
      <header className="border-b border-ods-line bg-ods-surface">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center justify-between gap-3 px-ods-pad-page py-3">
          <Logo variant="mark" area="public" height={28} priority />
          <p className="text-ods-small text-ods-slate">Staging fixtures · sample data</p>
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-ods-content flex-col gap-8 px-ods-pad-page pt-8 pb-24">
        <div>
          <h1 className="text-ods-h1 text-ods-navy">{title}</h1>
          <p className="mt-2 max-w-[70ch] text-ods-body text-ods-slate">{intro}</p>
        </div>
        {children}
      </main>
    </OdsThemeRoot>
  );
}

/** One fixture state: H2 + "Example" tag + the screen in a box. */
export function FixtureState({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`fx-${id}`} data-testid={`fixture-${id}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`fx-${id}`} className="text-ods-h2 text-ods-navy">
          {title}
        </h2>
        <span className="rounded-ods-pill bg-ods-warning-tint px-2 py-0.5 text-ods-small font-semibold text-ods-navy">Example</span>
      </div>
      {note ? <p className="text-ods-small text-ods-slate">{note}</p> : null}
      <div className="overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface">{children}</div>
    </section>
  );
}
