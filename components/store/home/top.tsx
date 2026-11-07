import Link from 'next/link';
import { block } from '@/lib/content';
import type { PoolCard } from '@/components/store/data';
import type { TurnkeyPackage, TurnkeyProject } from '@/lib/turnkey/format';
import { kUsd } from '@/lib/turnkey/format';
import type { OpenProjectCard } from '@/lib/turnkey/live';
import { StarterStrip } from '@/components/store/turnkey/ui';
import { copy, fill, n } from './shared';
import type { HomeBanner } from './banners-data';
import { BannerRotator, TrackSlot } from './banner-rotator';

type Blocks = Record<string, string>;
type Vars = Record<string, string | number | null | undefined>;

/** ADDON-32 §1a — dark announcement bar: "label|link text|href" from content block home.announcement; switch home.announcement_enabled. */
export function AnnouncementBar({ blocks, vars }: { blocks: Blocks; vars: Vars }) {
  const [text, linkText, href] = copy(blocks, 'home.announcement', '', vars);
  if (!text) return null;
  const [pill, ...rest] = text.split(' · ');
  return (
    <TrackSlot slot="announcement" className="bg-navy text-white text-[13px]">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-center" data-testid="announcement">
        {rest.length > 0 && <span className="mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">{pill}</span>}
        <span>{rest.length ? rest.join(' · ') : text}</span>
        {linkText && href && /^(\/|https:\/\/)/.test(href) && <Link href={href} className="font-semibold text-[#93C5FD] hover:text-white underline-offset-2 hover:underline">{linkText}</Link>}
      </div>
    </TrackSlot>
  );
}

const THEME: Record<HomeBanner['theme'], string> = {
  navy: 'bg-navy text-white', blue: 'bg-blue-fill text-white', light: 'bg-[#EEF4FD] text-navy',
};

function Container40() {
  return (
    <div aria-hidden className="hidden min-[761px]:flex flex-col justify-center gap-3 w-[230px] shrink-0">
      <div className="rounded-[10px] border-2 border-[#4C5BD4] bg-[#262A6B] p-4 shadow-[0_10px_30px_rgba(0,0,0,.25)]">
        <div className="flex gap-1.5 mb-3">{['#F5B544', '#E5E7EB', '#E5E7EB', '#E5E7EB'].map((c, i) => <span key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />)}</div>
        <div className="mono text-[13px] font-bold tracking-[.12em] text-white text-center border border-white/30 rounded px-2 py-2">OCTOPUS B2B · 40HC</div>
        <div className="grid grid-cols-6 gap-1 mt-3">{Array.from({ length: 6 }).map((_, i) => <span key={i} className="h-8 rounded-sm bg-[#1C204C]" />)}</div>
      </div>
    </div>
  );
}

