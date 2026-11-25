import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTkServices } from '@/lib/turnkey/catalogue';
import { servicePrice, type TkService } from '@/lib/turnkey/format';
import { tkOutfit } from '../tk-font';

export const metadata: Metadata = {
  title: { absolute: 'Turnkey services and starting fees | Octopus B2B' },
  description: 'Consultation, layout drawing, sourcing, factory audit, inspection, Visit China trips and a dedicated account manager. Every fee is a starting price, paid before work starts.',
  alternates: { canonical: '/turnkey/services' },
};

const GROUPS: { code: TkService['group_code']; title: string; intro: string }[] = [
  { code: 'core', title: 'Plan and source', intro: 'Every project starts with a consultation.' },
  { code: 'qc', title: 'Quality control', intro: 'Each check is paid before it starts.' },
  { code: 'visit', title: 'Visit China with us', intro: 'Guided factory and sourcing trips.' },
  { code: 'trip_extra', title: 'Trip extras', intro: 'Add them to your China visit.' },
  { code: 'manager', title: 'Your account manager', intro: 'One named contact for your project, with cover when away.' },
];

/** Turnkey T1 — Services: every starting fee (docs/design/turnkey-v2, matched to the written description). */
export default function TurnkeyServicesPage() {
  return <Suspense fallback={<div className="h-[400px]" aria-hidden />}><Services /></Suspense>;
}

async function Services() {
  const [services, { settings }] = await Promise.all([getTkServices(), getSiteContent()]);
  if (settings['turnkey.enabled'] === false) notFound();
  return (
    <div className={`${tkOutfit.variable} bg-[#F4F7FC]`} data-testid="tk-services">
      <section className="bg-[#1A174A] text-white">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
          <nav aria-label="Breadcrumb" className="text-[13px] text-[#E8F0FD]"><Link href="/turnkey" className="text-white underline">Turnkey projects</Link> / Services</nav>
          <h1 className="font-[family-name:var(--font-tk-outfit)] text-[34px] font-bold mt-2 mb-1">Services and starting fees</h1>
          <p className="m-0 text-[16px] text-[#E8F0FD] max-w-[640px]">Every price is a starting price, because some projects need more. We set the exact fee with you, and you pay before the work starts.</p>
        </div>
      </section>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10 flex flex-col gap-8">
        {GROUPS.map((g) => {
          const items = services.filter((s) => s.group_code === g.code);
          if (items.length === 0) return null;
          return (
            <section key={g.code} aria-labelledby={`tk-g-${g.code}`}>
              <h2 id={`tk-g-${g.code}`} className="font-[family-name:var(--font-tk-outfit)] text-[24px] font-bold text-[#1A174A] m-0">{g.title}</h2>
              <p className="mt-1 mb-3 text-[14.5px] text-[#5A6080]">{g.intro}</p>
              <ul className="list-none m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((s) => (
                  <li key={s.code} id={s.code} className="rounded-[14px] border border-[#E1E6F2] bg-white p-5 scroll-mt-24" data-testid={`tk-service-${s.code}`}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="m-0 text-[17px] font-semibold text-[#1A174A]">{s.name}</h3>
                      <span className="text-[16px] font-bold text-[#1A174A] whitespace-nowrap">{servicePrice(s)}</span>
                    </div>
                    {s.rule_text && <p className="mt-2 mb-0 text-[14px] text-[#3B4160]">{s.rule_text}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <div className="rounded-[14px] bg-white border border-[#E1E6F2] p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[15px] text-[#1A174A]">Ready to start? The first step is a consultation.</p>
          <Link href="/contact?topic=turnkey-consultation" className="inline-flex min-h-11 items-center px-5 rounded-[10px] bg-[#2559B8] text-white font-semibold no-underline">Book a consultation</Link>
        </div>
      </div>
    </div>
  );
}
