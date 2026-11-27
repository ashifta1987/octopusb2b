import type { ReactNode } from 'react';
import type { OdsDensity } from '@octopus/ui';

/**
 * Demo helpers for /dev/ui/components/* (T2). No hooks and no 'use client', so they work inside client section files.
 * Every demo block = one <section> with an H2 (pages have exactly one H1) and a data-testid for the e2e spec.
 */
export function Demo({ id, title, note, phone, children }: { id: string; title: string; note?: ReactNode; phone?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`demo-${id}`} data-testid={`demo-${id}`} className="min-w-0 border-t border-ods-line py-8">
      <h2 id={`demo-${id}`}>{title}</h2>
      {note ? <div className="mt-1 max-w-[820px] text-ods-small text-ods-slate">{note}</div> : null}
      {phone ? (
        <p className="mt-1 max-w-[820px] text-ods-small text-ods-slate">
          <strong className="font-semibold text-ods-navy">Phones:</strong> {phone}
        </p>
      ) : null}
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

/** The same demo rendered in both densities, side by side on desktop (stacked under 1200 px). */
export function DensityPair({ children, stack }: { children: (density: OdsDensity) => ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'grid min-w-0 grid-cols-1 gap-4' : 'grid min-w-0 grid-cols-1 gap-4 ods-desktop:grid-cols-2'}>
      {(['comfortable', 'compact'] as const).map((d) => (
        <div key={d} data-density={d} data-testid={`density-${d}`} className="min-w-0 rounded-ods-card border border-dashed border-ods-line-strong bg-ods-canvas p-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-ods-slate uppercase">{d}</div>
          {children(d)}
        </div>
      ))}
    </div>
  );
}

/** A labelled state inside a demo (Default, Hover, Disabled …). */
export function State({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? 'min-w-0'}>
      <div className="mb-1 text-ods-small text-ods-slate">{label}</div>
      {children}
    </div>
  );
}
