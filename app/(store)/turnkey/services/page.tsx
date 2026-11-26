import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Crumb } from '@/components/site/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent } from '@/lib/content';
import { getTkServices } from '@/lib/turnkey/catalogue';
import { TK_SERVICE_PHOTOS, servicePrice, type TkService } from '@/lib/turnkey/format';

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
    <div className={`bg-pearl`} data-testid="tk-services">
      <Crumb label="Services and starting fees" trail={[{ name: 'Turnkey projects', href: '/turnkey' }]} />
      <section className="bg-ink text-white mt-4">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
          <h1 className="!text-white text-[34px] font-bold mt-2 mb-1">Services and starting fees</h1>
          <p className="m-0 text-[16px] text-on-ink max-w-[640px]">Every price is a starting price, because some projects need more. We set the exact fee with you, and you pay before the work starts.</p>
        </div>
      </section>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10 flex flex-col gap-8">
        {GROUPS.map((g) => {
          const items = services.filter((s) => s.group_code === g.code);
          if (items.length === 0) return null;
          return (
            <section key={g.code} aria-labelledby={`tk-g-${g.code}`}>
              <h2 id={`tk-g-${g.code}`} className="text-[24px] font-bold text-ink m-0">{g.title}</h2>
              <p className="mt-1 mb-3 text-[14.5px] text-muted">{g.intro}</p>
              <ul className="list-none m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((s) => (
                  <li key={s.code} id={s.code} className="rounded-[14px] border border-line bg-white overflow-hidden scroll-mt-24" data-testid={`tk-service-${s.code}`}>
                    {TK_SERVICE_PHOTOS[s.code] && (
                      <div className="relative w-full aspect-[3/2] bg-tint">
                        <Image src={TK_SERVICE_PHOTOS[s.code].src} alt={TK_SERVICE_PHOTOS[s.code].alt} fill sizes="(min-width:1100px) 520px, (min-width:768px) 50vw, 100vw" className="object-cover" style={TK_SERVICE_PHOTOS[s.code].pos ? { objectPosition: TK_SERVICE_PHOTOS[s.code].pos } : undefined} />
                      </div>
                    )}
                    <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="m-0 text-[17px] font-semibold text-ink">{s.name}</h3>
                      <span className="text-[16px] font-bold text-ink whitespace-nowrap">{servicePrice(s)}</span>
                    </div>
                    {s.rule_text && <p className="mt-2 mb-0 text-[14px] text-muted">{s.rule_text}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <div className="rounded-[14px] bg-white border border-line p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[15px] text-ink">Ready to start? The first step is a consultation.</p>
          <Link href="/account/turnkey/new" className="inline-flex min-h-11 items-center px-5 rounded-[10px] bg-coral text-white font-semibold no-underline">Book a consultation</Link>
        </div>
        <p className="m-0 text-[14.5px] text-muted">Visiting China with us? Read the <Link href="/turnkey/terms" className="font-semibold text-coral-text underline" data-testid="tk-terms-link">terms and legal</Link> (China visit terms, privacy and passport uploads).</p>
      </div>
    </div>
  );
}
