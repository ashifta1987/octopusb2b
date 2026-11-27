import Link from 'next/link';
import { h1Class, h2Class, btn, space, StatusPill, Pic, Check, Crumb, Faq, CtaBand, OtherServices, CostTable, TeamBand, BrandMark, type ServiceKey, type SubBrand } from './ui';

type Img = { src: string; alt: string };

/** One template for the service pages (design pages 02–07), in the design's order, plus costs, team and step photos. */
export type ServicePageData = {
  key: ServiceKey;
  /** sub-brand logo shown in the hero (Octopus 3PL / Turnkey / MOQ Pool) */
  brand?: SubBrand;
  crumb: string;
  trail?: { name: string; href: string }[];
  soon?: boolean;
  title: string;
  lead: string;
  primary: { href: string; label: string; testId?: string };
  note: React.ReactNode;
  hero: Img;
  facts: [string, React.ReactNode][];
  who: [string, string][];
  howSub: string;
  /** [title, text, optional photo] */
  steps: [string, string, Img?][];
  learnTitle: string;
  learnSub: string;
  learn: (Img & { caption: string })[];
  costs?: { title?: string; sub?: string; rows: [string, React.ReactNode, string?][]; note?: React.ReactNode; link?: { href: string; label: string }; testId?: string };
  included: string[];
  good: [string, React.ReactNode][];
  team?: Img;
  faq: [string, React.ReactNode][];
  cta: string;
};

export function ServicePage({ d, testId, afterFacts, afterHow, beforeFaq, afterIncluded }: {
  d: ServicePageData; testId?: string; afterFacts?: React.ReactNode; afterHow?: React.ReactNode; beforeFaq?: React.ReactNode; afterIncluded?: React.ReactNode;
}) {
  const photoSteps = d.steps.some((s) => s[2]);
  return (
    <div data-testid={testId} data-service={d.key}>
      <Crumb label={d.crumb} trail={d.trail} />

      <section id="top" className="px-4 sm:px-6 pt-8 pb-10" aria-labelledby="service-h1">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-x-12 gap-y-8 items-center">
          <div className="flex-[1_1_480px] min-w-0">
            {d.brand && <BrandMark brand={d.brand} className="mb-4" />}
            <div><StatusPill soon={d.soon} /></div>
            <h1 id="service-h1" className={`${h1Class} mt-4 text-balance`}>{d.title}</h1>
            <p className="mt-5 mb-0 text-[19px] leading-[1.6] text-muted max-w-[560px]">{d.lead}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={d.primary.href} className={btn.primary} data-testid={d.primary.testId ?? 'service-primary'}>{d.primary.label}</Link>
              <a href="#how" className={btn.outline}>How it works</a>
            </div>
            <p className="mt-3.5 mb-0 text-[14px] text-muted">{d.note}</p>
          </div>
          <figure className="flex-[1_1_420px] min-w-0 m-0">
            {/* the hero photo is the page's LCP element: preloaded; every other picture lazy-loads */}
            <Pic src={d.hero.src} alt={d.hero.alt} sizes="(min-width:1200px) 560px, (min-width:960px) 45vw, 100vw" preload />
          </figure>
        </div>
      </section>

      <section className="px-4 sm:px-6 pb-2" aria-label="Key facts">
        <dl className="max-w-[1200px] mx-auto bg-ink rounded-[18px] p-2 flex flex-wrap m-0">
          {d.facts.map(([k, v]) => (
            <div key={k} className="flex-[1_1_220px] px-5 py-4">
              <dt className="font-mono text-[12px] font-semibold tracking-[.12em] uppercase text-on-ink-link">{k}</dt>
              <dd className="num m-0 mt-1.5 text-[18px] font-bold text-white leading-[1.35]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {afterFacts}

      <section className="px-4 sm:px-6 pt-12 md:pt-16 pb-16 md:pb-[88px]" aria-labelledby="who-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="who-h" className={h2Class}>Who this is for</h2>
          <ul className="mt-6 flex flex-wrap gap-4 list-none p-0">
            {d.who.map(([t, b]) => (
              <li key={t} className="flex-[1_1_280px] bg-white border border-line rounded-[18px] p-6">
                <h3 className="m-0 text-[20px] font-semibold">{t}</h3>
                <p className="mt-2 mb-0 text-[16px] leading-[1.55] text-muted">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className={`bg-ink text-white px-4 sm:px-6 ${space.section} scroll-mt-4`} aria-labelledby="how-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="how-h" className={`${h2Class} !text-white`}>How it works</h2>
          <p className="mt-3 mb-0 text-[18px] text-on-ink max-w-[720px] leading-[1.55]">{d.howSub}</p>
          <ol className={`mt-8 list-none p-0 ${photoSteps ? 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'flex flex-wrap gap-4'}`}>
            {d.steps.map(([t, b, img], i) => (
              <li key={t} className={`bg-ink-card rounded-[18px] overflow-hidden ${photoSteps ? '' : 'flex-[1_1_240px]'}`}>
                {img && <Pic src={img.src} alt={img.alt} rounded="rounded-none" sizes="(min-width:1200px) 290px, (min-width:640px) 50vw, 100vw" />}
                <div className="p-[22px]">
                  <span aria-hidden="true" className="w-9 h-9 rounded-full bg-coral text-white font-bold flex items-center justify-center">{i + 1}</span>
                  <h3 className="mt-3.5 mb-0 text-[20px] font-semibold !text-white"><span className="sr-only">Step {i + 1}: </span>{t}</h3>
                  <p className="mt-2 mb-0 text-[15px] leading-[1.55] text-on-ink">{b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {afterHow}

      <section className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="learn-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="learn-h" className={h2Class}>{d.learnTitle}</h2>
          <p className="mt-3 mb-0 text-[18px] text-muted max-w-[720px] leading-[1.55]">{d.learnSub}</p>
          <div className="mt-8 flex flex-wrap gap-5">
            {d.learn.map((f) => (
              <figure key={f.caption} className="flex-[1_1_260px] min-w-0 m-0">
                <Pic src={f.src} alt={f.alt} />
                <figcaption className="mt-2.5 text-[15px] text-muted leading-[1.5]">{f.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {d.costs && <CostTable {...d.costs} />}

      <section className={`px-4 sm:px-6 ${d.costs ? space.section : 'pb-16 md:pb-[88px]'}`} aria-label="What is included and good to know">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-6">
          <div className="flex-[1_1_440px] min-w-0 bg-white border border-line rounded-[18px] p-8">
            <h2 className="m-0 text-[24px]! font-bold">What is included</h2>
            <ul className="mt-[18px] mb-0 flex flex-col gap-3 list-none p-0">
              {d.included.map((t) => <li key={t} className="flex gap-2.5 text-[17px] leading-[1.5]"><Check />{t}</li>)}
            </ul>
          </div>
          <div className="flex-[1_1_440px] min-w-0 bg-tint rounded-[18px] p-8">
            <h2 className="m-0 font-mono text-[13px]! font-semibold tracking-[.12em] uppercase !text-coral-text">Good to know</h2>
            <dl className="mt-3.5 mb-0 flex flex-col gap-4">
              {d.good.map(([t, b]) => (
                <div key={t}>
                  <dt className="text-[17px] font-bold text-ink">{t}</dt>
                  <dd className="m-0 mt-1 text-[16px] leading-[1.55] text-muted">{b}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {afterIncluded}
      {d.team && <TeamBand img={d.team} />}
      {beforeFaq}

      <Faq items={d.faq} />
      <CtaBand title={d.cta} />
      <OtherServices current={d.key} />
    </div>
  );
}
