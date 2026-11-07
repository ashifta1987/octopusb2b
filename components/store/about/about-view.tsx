import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck, House, Globe, SquareCheck, MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import { block, getSiteContent, type Branch } from '@/lib/content';
import { copy, fill, hasToken, n } from '@/components/store/home/shared';
import { getHomeLiveData } from '@/components/store/home/live-data';

/**
 * /about — docs/design/About.png. Every text comes from content_blocks `about.*`, company_profile and branches
 * (Admin → Site content). Figures are REAL: office count from branches, suppliers/products/markets from live data,
 * carrier coverage only when verified in site_settings.logistics_stats. Missing data → item hidden / empty state.
 */

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (v: number) => WORDS[v] ?? n(v);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Chip colours per office (About.html). */
const TONES: Record<string, string> = {
  blue: 'bg-[#DBEAFE] text-[#1E40AF]',
  rose: 'bg-[#FFE4E6] text-[#9F1239]',
  cyan: 'bg-[#CFFAFE] text-[#155E75]',
  pink: 'bg-[#FCE7F3] text-[#9D174D]',
  amber: 'bg-[#FEF3C7] text-[#92400E]',
  green: 'bg-[#DCFCE7] text-[#166534]',
  purple: 'bg-[#F3E8FF] text-[#6B21A8]',
};
const PILLAR_ICONS = [
  { Icon: ShieldCheck, bg: 'bg-[#DCFCE7]', fg: '#157A44' },
  { Icon: House, bg: 'bg-[#DBEAFE]', fg: '#1E40AF' },
  { Icon: Globe, bg: 'bg-[#FFEDD5]', fg: '#C2410C' },
  { Icon: SquareCheck, bg: 'bg-[#F3E8FF]', fg: '#6B21A8' },
];

const pill = 'inline-flex items-center gap-[5px] text-[12px] font-semibold px-2.5 py-[5px] rounded-full whitespace-nowrap';
const eyebrow = 'mono text-[12px] tracking-[0.08em] uppercase text-blue font-semibold';

