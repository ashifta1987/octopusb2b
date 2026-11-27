import Link from 'next/link';
import Image from 'next/image';
import { getStoreContent } from '@/components/store/currency';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { categoryLabel, tkImageUrl } from '@/lib/turnkey/format';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { copy } from '@/components/store/home/shared';
import { siteImage } from '@/lib/site-images';
import { getShowcaseProducts, ShowcaseGrid } from './products';
import { h1Class, h2Class, eyebrowClass, btn, space, StatusPill, Pic, Check, design, TeamBand, OFFICE_HOURS, WHATSAPP_URL, SUB_BRANDS, type SubBrand } from './ui';

/** Current site's answer to "Are the factories verified?" (content block home3.faq.2) — fills [ANSWER FROM CURRENT FAQ]. */
export const VERIFIED_FAQ = 'Are the factories verified?|Yes. Dropshipping and Make My Brand use only products Octopus lists directly, from verified suppliers, and our sourcing team matches you only with verified factories.';

/** Homepage (design page 01). Real data: products, turnkey projects, service switches; copy from the design. */
export async function WebsiteHome() {
  const [{ blocks, settings, company, categories }, ready, turnkey] = await Promise.all([
    getStoreContent(), getShowcaseProducts(4), getTurnkeyCatalogue(),
  ]);
  const poolsOn = settings.pool_enabled !== false;
  const turnkeyOn = settings['turnkey.enabled'] !== false;
  const tkCount = turnkey.projects.length || 300;
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const tkCards = turnkeyOn ? turnkey.projects.map((p) => ({ ...p, image: tkImageUrl(p.hero_image_path, sb) })).filter((p) => p.image).slice(0, 7) : [];
  const verified = copy(blocks, 'home3.faq.2', VERIFIED_FAQ)[1] ?? '';
  const qc = siteImage('home-qc');
  const team = siteImage('home-team');
  const orgLd = company && { '@context': 'https://schema.org', '@type': 'Organization', name: company.brand ?? company.legal_name, legalName: company.legal_name, url: SITE_URL, logo: `${SITE_URL}/brand/octopus-b2b-logo.png`, email: company.email ?? undefined, telephone: company.phone ?? undefined };

  const services: { key: string; href: string; img: string; alt: string; label: string; soon?: boolean; title: string; body: string }[] = [
    { key: 'sourcing', href: '/sourcing', img: '01-homepage-service-card-product-sourcin.webp', alt: 'A buyer comparing product samples at a desk with a laptop.', label: 'Product sourcing', title: 'Tell us the product. We find the factory.', body: 'Send a photo, link or specification. We shortlist verified factories and return quotes within 24 hours.' },
    { key: 'brand', href: '/make-my-brand', img: '02-homepage-service-card-make-my-brand.webp', alt: 'Flat-lay of a branded product and box with a logo mock-up.', label: 'Make My Brand', title: 'Your brand on proven products.', body: 'Pick a product that already sells, add your logo and packaging, and see a studio preview before you commit.' },
    ...(poolsOn ? [{ key: 'pools', href: '/pools', img: '03-homepage-service-card-moq-pools.webp', alt: 'A few entrepreneurs examining one product sample together.', label: 'MOQ pools', title: 'Factory minimum too big? Share it.', body: 'Join other buyers to fill one factory order. Funds stay in escrow and are refunded if the pool does not fill.' }] : []),
    { key: 'dropship', href: '/request/dropship', img: '04-homepage-service-card-dropshipping.webp', alt: 'An online seller at home with a laptop and packed parcels.', label: 'Dropshipping', soon: true, title: 'You sell. We ship to your customer.', body: 'Connect your store and we fulfil each order from our China warehouse. Join the launch list.' },
    ...(turnkeyOn ? [{ key: 'turnkey', href: '/turnkey', img: '05-homepage-service-card-turnkey-project.webp', alt: 'A finished modern café interior with customers.', label: 'Turnkey projects', title: 'A complete business, set up from China.', body: `Choose from ${tkCount} projects, from cafés and gyms to small factories, with one team from enquiry to handover.` }] : []),
    { key: '3pl', href: '/3pl', img: '06-homepage-service-card-3pl-and-logisti.webp', alt: 'A bright organised warehouse aisle with a worker scanning a parcel.', label: '3PL and logistics', title: 'Stored in China. Delivered worldwide.', body: 'We receive, pick, pack and dispatch your orders with Express, Standard or Economy shipping, and handle returns.' },
  ];

  return (
    <div data-testid="home">
      {orgLd && <JsonLd data={orgLd} />}

      {/* services */}
      <section id="services" className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="services-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="services-h" className={h2Class}>{["Four", "Five", "Six"][services.length - 4] ?? "Six"} ways to work with us</h2>
          <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-muted max-w-[720px]">Start with one and add the others as you grow. Everything runs from one account, one wallet and one account manager.</p>
          <ul className="mt-9 flex flex-wrap gap-6 list-none p-0">
            {services.map((s) => (
              <li key={s.key} className="flex-[1_1_340px] min-w-0 flex">
                <Link href={s.href} className="group w-full bg-white border border-line rounded-[18px] overflow-hidden text-black flex flex-col card-lift hover:border-coral-text hover:text-black" data-testid={`home-service-${s.key}`}>
                  <Pic src={design(s.img)} alt={s.alt} rounded="rounded-none" />
                  <div className="p-6 flex flex-col gap-2.5 flex-1">
                    <div className="flex justify-between items-center gap-2">
                      {SUB_BRANDS[s.key as SubBrand]
                        ? <Image src={SUB_BRANDS[s.key as SubBrand].src} alt={SUB_BRANDS[s.key as SubBrand].alt} width={800} height={329} sizes="140px" className="block h-12 w-auto rounded-[8px]" />
                        : <b className="font-mono text-[13px] tracking-[.1em] uppercase text-coral-text">{s.label}</b>}
                      <StatusPill soon={s.soon} />
                    </div>
                    <h3 className="m-0 text-[22px]! leading-[1.2] font-semibold">{s.title}</h3>
                    <p className="m-0 text-[16px] leading-[1.55] text-muted flex-1">{s.body}</p>
                    <span className="font-bold text-coral-text mt-1.5 group-hover:underline">Learn more <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* learn */}
      <section className={`bg-tint px-4 sm:px-6 ${space.section}`} aria-labelledby="learn-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="learn-h" className={h2Class}>New to buying from China? Start here</h2>
          <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-muted max-w-[720px]">Three ideas that make every service easier to understand.</p>
          <ul className="mt-8 flex flex-wrap gap-5 list-none p-0">
            {[
              ['07-homepage-learn-card-what-is-an-moq.webp', 'A production line being set up with moulds and materials.', 'What is an MOQ?', 'The minimum order quantity a factory will produce at once. If it is too high for you, share it in an MOQ pool.'],
              ['08-homepage-learn-card-escrow.webp', 'A buyer reviewing an order status on a phone.', 'How does escrow protect me?', 'Your wallet funds are held by Octopus and released to the factory only after quality checks and shipping.'],
              ['09-homepage-learn-card-hs-code.webp', 'A customs-style parcel label being scanned.', 'What is an HS code?', 'A standard number that classifies a product for customs duty and import rules. You can search by it.'],
            ].map(([img, alt, t, b]) => (
              <li key={t} className="flex-[1_1_300px] min-w-0 bg-white rounded-[18px] overflow-hidden">
                <Pic src={design(img!)} alt={alt!} rounded="rounded-none" className="border-b border-line" />
                <div className="p-[22px]">
                  <h3 className="m-0 text-[21px]! font-semibold">{t}</h3>
                  <p className="mt-2 mb-0 text-[16px] leading-[1.55] text-muted">{b}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* turnkey — real catalogue projects */}
      {turnkeyOn && (
        <section id="turnkey" className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="tk-h">
          <div className="max-w-[1200px] mx-auto">
            <div className="flex flex-wrap justify-between items-end gap-4">
              <div className="max-w-[640px]">
                <h2 id="tk-h" className={h2Class}>Your complete business, set up from China</h2>
                <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-muted">Equipment, fit-out and sourcing for a ready-to-run business, planned with one account manager.</p>
              </div>
              <Link href="/turnkey/catalogue" className="inline-flex items-center min-h-11 font-semibold underline text-ink hover:text-coral-text">See all {tkCount} projects →</Link>
            </div>
            <ul className="mt-9 grid gap-5 grid-cols-[repeat(auto-fill,minmax(250px,1fr))] list-none p-0" data-testid="home-turnkey">
              {tkCards.map((p) => (
                <li key={p.project_id} className="min-w-0 flex">
                  <Link href="/turnkey/catalogue#projects" className="w-full bg-white border border-line rounded-[18px] overflow-hidden text-black flex flex-col card-lift hover:border-coral-text hover:text-black">
                    <div className="relative aspect-[3/2] bg-tint">
                      <Image src={p.image!} alt={p.hero_image_alt ?? p.title} fill sizes="(min-width:1200px) 280px, (min-width:600px) 50vw, 100vw" className="object-cover" unoptimized />
                    </div>
                    <div className="px-5 pt-[18px] pb-5">
                      <b className="block text-[18px] text-ink">{p.title}</b>
                      <span className="block mt-1 text-[15px] text-muted line-clamp-2">{p.short_reason || categoryLabel(p.category)}</span>
                    </div>
                  </Link>
                </li>
              ))}
              <li className="min-w-0 flex">
                <Link href="/turnkey/catalogue" className="w-full bg-ink rounded-[18px] p-7 text-white flex flex-col justify-end gap-2 min-h-[200px] hover:bg-ink-2 hover:text-white">
                  <b className="text-[22px] leading-[1.2]">Browse all {tkCount} projects →</b>
                  <span className="text-[15px] text-on-ink">Cafés, clinics, factories, solar and more</span>
                </Link>
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* products — real published products */}
      {ready.length > 0 && (
        <section id="products" className={`px-4 sm:px-6 pt-0 pb-16 md:pb-[88px]`} aria-labelledby="ready-h">
          <div className="max-w-[1200px] mx-auto">
            <p className={`${eyebrowClass} m-0 mb-3 text-coral-text`} data-testid="ready-caption">Examples via <Link href="/products" className="underline text-coral-text hover:text-ink">Octopus Sourcing</Link></p>
            <h2 id="ready-h" className={h2Class}>Ready to order from verified factories</h2>
            <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-muted max-w-[680px]">Prices are per piece at the factory minimum. Need fewer? {poolsOn ? <Link href="/pools" className="underline font-semibold text-ink hover:text-coral-text">Share the order in an MOQ pool</Link> : 'Share the order in an MOQ pool'} and split it with other buyers.</p>
            <ShowcaseGrid products={ready} categories={categories} testId="home-ready" />
            <p className="mt-6 mb-0"><Link href="/products" className="inline-flex items-center min-h-11 font-semibold underline text-ink hover:text-coral-text">View all products →</Link></p>
          </div>
        </section>
      )}

      {/* payment */}
      <section id="payment" className={`bg-ink text-white px-4 sm:px-6 ${space.section}`} aria-labelledby="pay-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="pay-h" className={`${h2Class} !text-white`}>Your money stays protected until your goods ship</h2>
          <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-on-ink max-w-[700px]">Payment is by US dollar wallet and bank transfer. Card payments are not accepted.</p>
          <ol className="mt-9 flex flex-wrap gap-4 list-none p-0">
            {[['Top up your wallet', 'Send a bank transfer in US dollars. Transfers usually take [X] working days.'], ['Approve a quote', 'Review price, minimum and lead time before you commit.'], ['Funds held in escrow', 'The factory is paid only when its work is done.'], ['Released after QC and shipping', 'Funds go to the factory once checks pass and your order ships.']].map(([t, b], i) => (
              <li key={t} className="flex-[1_1_240px] bg-ink-card rounded-[18px] p-6">
                <span className="font-mono text-[13px] font-semibold tracking-[.08em] text-on-ink-link">STEP {i + 1}</span>
                <h3 className="mt-2 mb-0 text-[18px]! font-semibold !text-white">{t}</h3>
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.5] text-on-ink">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* support + quality checks */}
      <section className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="support-h">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-10 items-center">
          <div className="flex-[1_1_480px] min-w-0">
            <h2 id="support-h" className={h2Class}>One person for every service</h2>
            <p className="mt-3 mb-0 text-[18px] leading-[1.6] text-muted">Your account manager handles sourcing, branding, warehouse and shipping questions, so you never repeat yourself. Office hours: {OFFICE_HOURS}.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/contact" className={btn.dark}>Book a call</Link>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={btn.outline}>Chat on WhatsApp</a>
            </div>
            <ul className="mt-8 grid grid-cols-1 min-[440px]:grid-cols-2 gap-3 list-none p-0 m-0">
              {[['Samples', 'Check before you order', '/request/sample'], ['QC inspection', 'Before goods ship', '/request/qc'], ['Certification', 'For your market', '/request/certification'], ['Ask Octo', 'Instant answers, any hour', '/assistant']].map(([t, b, href]) => (
                <li key={t} className="flex">
                  <Link href={href!} className="w-full bg-white border border-line rounded-[16px] p-5 text-black card-lift hover:border-coral-text hover:text-black">
                    <b className="text-ink">{t} <span aria-hidden="true">→</span></b><span className="block mt-1.5 text-[14px] text-muted">{b}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <figure className="flex-[1_1_400px] min-w-0 m-0">
            <Pic src={qc.src} alt={qc.alt} sizes="(min-width:1200px) 560px, 100vw" />
            <figcaption className="mt-2.5 text-[15px] text-muted">Quality checks happen at the factory, before your goods ship.</figcaption>
          </figure>
        </div>
      </section>

      <TeamBand img={team} dark />

      {/* faq */}
      <section id="faq" className={`px-4 sm:px-6 ${space.section}`} aria-labelledby="faq-h">
        <div className="max-w-[860px] mx-auto">
          <h2 id="faq-h" className={`${h2Class} mb-7`}>Questions buyers ask</h2>
          <div className="flex flex-col gap-3" data-testid="home-faq">
            {([
              ['How are factories verified?', verified],
              ['What is an MOQ pool?', 'Buyers share one factory order. Funds stay in escrow and are refunded if the pool does not fill.'],
              ['Where is the warehouse?', 'Foshan, China. We receive, store and dispatch from there.'],
              ['How do I pay?', 'Top up your US dollar wallet by bank transfer. Funds are held in escrow until QC and shipping are done.'],
            ] as [string, string][]).map(([q, a], i) => (
              <details key={q} open={i === 0} className="bg-white border border-line rounded-[14px] px-6 py-5 group">
                <summary className="cursor-pointer list-none text-[18px] font-semibold text-ink min-h-11 flex items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  {q}<span aria-hidden="true" className="text-coral-text text-[22px] leading-none group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 mb-0 text-[16px] leading-[1.6] text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* closing */}
      <section id="start" className={`bg-ink px-4 sm:px-6 ${space.section} text-center`} aria-labelledby="start-h">
        <div className="max-w-[720px] mx-auto">
          <h2 id="start-h" className={`${h2Class} !text-white`}>Tell us what you need</h2>
          <p className="mt-4 mb-0 text-[19px] text-on-ink">Free account, no card required. Quotes within 24 hours.</p>
          <div className="mt-7 flex flex-wrap gap-3 justify-center">
            <Link href="/signup" className={`${btn.primary} text-[17px] px-[30px]`}>Create a free account</Link>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={`${btn.light} text-[17px] px-[30px]`}>Chat on WhatsApp</a>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Hero + "the whole route" (no data) — outside Suspense so the H1 and the hero photo paint first. */
export function HomeHero() {
  const hero = siteImage('home-hero');
  const route: [string, string, ReturnType<typeof siteImage>, string][] = [
    ['Find', 'Source a product and get quotes from verified factories.', siteImage('step-find'), '/sourcing'],
    ['Brand', 'Your label and packaging on proven products.', siteImage('step-brand'), '/make-my-brand'],
    ['Stock', 'Stored in our Foshan warehouse.', siteImage('step-stock'), '/3pl'],
    ['Sell', 'Shopify and WooCommerce store connection is coming soon.', siteImage('step-sell'), '/request/dropship'],
    ['Ship', 'Express, Standard or Economy, delivered worldwide.', siteImage('step-ship'), '/3pl'],
  ];
  return (
    <>
      <section id="top" className="bg-ink text-white px-4 sm:px-6 pt-14 pb-20" aria-labelledby="hero-h">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-x-12 gap-y-10 items-center">
          <div className="flex-[1_1_520px] min-w-0">
            <p className={`${eyebrowClass} m-0 mb-4 text-on-ink-link`}>Buy from China, the safe way</p>
            <h1 id="hero-h" className={`${h1Class} !text-white text-balance`}>From the factory to your customer. One account.</h1>
            <p className="mt-6 mb-0 text-[19px] leading-[1.55] text-on-ink max-w-[560px]">Source products, put your brand on them, share factory minimums, store and ship worldwide. One US dollar wallet and one account manager for all of it.</p>
            <form action="/search" role="search" className="mt-8 flex flex-wrap gap-3 max-w-[600px]">
              <label htmlFor="hero-q" className="sr-only">Search products or HS codes</label>
              <input id="hero-q" name="q" type="search" placeholder="Search a product or HS code"
                className="flex-[1_1_260px] min-w-0 h-14 px-[18px] rounded-[10px] border-2 border-transparent text-[16px] text-black bg-white placeholder:text-muted" />
              <button type="submit" className="h-14 px-7 rounded-[10px] bg-coral text-white text-[16px] font-semibold cursor-pointer hover:bg-coral-text">Find factories</button>
            </form>
            <p className="mt-4 mb-0 text-[15px] text-on-ink">Or <Link href="/signup" className="text-white underline hover:text-on-ink-link">create a free account</Link> and request quotes.</p>
            <ul className="mt-8 mb-0 p-0 list-none flex flex-wrap gap-x-7 gap-y-3 text-[15px] text-white">
              {['Verified factories', 'Quotes in 24 hours', 'One account manager', 'Escrow wallet'].map((t) => <li key={t} className="flex gap-2 items-center"><Check className="text-on-ink-link !mt-0" />{t}</li>)}
            </ul>
          </div>
          <figure className="flex-[1_1_420px] min-w-0 m-0">
            <Pic src={hero.src} alt={hero.alt} rounded="rounded-[24px]" sizes="(min-width:1200px) 560px, (min-width:960px) 45vw, 100vw" preload />
          </figure>
        </div>
      </section>

      <section id="route" className={`px-4 sm:px-6 pt-16 md:pt-[88px] pb-0`} aria-labelledby="route-h">
        <div className="max-w-[1200px] mx-auto">
          <h2 id="route-h" className={h2Class}>One account, the whole route</h2>
          <p className="mt-3 mb-0 text-[18px] leading-[1.55] text-muted max-w-[720px]">Five steps from a factory in China to your customer. Use one, or all of them.</p>
          <ol className="mt-8 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5 list-none p-0">
            {route.map(([t, b, img, href], i) => (
              <li key={t} className={`min-w-0 flex ${i === 4 ? 'col-span-2 md:col-span-1' : ''}`}>
                <Link href={href} className="group w-full bg-white border border-line rounded-[18px] overflow-hidden text-black flex flex-col card-lift hover:border-coral-text hover:text-black">
                  <Pic src={img.src} alt={img.alt} square rounded="rounded-none" sizes="(min-width:1024px) 230px, (min-width:768px) 33vw, 50vw" />
                  <span className="p-4 flex flex-col gap-1.5">
                    <span className="flex items-center gap-2"><span aria-hidden="true" className="w-7 h-7 shrink-0 rounded-full bg-coral text-white text-[14px] font-bold flex items-center justify-center">{i + 1}</span><b className="text-[18px] text-ink">{t}</b></span>
                    <span className="text-[15px] leading-[1.45] text-muted">{b}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-[88px] grid gap-6 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
        {[0, 1, 2].map((i) => <div key={i} className="bg-white border border-line rounded-[18px] h-[460px]" />)}
      </div>
    </div>
  );
}
