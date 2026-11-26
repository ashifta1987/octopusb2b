import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent, block } from '@/lib/content';
import { getLegalSlugs } from '@/components/store/data';
import { Prose } from '@/components/store/seo';
import { tkOutfit } from '../tk-font';

export const metadata: Metadata = {
  title: { absolute: 'Turnkey terms and legal | Octopus B2B' },
  description: 'China visit terms, KVKK and GDPR privacy, our independence statement and how passport copies are handled for Turnkey projects.',
  alternates: { canonical: '/turnkey/terms' },
};

/**
 * Turnkey T7 — Terms and Legal (docs/design/turnkey-v2 "Rules and states": "Terms and Legal cover China visit terms, KVKK
 * and GDPR privacy, the independence statement and secure passport upload"). The texts are the owner's: each section
 * shows the site content block the owner publishes in Admin › Site content (keys below); until then it says the terms
 * are provided on request. No legal text is written here.
 */
const SECTIONS: { key: string; id: string; title: string }[] = [
  { key: 'turnkey.terms.china_visit', id: 'china-visit', title: 'China visit terms' },
  { key: 'turnkey.terms.privacy', id: 'privacy', title: 'KVKK and GDPR privacy' },
  { key: 'turnkey.terms.independence', id: 'independence', title: 'Independence statement' },
  { key: 'turnkey.terms.passport', id: 'passport', title: 'Secure passport upload' },
];

export default function TurnkeyTermsPage() {
  return <Suspense fallback={<div className="h-[400px]" aria-hidden />}><Terms /></Suspense>;
}

async function Terms() {
  const [{ settings, blocks }, legal] = await Promise.all([getSiteContent(), getLegalSlugs()]);
  if (settings['turnkey.enabled'] === false) notFound();
  const texts = SECTIONS.map((s) => ({ ...s, text: block(blocks, s.key, '').trim() }));
  return (
    <div className={`${tkOutfit.variable} bg-[#F4F7FC]`} data-testid="tk-terms">
      <section className="bg-[#1A174A] text-white">
        <div className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
          <nav aria-label="Breadcrumb" className="text-[13px] text-[#E8F0FD]"><Link href="/turnkey" className="text-white underline">Turnkey projects</Link> / Terms and legal</nav>
          <h1 className="font-[family-name:var(--font-tk-outfit)] text-[34px] font-bold mt-2 mb-1">Terms and legal</h1>
          <p className="m-0 text-[16px] text-[#E8F0FD] max-w-[640px]">China visit terms, KVKK and GDPR privacy, our independence statement and secure passport upload.</p>
        </div>
      </section>
      <div className="max-w-[900px] mx-auto px-4 sm:px-8 py-10 flex flex-col gap-6">
        <nav aria-label="Sections" className="rounded-[14px] border border-[#E1E6F2] bg-white p-5">
          <h2 className="m-0 mb-2 text-[16px] font-semibold text-[#1A174A]">Contents</h2>
          <ul className="m-0 p-0 list-none grid sm:grid-cols-2 gap-1">
            {texts.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-[#2559B8] underline min-h-6 inline-block">{s.title}</a></li>)}
          </ul>
        </nav>
        {texts.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="rounded-[14px] border border-[#E1E6F2] bg-white p-6 scroll-mt-24" data-testid={`tk-terms-${s.id}`}>
            <h2 id={`${s.id}-h`} className="font-[family-name:var(--font-tk-outfit)] m-0 mb-3 text-[22px] font-bold text-[#1A174A]">{s.title}</h2>
            {s.text ? <Prose text={s.text} /> : (
              <p className="m-0 text-[15px] text-[#3B4160]" data-testid={`tk-terms-on-request-${s.id}`}>
                We provide these terms on request. <Link href={`/contact?topic=turnkey-terms`} className="text-[#2559B8] underline">Ask us for a copy</Link>.
              </p>
            )}
          </section>
        ))}
        {legal.includes('privacy') && (
          <p className="m-0 text-[14.5px] text-[#3B4160]">Our general <Link href="/legal/privacy" className="text-[#2559B8] underline">privacy policy</Link> applies to every Octopus B2B service.</p>
        )}
      </div>
    </div>
  );
}
