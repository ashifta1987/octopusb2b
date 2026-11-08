import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getSession } from '@/lib/auth';
import { getTurnkeyProject } from '@/lib/turnkey/data';
import { usd } from '@/lib/turnkey/format';
import { Breadcrumbs } from '@/components/store/seo';
import { LeadForm } from './lead-form';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Shared body of /turnkey/<p>/request (live) and /turnkey/<p>/interest (register-interest). */
export async function LeadPage({ slug, kind, searchParams }: { slug: string; kind: 'quote' | 'interest'; searchParams: SP }) {
  const [d, { settings }] = await Promise.all([getTurnkeyProject(slug), getSiteContent()]);
  if (!d || settings['turnkey.enabled'] === false) notFound();
  const { project: p, packages } = d;
  // wrong form for the project's status → send to the right one
  if (kind === 'quote' && p.status !== 'live') redirect(`/turnkey/${slug}/interest`);
  if (kind === 'interest' && p.status === 'live') redirect(`/turnkey/${slug}/request`);
  const s = await getSession().catch(() => null);
  const buyer = s && !s.isStaff ? s : null;
  const pkgId = one(searchParams.package);
  const pkg = packages.find((k) => k.package_id === pkgId) ?? packages.find((k) => k.tier_rank === 2) ?? packages[0];
  const term = one(searchParams.term).toUpperCase();
  const country = one(searchParams.country).toUpperCase() || buyer?.org?.country || buyer?.profile?.country || '';
  const threshold = Number(settings['turnkey.interest_threshold'] ?? 10) || 10;
  return (
    <div className="max-w-[880px] mx-auto px-4 sm:px-8 py-6">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Turnkey Projects', href: '/turnkey' }, { name: p.title, href: `/turnkey/${slug}` }, { name: kind === 'quote' ? 'Request this package' : 'Register interest' }]} />
      <h1 className="font-display font-bold text-[26px] sm:text-[32px] text-ink mt-4">{kind === 'quote' ? 'Request this package' : 'Register interest'} · {p.title}</h1>
      <p className="text-muted mt-1.5 text-[15px]">
        {kind === 'quote'
          ? 'A sourcing lead replies within 24 hours with a USD quote and Incoterm. No payment now.'
          : `Packages for ${p.title.toLowerCase()} go live once ${threshold} buyers register interest. No commitment — we contact you with a first rough quote.`}
      </p>
      <div className="mt-6 bg-white border border-line rounded-[14px] p-5 sm:p-7">
        <LeadForm kind={kind} projectId={slug} packages={packages.map((k) => ({ id: k.package_id, label: `${k.tier_label ?? k.tier_name} — ${usd(k.starting_budget_usd) ?? 'on request'}` }))}
          defaults={{
            package_id: pkg?.package_id ?? '', country: /^[A-Z]{2}$/.test(country) ? country : '',
            delivery_term: (['FOB', 'CIF', 'DAP'].includes(term) ? term : '') as 'FOB' | 'CIF' | 'DAP' | '', target_open_date: /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.date)) ? one(searchParams.date) : '',
            company_name: buyer?.org?.name ?? '', contact_name: buyer?.profile?.full_name ?? '', email: buyer?.email ?? '', phone: buyer?.profile?.phone ?? '',
            message: one(searchParams.talk) ? 'I would like to talk to a sourcing lead about this project.' : '',
          }} />
      </div>
      <p className="text-[13px] text-muted mt-4">Prefer to chat? <Link href="/account/assistant" className="text-coral-text font-semibold">Ask Octo</Link> or reply to the confirmation email.</p>
    </div>
  );
}
