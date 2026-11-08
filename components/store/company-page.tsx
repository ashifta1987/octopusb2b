import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getPage } from './data';
import { Breadcrumbs, Prose } from './seo';

/** /about and /contact — CMS page body + company_profile + branches (all from CMS). */
export async function CompanyPage({ slug, showContact }: { slug: 'about' | 'contact'; showContact?: boolean }) {
  const [page, { company, branches }] = await Promise.all([getPage(slug), getSiteContent()]);
  if (!page && !company) notFound();
  const title = page?.title ?? (slug === 'about' ? 'About us' : 'Contact us');
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}` : null;
  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: title }]} />
      <h1 className="text-[34px] sm:text-[40px] font-extrabold mt-4">{title}</h1>
      {company?.tagline && <p className="eyebrow mt-2">{company.tagline}</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr] items-start">
        <div className="space-y-6 min-w-0">
          {page && <div className="card p-6 sm:p-8"><Prose text={page.body} /></div>}
          {showContact && (
            <div className="flex flex-wrap gap-3">
              {company?.email && <a href={`mailto:${company.email}`} className="btn btn-primary">Email {company.email}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !border-ok text-ok">Chat on WhatsApp</a>}
              <Link href="/request/sourcing" className="btn btn-ghost">Send a request</Link>
            </div>
          )}
          {branches.length > 0 && (
            <section aria-labelledby="br-h">
              <h2 id="br-h" className="text-xl font-bold mb-3">{branches.length > 1 ? 'Our offices' : 'Our office'}</h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {branches.map((b) => (
                  <li key={b.id} className="card p-5">
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-[13px] text-muted">{[b.city, b.country].filter(Boolean).join(', ')}</div>
                    <address className="not-italic text-[14px] mt-2 space-y-1">
                      {b.address && <div>{b.address}</div>}
                      {b.phone && <div><a href={`tel:${b.phone.replace(/\s/g, '')}`} className="text-coral-text">{b.phone}</a></div>}
                      {b.email && <div><a href={`mailto:${b.email}`} className="text-coral-text">{b.email}</a></div>}
                    </address>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {company && (
          <aside className="card p-6 stick" aria-labelledby="co-h">
            <h2 id="co-h" className="text-base font-semibold">Company details</h2>
            <address className="not-italic text-[14px] mt-3 space-y-2">
              <div className="font-semibold">{company.legal_name}</div>
              {company.address && <div className="text-muted">{company.address}</div>}
              {company.address_cn && <div className="text-muted" lang="zh-CN">{company.address_cn}</div>}
              {company.contact_person && <div>Contact: {company.contact_person}</div>}
              {company.phone && <div><a href={`tel:${company.phone.replace(/\s/g, '')}`} className="font-semibold">{company.phone}</a>{wa && ' · WhatsApp'}</div>}
              {company.email && <div><a href={`mailto:${company.email}`} className="font-semibold text-coral-text">{company.email}</a></div>}
              {company.website && <div className="text-muted">{company.website}</div>}
            </address>
          </aside>
        )}
      </div>
    </div>
  );
}

export function CompanySkeleton() {
  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-1/2 bg-line rounded" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]"><div className="card h-[360px]" /><div className="card h-[280px]" /></div>
    </div>
  );
}
