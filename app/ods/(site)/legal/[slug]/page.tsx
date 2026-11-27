import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDate } from '@octopus/ui';
import { getPage, getPublishedTerms } from '@/components/store/data';
import { getSiteData } from '@/lib/ods-site';
import { Container } from '../../_components/blocks';
import { PageHeader } from '../../_components/page-header';

/**
 * /legal/{terms,privacy,cookies,refunds} — plain document layout (Part 3.1). Same data as today's legal pages:
 * terms = the published terms_versions row, the others = `pages` where is_legal. No text yet → an honest placeholder.
 */
const SLUGS = ['terms', 'privacy', 'cookies', 'refunds'] as const;
type Slug = (typeof SLUGS)[number];
const TITLES: Record<Slug, string> = { terms: 'Terms of service', privacy: 'Privacy policy', cookies: 'Cookie policy', refunds: 'Refunds and returns' };

type Params = Promise<{ slug: string }>;
const isSlug = (s: string): s is Slug => (SLUGS as readonly string[]).includes(s);

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  if (!isSlug(slug)) return { title: 'Not found', robots: { index: false } };
  return { title: TITLES[slug], alternates: { canonical: `/legal/${slug}` } };
}

function Prose({ text }: { text: string }) {
  return (
    <div className="grid gap-4 text-ods-body text-ods-text">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

/** params are URL data: read inside <Suspense> so navigations stay instant (Cache Components). Prerendered per slug. */
export default function LegalPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div aria-busy="true" className="h-[480px] bg-ods-canvas" />}>
      <LegalContent params={params} />
    </Suspense>
  );
}

async function LegalContent({ params }: { params: Params }) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  const title = TITLES[slug];
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Legal' }, { label: title }];
  const [{ company }, terms, page] = await Promise.all([
    getSiteData(),
    slug === 'terms' ? getPublishedTerms() : Promise.resolve(null),
    slug === 'terms' ? Promise.resolve(null) : getPage(slug, true),
  ]);

  const docCls = 'mx-auto max-w-[860px] rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card ods-tablet:p-8';

  if (terms && terms.sections.length) {
    return (
      <article>
        <PageHeader title={title} crumbs={crumbs}>
          <p className="mt-2 text-ods-label text-ods-slate">
            Version <span className="font-semibold text-ods-navy tabular-nums">{terms.version}</span>
            {terms.published_at ? ` · Effective ${formatDate(terms.published_at)}` : ''}
          </p>
        </PageHeader>
        <Container className="py-8">
          <nav aria-label="Sections" className={docCls}>
            <h2 className="text-ods-h2 font-bold text-ods-navy">Contents</h2>
            <ol className="mt-3 grid gap-x-6 gap-y-1 ods-tablet:grid-cols-2">
              {terms.sections.map((s) => (
                <li key={s.no}>
                  <a href={`#s-${s.no}`} className="inline-flex min-h-[calc(var(--ods-control-h)-12px)] items-center text-ods-table text-ods-blue underline underline-offset-4">
                    {s.no}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className={`${docCls} mt-6 grid gap-8`}>
            {terms.sections.map((s) => (
              <section key={s.no} id={`s-${s.no}`} aria-labelledby={`s-${s.no}-h`} className="scroll-mt-20">
                <h2 id={`s-${s.no}-h`} className="mb-2 text-ods-h2 font-bold text-ods-navy">
                  {s.no}. {s.title}
                </h2>
                <Prose text={s.body ?? ''} />
              </section>
            ))}
          </div>
        </Container>
      </article>
    );
  }

  if (page && page.body?.trim()) {
    return (
      <article>
        <PageHeader title={page.title || title} crumbs={crumbs}>
          <p className="mt-2 text-ods-label text-ods-slate">Last updated {formatDate(page.published_at ?? page.updated_at)}</p>
        </PageHeader>
        <Container className="py-8">
          <div className={docCls}>
            <Prose text={page.body} />
          </div>
        </Container>
      </article>
    );
  }

  // Part 3.1: real text comes from the owner; until then, an honest placeholder
  return (
    <article>
      <PageHeader title={title} crumbs={crumbs} />
      <Container className="py-8">
        <div className={docCls}>
          <p className="text-ods-body text-ods-text">
            The owner is preparing this text.{' '}
            {company?.email ? (
              <>
                Contact us at{' '}
                <a href={`mailto:${company.email}`} className="font-semibold text-ods-blue underline underline-offset-4">
                  {company.email}
                </a>{' '}
                with any question.
              </>
            ) : (
              <>
                Contact us through the{' '}
                <a href="/help#contact" className="font-semibold text-ods-blue underline underline-offset-4">
                  Help page
                </a>{' '}
                with any question.
              </>
            )}
          </p>
        </div>
      </Container>
    </article>
  );
}
