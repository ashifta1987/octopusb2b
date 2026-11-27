import type { Metadata } from 'next';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Icon } from '@octopus/ui';
import { getSiteData } from '@/lib/ods-site';
import { Container, Faq, FinalCta } from '../_components/blocks';
import { helpGroups } from '../_components/copy';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Answers about joining, orders and payments, MOQ pools, shipping, dropshipping and branding — and how to contact our team.',
  alternates: { canonical: '/help' },
};

/** /help — FAQ groups + contact from the company profile (placeholders when a field is empty). */
export default async function HelpPage() {
  const { settings, company } = await getSiteData();
  const groups = helpGroups(settings);
  const wa = company?.whatsapp?.replace(/[^\d]/g, '');
  const contacts = [
    company?.email ? { icon: Mail, label: 'Email', value: company.email, href: `mailto:${company.email}` } : null,
    company?.phone ? { icon: Phone, label: 'Phone', value: company.phone, href: `tel:${company.phone.replace(/\s+/g, '')}` } : null,
    company?.whatsapp && wa ? { icon: MessageCircle, label: 'WhatsApp', value: company.whatsapp, href: `https://wa.me/${wa}`, external: true } : null,
    company?.address ? { icon: MapPin, label: 'Address', value: company.address } : null,
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string; href?: string; external?: boolean }[];

  return (
    <>
      <PageHeader title="Help" intro="Answers to common questions, and how to reach our team." crumbs={[{ label: 'Home', href: '/' }, { label: 'Help' }]}>
        <nav aria-label="Help topics" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`#${g.id}`} className="inline-flex min-h-ods-control items-center rounded-ods-pill border border-ods-line-strong bg-ods-surface px-4 font-semibold text-ods-navy hover:border-ods-navy">
                  {g.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#contact" className="inline-flex min-h-ods-control items-center rounded-ods-pill border border-ods-line-strong bg-ods-surface px-4 font-semibold text-ods-navy hover:border-ods-navy">
                Contact us
              </a>
            </li>
          </ul>
        </nav>
      </PageHeader>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-ods-canvas py-12">
        <Container>
          <h2 id="faq-title" className="text-ods-h1 font-bold text-ods-navy">
            Questions
          </h2>
          <div className="mt-6 grid gap-8">
            {groups.map((g) => (
              <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="scroll-mt-20">
                <h3 id={`${g.id}-title`} className="mb-3 text-ods-h2 font-bold text-ods-navy">
                  {g.title}
                </h3>
                <Faq items={g.items} />
              </section>
            ))}
          </div>
        </Container>
      </section>

      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 bg-ods-surface py-12">
        <Container>
          <h2 id="contact-title" className="text-ods-h1 font-bold text-ods-navy">
            Contact us
          </h2>
          <p className="mt-2 max-w-[680px] text-ods-body text-ods-slate">
            Our team replies{settings.replyTime ? ` ${settings.replyTime}` : ' to every message'}. Signed-in customers can also open a ticket in My account › Support.
          </p>
          {contacts.length ? (
            <ul className="mt-6 grid gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
              {contacts.map((c) => (
                <li key={c.label} className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
                  <p className="flex items-center gap-2 text-ods-label font-bold text-ods-slate">
                    <Icon icon={c.icon} size="sm" />
                    {c.label}
                  </p>
                  {c.href ? (
                    <a
                      href={c.href}
                      {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="mt-1 inline-flex min-h-ods-control items-center font-semibold break-all text-ods-blue underline underline-offset-4"
                    >
                      {c.value}
                      {c.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                    </a>
                  ) : (
                    <p className="mt-1 text-ods-table whitespace-pre-line text-ods-text">{c.value}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-ods-card border border-dashed border-ods-line-strong bg-ods-canvas p-ods-pad-card text-ods-body text-ods-slate">
              Our contact details are being added. Sign in and open a ticket in My account › Support in the meantime.
            </p>
          )}
          {company?.legal_name ? <p className="mt-6 text-ods-small text-ods-slate">{company.legal_name}</p> : null}
        </Container>
      </section>
      <FinalCta />
    </>
  );
}
