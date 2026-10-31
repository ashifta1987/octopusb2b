import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fmtDate } from '@/lib/format';
import { getPublishedTerms, getPage } from '@/components/store/data';
import { Breadcrumbs, Prose } from '@/components/store/seo';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  if (slug === 'terms') {
    const t = await getPublishedTerms();
    return { title: t ? `Terms of service (${t.version})` : 'Terms of service', alternates: { canonical: '/legal/terms' } };
  }
  const page = await getPage(slug, true);
  return page ? { title: page.title, alternates: { canonical: `/legal/${slug}` } } : { title: 'Not found', robots: { index: false } };
}

/** CMS legal pages: /legal/terms renders the published terms_versions row; others render `pages` where is_legal. */
export default function LegalPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="max-w-[860px] mx-auto px-4 sm:px-8 py-12" aria-busy="true"><div className="h-10 w-1/2 bg-line rounded" /><div className="card h-[600px] mt-6" /></div>}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { slug } = await params;
  if (slug === 'terms') {
    const t = await getPublishedTerms();
    if (!t) notFound();
    return (
      <article className="max-w-[860px] mx-auto px-4 sm:px-8 py-10">
        <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Terms of service' }]} />
        <h1 className="text-[34px] font-extrabold mt-4">Terms of service</h1>
        <p className="text-sm text-muted mt-1">Version <span className="mono font-semibold text-navy">{t.version}</span> · Effective {fmtDate(t.published_at)}</p>
        <nav aria-label="Sections" className="card p-5 mt-6">
          <h2 className="text-base font-semibold mb-2">Contents</h2>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {t.sections.map((s) => <li key={s.no}><a href={`#s-${s.no}`} className="text-blue hover:underline">{s.no}. {s.title}</a></li>)}
          </ol>
        </nav>
        <div className="card p-6 sm:p-8 mt-6 space-y-8">
          {t.sections.map((s) => (
            <section key={s.no} id={`s-${s.no}`} aria-labelledby={`s-${s.no}-h`} className="scroll-mt-6">
              <h2 id={`s-${s.no}-h`} className="text-xl font-bold mb-2">{s.no}. {s.title}</h2>
              <Prose text={s.body ?? ''} />
            </section>
          ))}
        </div>
      </article>
    );
  }
  const page = await getPage(slug, true);
  if (!page) notFound();
  return (
    <article className="max-w-[860px] mx-auto px-4 sm:px-8 py-10">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: page.title }]} />
      <h1 className="text-[34px] font-extrabold mt-4">{page.title}</h1>
      <p className="text-sm text-muted mt-1">Last updated {fmtDate(page.published_at ?? page.updated_at)}</p>
      <div className="card p-6 sm:p-8 mt-6"><Prose text={page.body} /></div>
    </article>
  );
}