function LeadSlide({ b, open }: { b: HomeBanner; open: OpenProjectCard | null }) {
  const dark = b.theme !== 'light';
  return (
    <div className={`relative h-full rounded-[18px] overflow-hidden p-6 sm:p-8 flex gap-6 ${THEME[b.theme]}`}>
      {b.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.image_url} alt="" width={1200} height={600} className="absolute inset-0 w-full h-full object-cover opacity-25" />
      )}
      <div className="relative flex-1 min-w-0 flex flex-col gap-4">
        {b.eyebrow && <div className="flex gap-2">{b.eyebrow.split(' · ').map((e, i) => <span key={i} className={`mono text-[10px] font-bold uppercase px-2 py-1 rounded-full ${i === 0 ? 'bg-[#FEF3C7] text-[#92400E]' : dark ? 'bg-white/10 text-[#C9D0E8]' : 'bg-white text-navy'}`}>{e}</span>)}</div>}
        <h1 id="home-hero-h" className={`font-display font-extrabold text-[30px] sm:text-[40px] xl:text-[44px] leading-[1.05] tracking-[-0.02em] ${dark ? '!text-white' : ''}`}>{b.title}</h1>
        {b.body && <p className={`text-[15px] sm:text-[16px] leading-[1.55] max-w-[540px] ${dark ? 'text-[#C9D0E8]' : 'text-[#3B4556]'}`}>{b.body}</p>}
        <div className="flex flex-wrap gap-2.5">
          {b.cta_label && b.cta_href && <Link href={b.cta_href} className="btn btn-primary min-h-11" data-testid="lead-cta">{b.cta_label}</Link>}
          {b.cta2_label && b.cta2_href && <Link href={b.cta2_href} className={`btn min-h-11 ${dark ? 'border border-white/40 text-white hover:bg-white/10 hover:text-white' : 'btn-ghost'}`}>{b.cta2_label}</Link>}
        </div>
        {b.ticks.length > 0 && <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] ${dark ? 'text-[#A9B2D0]' : 'text-muted'}`}>{b.ticks.map((t) => <li key={t}>✓ {t}</li>)}</ul>}
      </div>
      {b.show_open_project && (
        <div className="relative hidden min-[761px]:flex flex-col justify-center gap-3">
          <Container40 />
          {open && (
            <div className="rounded-[12px] bg-[#1C204C] border border-white/15 p-3.5 w-[230px] text-[12px]" data-testid="open-project">
              <div className="flex justify-between gap-2"><span className="mono text-[9.5px] uppercase text-[#A9B2D0]">Open project · {open.reference}</span><span className="mono text-[9.5px] uppercase px-1.5 py-0.5 rounded-full bg-[#DBEAFE] text-[#1E40AF]">{open.stage}</span></div>
              <div className="font-semibold mt-1">{open.project}{open.tier ? ` · ${open.tier}` : ''} · {open.country}</div>
              <div className="mono text-[9.5px] uppercase text-[#A9B2D0] mt-1">Spec → Quote → QC → Ship → Install</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** ADDON-32 §1d — banner grid: rotating CMS lead banner (Turnkey by default) + Group buy and Dropship · 3PL side banners. */
export function BannerGrid({ blocks, banners, open, pool, poolsOn, vars }: { blocks: Blocks; banners: HomeBanner[]; open: OpenProjectCard | null; pool: PoolCard | null; poolsOn: boolean; vars: Vars }) {
  const [pEyebrow, pTitle, pBody, pCta] = copy(blocks, 'home.side.pools', 'Group buy|MOQ too big? Pool with other buyers.||See open pools →', vars);
  const [sEyebrow, sTitle, sBody, sCta] = copy(blocks, 'home.side.shipping', 'Dropship · 3PL|Ship worldwide. Your brand on the box.||How shipping works →', vars);
  return (
    <section aria-labelledby="home-hero-h" className="bg-surface border-b border-line">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-6 grid gap-4 min-[1100px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]" data-testid="banner-grid">
        <div className="min-h-[340px]">
          {banners.length ? (
            <BannerRotator ids={banners.map((b) => b.id)}>{banners.map((b) => <LeadSlide key={b.id} b={b} open={open} />)}</BannerRotator>
          ) : (
            <div className="h-full rounded-[18px] bg-navy text-white p-8 flex flex-col justify-center gap-4">
              <h1 id="home-hero-h" className="font-display font-extrabold text-[34px] leading-tight !text-white">{block(blocks, 'home.hero.title', block(blocks, 'home.title', 'Global sourcing, simplified'))}</h1>
              <div><Link href="/products" className="btn btn-primary">Browse products</Link></div>
            </div>
          )}
        </div>
        <div className="grid gap-4 min-[761px]:grid-cols-2 min-[1100px]:grid-cols-1">
          {poolsOn && (
            <TrackSlot slot="side-pools" className="h-full">
              <Link href="/pools" className="group h-full rounded-[18px] bg-blue-fill text-white p-5 flex flex-col gap-2 hover:bg-blue-dark hover:text-white">
                <span className="self-start mono text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-white/15">{pEyebrow}</span>
                <span className="font-display font-extrabold text-[20px] leading-tight">{pTitle}</span>
                {pBody && <span className="text-[13px] text-white/85">{pBody}</span>}
                <span className="mt-auto flex flex-wrap justify-between items-end gap-2 pt-1">
                  <span className="font-semibold text-[13.5px] group-hover:underline">{pCta}</span>
                  {pool && <span className="mono text-[11px] text-white/80">{n(pool.filled_qty)} / {n(pool.target_qty)} {pool.product.unit}</span>}
                </span>
              </Link>
            </TrackSlot>
          )}
          <TrackSlot slot="side-shipping" className="h-full">
            <a href="#global-shipping" className="group h-full rounded-[18px] bg-[#FFF7E6] border border-[#F8DDA6] text-navy p-5 flex flex-col gap-2 hover:border-[#F5B544]">
              <span className="self-start mono text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-[#FEF3C7] text-[#92400E]">{sEyebrow}</span>
              <span className="font-display font-extrabold text-[20px] leading-tight">{sTitle}</span>
              {sBody && <span className="text-[13px] text-[#3B4556]">{sBody}</span>}
              <span className="mt-auto font-semibold text-[13.5px] text-blue group-hover:underline pt-1">{sCta}</span>
            </a>
          </TrackSlot>
        </div>
      </div>
    </section>
  );
}

/** ADDON-32 §1e — 6 stat tiles from LIVE data; a tile without a real value is not shown. */
export function StatsStrip({ tiles }: { tiles: { label: string; value: string | null }[] }) {
  const shown = tiles.filter((t) => t.value);
  if (!shown.length) return null;
  return (
    <section aria-label="Platform in numbers" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-6">
      <ul className="grid gap-3 grid-cols-2 min-[761px]:grid-cols-3 min-[1100px]:grid-cols-6" data-testid="stats-strip">
        {shown.map((t) => (
          <li key={t.label} className="bg-white border border-line rounded-[12px] px-4 py-3">
            <div className="font-display font-extrabold text-[22px] text-navy">{t.value}</div>
            <div className="mono text-[10.5px] uppercase tracking-[.06em] text-muted">{t.label}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ADDON-32 §1g — Turnkey section: "Start with these five" + strip of live packages with From-prices. */
export function TurnkeySection({ blocks, projects, packages, vars }: { blocks: Blocks; projects: TurnkeyProject[]; packages: TurnkeyPackage[]; vars: Vars }) {
  if (!projects.some((p) => p.is_starter_pick)) return null;
  const live = projects.filter((p) => p.status === 'live');
  const interest = projects.filter((p) => p.status === 'register-interest').length;
  const from = (id: string) => kUsd(Math.min(...packages.filter((k) => k.project_id === id && k.starting_budget_usd != null).map((k) => k.starting_budget_usd!)));
  return (
    <section aria-labelledby="home-turnkey-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-14" data-testid="home-turnkey">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-5">
        <div>
          <div className="flex gap-2 items-center mb-1"><span className="mono text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">New</span><span className="mono text-[11px] uppercase tracking-[.08em] text-blue font-semibold">Turnkey projects</span></div>
          <h2 id="home-turnkey-h" className="font-extrabold leading-[1.1] tracking-[-0.02em] text-[24px] sm:text-[28px]">{block(blocks, 'home.turnkey.title', 'Start a business, not a shopping list')}</h2>
          <p className="text-[15px] text-[#3B4556] mt-1.5 max-w-2xl">{fill(block(blocks, 'home.turnkey.body', ''), vars)}</p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/turnkey/atlas" className="btn btn-ghost">Project Atlas</Link>
          <Link href="/turnkey" className="btn btn-dark">All Turnkey Projects →</Link>
        </div>
      </div>
      <StarterStrip projects={projects} />
      {live.length > 0 && (
        <div className="mt-4 rounded-[12px] bg-surface border border-line px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
          <span className="mono text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-[#DCFCE7] text-[#15803D]">Live · quote today</span>
          {live.map((p) => <Link key={p.project_id} href={`/turnkey/${p.project_id}`} className="font-semibold hover:text-blue">{p.title.replace(/ (fit-out|kiosk|network)$/i, '')} <span className="text-muted font-normal">from {from(p.project_id) ?? kUsd(p.starting_budget_usd)}</span></Link>)}
          {interest > 0 && <span className="text-muted ml-auto">+ {interest} more open for register-interest</span>}
        </div>
      )}
    </section>
  );
}

/** ADDON-32 §1j — Octo card next to "Can't find what you need?". */
export function OctoCard({ blocks }: { blocks: Blocks }) {
  const [eyebrow, title, body, cta] = copy(blocks, 'home.octo', 'Your account team|Chat with Octo, 24 / 7.||Open the assistant →');
  return (
    <div className="rounded-[20px] bg-[#EEF4FD] border border-[#C9DBF6] p-6 sm:p-8 flex flex-col gap-2.5">
      <div className="mono text-[11px] uppercase tracking-[.08em] text-blue font-semibold">{eyebrow}</div>
      <h2 className="font-display font-extrabold text-[22px] sm:text-[24px] leading-tight">{title}</h2>
      {body && <p className="text-[14.5px] text-[#3B4556]">{body}</p>}
      <Link href="/account/assistant" className="mt-auto font-semibold text-blue">{cta}</Link>
    </div>
  );
}

