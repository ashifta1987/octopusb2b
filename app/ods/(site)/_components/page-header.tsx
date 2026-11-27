import type { ReactNode } from 'react';
import { Breadcrumbs } from '@octopus/ui';
import { Container } from './blocks';

/** Plain page header for the info pages (/how-it-works, /shipping, /help) and legal pages: breadcrumbs, H1, intro. */
export function PageHeader({ title, intro, crumbs, children }: { title: string; intro?: ReactNode; crumbs: { label: string; href?: string }[]; children?: ReactNode }) {
  return (
    <section aria-labelledby="page-title" className="border-b border-ods-line bg-ods-surface">
      <Container className="py-8 ods-tablet:py-12">
        <Breadcrumbs items={crumbs} />
        <h1 id="page-title" className="mt-4 text-[length:var(--ods-display)] leading-[var(--ods-leading-display)] font-bold tracking-tight text-ods-navy max-ods-tablet:text-ods-h1">
          {title}
        </h1>
        {intro ? <p className="mt-3 max-w-[680px] text-ods-body text-ods-slate">{intro}</p> : null}
        {children}
      </Container>
    </section>
  );
}
