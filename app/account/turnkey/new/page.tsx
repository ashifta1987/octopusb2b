import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { getSiteContent } from '@/lib/content';
import { getTurnkeyCatalogue, getTkServices } from '@/lib/turnkey/catalogue';
import { categoryLabel, fromPrice } from '@/lib/turnkey/format';
import { PageHeader, Notice } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { EnquiryClient } from './enquiry-client';

export const metadata = { title: 'Start a turnkey project' };

/**
 * Turnkey T2 — NewProject / ClientIntake (docs/design/turnkey-v2, matched to the text): the client picks a catalogue
 * project or asks for a new one and tells us the plan. The enquiry is free. Signed-out visitors log in first and come
 * back here with the same project chosen (requireCustomer → /login?next=…).
 */
export default function NewTurnkeyProjectPage({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  return (
    <Suspense fallback={<PageSkeleton cards={1} table={false} />}>
      <NewProject searchParams={searchParams} />
    </Suspense>
  );
}

async function NewProject({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  const sp = await searchParams;
  const wanted = typeof sp.project === 'string' && /^[a-z0-9-]{1,60}$/.test(sp.project) ? sp.project : '';
  const s = await requireCustomer(wanted ? `/account/turnkey/new?project=${encodeURIComponent(wanted)}` : '/account/turnkey/new');
  const [{ projects }, services, { settings }] = await Promise.all([getTurnkeyCatalogue(), getTkServices(), getSiteContent()]);
  const back = <Link href="/account/turnkey" className="text-sm text-muted hover:text-ink">← My turnkey projects</Link>;
  if (settings['turnkey.enabled'] === false) {
    return (<><PageHeader eyebrow={back} title="Start a turnkey project" /><Notice tone="amber">Turnkey projects are not open right now. Please check back soon.</Notice></>);
  }
  const consult = services.find((x) => x.code === 'consultation');
  const options = projects.map((p) => ({ id: p.project_id, title: p.title, category: categoryLabel(p.category) }));
  const country = s.org?.country && /^[A-Z]{2}$/.test(s.org.country) ? s.org.country : '';
  return (
    <>
      <PageHeader eyebrow={back} title="Start a turnkey project"
        subtitle={`Tell us your plan. The enquiry is free. The first paid step is a consultation${consult ? ` (${fromPrice(consult.from_cents, consult.approx).toLowerCase()})` : ''}, and we confirm the exact fee before any work starts.`} />
      <EnquiryClient projects={options} initialProject={options.some((o) => o.id === wanted) ? wanted : ''} defaultCountry={country} />
    </>
  );
}