/** "a, b, c and d" */
function list(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Text with *bold* segments. */
function Bold({ text }: { text: string }) {
  return <>{text.split(/(\*[^*]+\*)/g).filter(Boolean).map((s, i) => (s.startsWith('*') && s.endsWith('*') ? <strong key={i} className="text-navy">{s.slice(1, -1)}</strong> : <span key={i}>{s}</span>))}</>;
}

export async function AboutView() {
  const [{ blocks, company, branches, settings }, live] = await Promise.all([getSiteContent(), getHomeLiveData()]);
  const offices = branches.filter((b) => (b.country ?? 'China') === 'China');
  const verified = (settings.logistics_stats ?? {}) as { countries?: string };
  const num = (k: string) => (typeof settings[k] === 'number' ? (settings[k] as number) : Number(settings[k] ?? NaN));
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}` : null;

  const vars = {
    legal_name: company?.legal_name,
    offices_word: offices.length ? word(offices.length) : null,
    Offices_word: offices.length ? cap(word(offices.length)) : null,
    countries: verified.countries || null,
    cities: offices.length ? list(offices.map((o) => o.city ?? o.name)) : null,
    deposit_pct: Number.isFinite(num('deposit_pct')) ? num('deposit_pct') : null,
    claim_visible_days: Number.isFinite(num('claim_visible_days')) ? num('claim_visible_days') : null,
    claim_hidden_days: Number.isFinite(num('claim_hidden_days')) ? num('claim_hidden_days') : null,
  };
  const t = (key: string, fb = '') => fill(block(blocks, key, fb), vars);

  // Hero: the "Shipping to N countries" form only with a verified carrier figure.
  let title = t('about.hero.title', 'Sourcing from {offices_word} China hubs. Shipping to {countries} countries.');
  if (hasToken(title)) title = t('about.hero.title_plain', 'Sourcing from {offices_word} China hubs. Shipping worldwide.');
  if (hasToken(title)) title = block(blocks, 'about.title', 'About Octopus B2B');
  const eyebrowText = t('about.hero.eyebrow', 'About · {legal_name}');
  const [bRfq, bOffices, bWa] = copy(blocks, 'about.hero.buttons', 'Send us an RFQ|See our offices|WhatsApp sales');

  const labels = copy(blocks, 'about.stats.labels', 'Sourcing offices in China|Verified suppliers|Products listed|Markets we ship to|Markets with orders');
  const stats = [
    { v: offices.length ? n(offices.length) : '', l: labels[0] },
    { v: live.verifiedSuppliers ? n(live.verifiedSuppliers) : '', l: labels[1] },
    { v: live.products ? n(live.products) : '', l: labels[2] },
    verified.countries ? { v: verified.countries, l: labels[3] } : { v: live.markets ? n(live.markets) : '', l: labels[4] },
  ].filter((s) => s.v && s.l);

  const who = copy(blocks, 'about.who.body', '', vars).filter((p) => p && !hasToken(p));
  const pillars = copy(blocks, 'about.pillars', '', vars).map((p, i) => {
    const [h, d] = p.split('~');
    // Global reach without a verified country figure → plain sentence.
    const body = d && hasToken(d) && i === 2 ? block(blocks, 'about.pillars.reach_plain', '') : d;
    return { h: h?.trim(), d: body?.trim(), icon: PILLAR_ICONS[i % PILLAR_ICONS.length] };
  }).filter((p) => p.h && p.d && !hasToken(p.d));

  const offTitle = t('about.offices.title', '{Offices_word} cities. {Offices_word} specialities.');
  const promises = copy(blocks, 'about.promises', '', vars).map((p) => {
    const [h, d] = p.split('~');
    return { h: h?.trim(), d: d?.trim() };
  }).filter((p) => p.h && p.d && !hasToken(p.h) && !hasToken(p.d));
  const partners = copy(blocks, 'about.partners', '').filter(Boolean);
  const [cRfq, cSupplier] = copy(blocks, 'about.company.buttons', 'Send us an RFQ|Become a supplier');

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden text-white bg-[linear-gradient(135deg,#0A0B2A_0%,#11133C_55%,#1A1F5C_100%)]" aria-labelledby="about-h">
        <div aria-hidden className="absolute -top-[120px] -right-20 w-[540px] h-[540px] rounded-full bg-[radial-gradient(circle,rgba(42,111,214,0.3),transparent_65%)]" />
        <div aria-hidden className="absolute -bottom-[140px] -left-[60px] w-[460px] h-[460px] rounded-full bg-[radial-gradient(circle,rgba(111,168,242,0.18),transparent_65%)]" />
        <div className="relative max-w-[1360px] mx-auto px-4 sm:px-8 py-12 sm:py-16 grid gap-10 lg:gap-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center">
          <div className="min-w-0 flex flex-col gap-[18px]">
            {!hasToken(eyebrowText) && (
              <span className={`${pill} self-start uppercase whitespace-normal bg-[rgba(42,111,214,0.2)] border border-[rgba(111,168,242,0.4)] text-[#C7DBFA]`}>{eyebrowText}</span>
            )}
            <h1 id="about-h" className="!text-white text-[34px] sm:text-[46px] xl:text-[56px] font-extrabold leading-[1.08] sm:leading-[1.05] tracking-[-0.025em]">{title}</h1>
            <p className="text-[16px] sm:text-[17px] leading-[1.6] text-[#C3CBD7] max-w-[640px]">{t('about.hero.subtitle')}</p>
            <div className="flex flex-wrap gap-2.5 mt-1">
              <Link href="/request/sourcing" className="btn bg-white text-navy hover:bg-[#EEF0F3]">{bRfq}</Link>
              <a href="#offices" className="btn bg-transparent text-white border border-white/35 hover:bg-white/10">{bOffices}</a>
              {wa && bWa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="btn bg-[rgba(37,211,102,0.15)] text-[#4ADE80] border border-[rgba(74,222,128,0.4)] hover:bg-[rgba(37,211,102,0.25)]">
                  <MessageCircle size={16} aria-hidden />{bWa}
                </a>
              )}
            </div>
          </div>
          {stats.length > 0 && (
            <dl className="grid grid-cols-2 gap-3" aria-label="Octopus B2B in numbers">
              {stats.map((s) => (
                <div key={s.l} className="bg-white/[0.06] border border-white/10 rounded-[14px] p-4 sm:p-5 flex flex-col-reverse">
                  <dt className="text-[13px] text-[#9AA6B8] mt-1.5">{s.l}</dt>
                  <dd className="font-[family-name:var(--font-display)] font-extrabold text-[28px] sm:text-[32px] leading-none text-white">{s.v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* ───── Who we are ───── */}
      <section aria-labelledby="who-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-12 sm:pt-16">
        <div className="grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
          <div className="flex flex-col gap-2.5 lg:sticky lg:top-6">
            <span className={eyebrow}>{t('about.who.eyebrow', 'Who we are')}</span>
            <h2 id="who-h" className="text-[28px] sm:text-[36px] font-extrabold leading-[1.1] tracking-[-0.02em]">{t('about.who.title')}</h2>
          </div>
          <div className="min-w-0 flex flex-col gap-[22px]">
            {who.map((p, i) => <p key={i} className="text-[16px] sm:text-[17px] leading-[1.65] text-[#3B4556]"><Bold text={p} /></p>)}
            {pillars.length > 0 && (
              <ul className="grid gap-3.5 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] mt-2.5">
                {pillars.map(({ h, d, icon: { Icon, bg, fg } }) => (
                  <li key={h} className="card p-[18px] flex flex-col gap-2">
                    <span className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`} aria-hidden><Icon size={18} color={fg} /></span>
                    <strong className="font-[family-name:var(--font-display)] font-bold text-[15px] leading-[1.2]">{h}</strong>
                    <span className="text-[13px] text-[#3B4556] leading-[1.5]">{d}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ───── Offices ───── */}
      <section id="offices" aria-labelledby="off-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-14 sm:pt-[72px] scroll-mt-6">
        <div className="flex flex-col gap-2 max-w-[640px] mb-7">
          <span className={eyebrow}>{t('about.offices.eyebrow', 'Our offices in China')}</span>
          <h2 id="off-h" className="text-[28px] sm:text-[36px] font-extrabold leading-[1.1] tracking-[-0.02em]">
            {hasToken(offTitle) ? t('about.offices.eyebrow', 'Our offices in China') : offTitle}
          </h2>
          <p className="text-[15px] leading-[1.6] text-[#3B4556]">{t('about.offices.intro')}</p>
        </div>
        {offices.length ? (
          <div className="grid gap-[18px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {offices.map((o) => <OfficeCard key={o.id} o={o} />)}
          </div>
        ) : (
          <div className="card p-8 text-center text-[15px] text-muted">{t('about.offices.empty', 'Office details are being updated.')}</div>
        )}
      </section>

      {/* ───── Promises ───── */}
      {promises.length > 0 && (
        <section aria-labelledby="pr-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-14 sm:pt-[72px]">
          <div className="grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
            <div className="flex flex-col gap-2.5">
              <span className={eyebrow}>{t('about.promises.eyebrow', 'The way we work')}</span>
              <h2 id="pr-h" className="text-[28px] sm:text-[36px] font-extrabold leading-[1.1] tracking-[-0.02em]">{t('about.promises.title')}</h2>
            </div>
            <ul className="grid gap-3.5 grid-cols-1 sm:grid-cols-2">
              {promises.map((p) => (
                <li key={p.h} className="card p-5 flex flex-col gap-2.5">
                  <strong className="font-[family-name:var(--font-display)] font-bold text-[16px] leading-[1.2]">{p.h}</strong>
                  <p className="text-[13.5px] text-[#3B4556] leading-[1.55]">{p.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───── Company details ───── */}
      {company && (
        <section aria-labelledby="co-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-14 sm:pt-[72px]">
          <div className="rounded-2xl border border-[#B9D2F5] bg-[linear-gradient(135deg,#FFFFFF_0%,#F4F8FE_100%)] p-6 sm:p-9 flex flex-wrap gap-8 items-center justify-between">
            <div className="flex-[1_1_460px] min-w-0 flex flex-col gap-2.5">
              <span className={eyebrow}>{t('about.company.eyebrow', 'Company details')}</span>
              <h2 id="co-h" className="text-[24px] sm:text-[28px] font-extrabold leading-[1.15]">{company.legal_name}</h2>
              {company.legal_name_cn && <div className="text-[15px] text-[#5A6475]" lang="zh-CN">{company.legal_name_cn}</div>}
              <dl className="mt-1.5 flex flex-col gap-1.5 text-[14px] text-[#3B4556]">
                {([
                  ['Registered:', company.registered_in],
                  ['T&C governed by:', company.governing_law],
                  ['Director:', company.contact_person],
                  ['General email:', company.email && <a href={`mailto:${company.email}`} className="hover:text-blue">{company.email}</a>],
                  ['WhatsApp sales:', company.phone && (wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="mono hover:text-blue">{company.phone}</a> : <span className="mono">{company.phone}</span>)],
                ] as [string, ReactNode][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-2">
                    <dt className="font-semibold text-navy sm:min-w-[110px]">{k}</dt><dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex-[1_1_300px] min-w-0 flex flex-col gap-2.5">
              {partners.length > 0 && (
                <>
                  <strong className="font-[family-name:var(--font-display)] font-bold text-[15px] leading-[1.2]">{t('about.partners.title', 'Partner network')}</strong>
                  <ul className="flex flex-wrap gap-2">
                    {partners.map((p) => <li key={p} className={`${pill} bg-white border border-line text-navy`}>{p}</li>)}
                  </ul>
                </>
              )}
              <div className="flex flex-wrap gap-2.5 mt-3">
                <Link href="/request/sourcing" className="btn btn-primary">{cRfq}</Link>
                <Link href="/suppliers" className="btn btn-ghost">{cSupplier}</Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function OfficeCard({ o }: { o: Branch }) {
  const chip = TONES[o.tone ?? 'blue'] ?? TONES.blue;
  const specs = (o.specialities ?? []).filter(Boolean);
  return (
    <article className={`card p-6 flex flex-col gap-4 relative ${o.is_hq ? '!border-2 !border-navy' : ''}`} aria-labelledby={`office-${o.id}`}>
      {o.badge && <span className={`${pill} absolute top-[18px] right-[18px] max-w-[60%] truncate ${o.is_hq ? 'bg-navy text-white' : TONES.amber}`}>{o.badge}</span>}
      <div className="flex flex-col gap-1 min-w-0">
        {o.province && <span className={`mono text-[11px] tracking-[0.08em] uppercase text-[#5A6475] ${o.badge ? 'pr-36' : ''}`}>{o.province}</span>}
        <h3 id={`office-${o.id}`} className={`text-[24px] sm:text-[26px] font-extrabold leading-[1.1] ${o.badge && !o.province ? 'pr-36' : ''}`}>
          {o.city ?? o.name} {o.city_local && <span className="text-[#5A6475] font-semibold text-[20px] whitespace-nowrap" lang="zh-CN">{o.city_local}</span>}
        </h3>
        {o.tagline && <span className="text-[13px] text-[#3B4556]">{o.tagline}</span>}
      </div>
      {specs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Specialities">
          {specs.map((s) => <li key={s} className={`${pill} ${chip}`}>{s}</li>)}
        </ul>
      )}
      {o.description && <p className="text-[13.5px] text-[#3B4556] leading-[1.55]">{o.description}</p>}
      <address className="not-italic mt-auto border-t border-[#EEF0F3] pt-3.5 flex flex-col gap-1.5 text-[13px] text-[#3B4556]">
        {o.address && <div className="flex gap-2 items-start"><MapPin size={14} className="mt-0.5 shrink-0 text-blue" aria-hidden /><span>{o.address}</span></div>}
        {o.phone && <div className="flex gap-2 items-center"><Phone size={14} className="shrink-0" aria-hidden /><a href={`tel:${o.phone.replace(/[^\d+]/g, '')}`} className="mono hover:text-blue">{o.phone}</a></div>}
        {o.email && <div className="flex gap-2 items-center min-w-0"><Mail size={14} className="shrink-0" aria-hidden /><a href={`mailto:${o.email}`} className="text-navy hover:text-blue break-all">{o.email}</a></div>}
        {o.hours && <div className="flex gap-2 items-center text-[#5A6475]"><Clock size={14} className="shrink-0" aria-hidden /><span>{o.hours}</span></div>}
      </address>
    </article>
  );
}

export function AboutSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="h-[420px] bg-navy" />
      <div className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-16 grid gap-6 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[420px]" />)}
      </div>
    </div>
  );
}
