import Link from 'next/link';
import { Globe, Warehouse, Truck, Plane } from 'lucide-react';
import { copy, Emphasis, fill, hasToken } from './shared';
import { block } from '@/lib/content';
import { COUNTRY_NAMES } from '@/lib/format';
import { flagEmoji, type HomeLiveData } from './live-data';

type Blocks = Record<string, string>;
export type LogisticsStats = { countries?: string; hubs?: string; parcels_daily?: string; service_lines?: string };
export type Destinations = { items?: { flag?: string; name: string }[]; more?: number };

const CARDS = [
  { key: 'yun', href: '/request/3pl', Icon: Globe, blob: 'bg-[#E6EFFC]', icon: 'bg-navy', eyebrow: 'text-blue', btn: 'btn btn-primary',
    fallback: 'YunExpress integration|Global shipping to {countries} countries||See shipping options' },
  { key: '3pl', href: '/request/3pl', Icon: Warehouse, blob: 'bg-[#DBEAFE]', icon: 'bg-[#1E40AF]', eyebrow: 'text-[#1E40AF]', btn: 'btn btn-dark',
    fallback: '3PL fulfilment|Warehouses near your buyers||Request a 3PL quote' },
  { key: 'dropship', href: '/request/dropship', Icon: Truck, blob: 'bg-[#F3E8FF]', icon: 'bg-[#6B21A8]', eyebrow: 'text-[#6B21A8]', btn: 'btn bg-[#6B21A8] text-white hover:bg-[#581C87]',
    fallback: 'Dropshipping|Ship under your brand, zero stock||Start a dropship request' },
] as const;

/** Main.png navy logistics band (YunExpress + 3PL + dropshipping). Copy from content_blocks `home.logistics.*`.
 *  Figures are REAL: platform numbers from the database (`live`) plus carrier figures an admin has verified
 *  (site_settings.logistics_stats — empty by default). Missing data → the tile is not shown / empty state. */
export function LogisticsBand({ blocks, stats, live }: { blocks: Blocks; stats: LogisticsStats; live: HomeLiveData; destinations?: Destinations }) {
  const vars = { countries: stats.countries };
  const [bQuote, bLines] = copy(blocks, 'home.logistics.buttons', 'Request a shipping quote|See service lines');
  const n = (v: number) => new Intl.NumberFormat('en-US').format(v);
  const vlabels = copy(blocks, 'home.logistics.stat_labels', 'Countries & regions served|Transit hubs globally|Parcels shipped daily|Service lines');
  const llabels = copy(blocks, 'home.logistics.live_stat_labels', 'Countries we ship to|Shipments sent|Carrier integrations');
  const one = copy(blocks, 'home.logistics.live_stat_labels_one', 'Country we ship to|Shipment sent|Carrier integration');
  const tiles = [
    // verified carrier figures (only if an admin entered them)
    ...([stats.countries, stats.hubs, stats.parcels_daily, stats.service_lines] as (string | undefined)[]).map((v, i) => ({ v, l: vlabels[i] })),
    // live platform figures from the database
    { v: live.destinations.length ? n(live.destinations.length) : undefined, l: live.destinations.length === 1 ? one[0] : llabels[0] },
    { v: live.shipments ? n(live.shipments) : undefined, l: live.shipments === 1 ? one[1] : llabels[1] },
    { v: live.carriers ? n(live.carriers) : undefined, l: live.carriers === 1 ? one[2] : llabels[2] },
  ].filter((t) => t.v && t.l).slice(0, 4);
  const title = stats.countries
    ? fill(block(blocks, 'home.logistics.title', 'Delivered worldwide. *Fulfilled under your brand.*'), vars)
    : block(blocks, 'home.logistics.title_plain', 'Delivered worldwide. *Fulfilled under your brand.*');
  const MAX_CHIPS = 11;
  const chips = live.destinations.slice(0, MAX_CHIPS).map((c) => ({ flag: flagEmoji(c), name: COUNTRY_NAMES[c] ?? c }));
  const moreChips = Math.max(0, live.destinations.length - MAX_CHIPS);

  return (
    <section aria-labelledby="home-logistics-h" className="relative overflow-hidden text-white mt-8 bg-[linear-gradient(135deg,#0A0B2A_0%,#11133C_50%,#1A1F5C_100%)]">
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 w-[480px] h-[480px] rounded-full bg-[radial-gradient(circle,rgba(42,111,214,0.25),transparent_60%)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-[120px] -left-[60px] w-[420px] h-[420px] rounded-full bg-[radial-gradient(circle,rgba(111,168,242,0.18),transparent_60%)]" />
      <div className="relative max-w-[1360px] mx-auto px-4 sm:px-8 py-12 sm:py-14">
        <div className="flex flex-wrap justify-between items-end gap-6 mb-8">
          <div className="flex-[1_1_480px] min-w-0 flex flex-col gap-3.5">
            <span className="self-start inline-flex items-center gap-2.5 max-w-full rounded-full border border-[rgba(111,168,242,0.4)] bg-[rgba(42,111,214,0.18)] text-[#C7DBFA] mono text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.08em] leading-tight px-3.5 py-2">
              <Plane className="w-3.5 h-3.5 shrink-0" aria-hidden focusable="false" />
              {block(blocks, 'home.logistics.pill', 'Official logistics partner')}
            </span>
            <h2 id="home-logistics-h" className="!text-white text-[28px] sm:text-[36px] lg:text-[42px] font-extrabold leading-[1.08] tracking-[-0.025em] max-w-[760px]">
              <Emphasis text={title} className="text-[#6FA8F2]" />
            </h2>
            <p className="text-[15px] sm:text-[16px] leading-[1.6] text-[#C3CBD7] max-w-[640px]">{block(blocks, 'home.logistics.body')}</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/request/3pl" className="btn btn-light min-h-[46px]">{bQuote}</Link>
            <a href="#service-lines" className="btn min-h-[46px] bg-transparent text-white border-white/35 hover:border-white hover:bg-white/10">{bLines}</a>
          </div>
        </div>

        {tiles.length === 0 && (
          <p className="mb-9 rounded-[14px] border border-white/10 bg-white/5 px-5 py-[18px] text-[14px] text-[#C3CBD7]">
            {block(blocks, 'home.logistics.stats_empty', 'Live shipping figures appear here as soon as the first orders ship.')}
          </p>
        )}
        {tiles.length > 0 && (
          <dl className={`grid gap-3.5 grid-cols-2 mb-9 ${tiles.length >= 4 ? 'lg:grid-cols-4' : tiles.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
            {tiles.map((t) => (
              <div key={t.l} className="rounded-[14px] border border-white/10 bg-white/5 px-5 py-[18px] flex flex-col-reverse gap-1.5">
                <dt className="text-[13px] text-[#B4BECD]">{t.l}</dt>
                <dd className="font-display font-extrabold text-[24px] sm:text-[28px] leading-none text-white">{t.v}</dd>
              </div>
            ))}
          </dl>
        )}

        <ul id="service-lines" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8 scroll-mt-24">
          {CARDS.map(({ key, href, Icon, blob, icon, eyebrow, btn, fallback }) => {
            const [eb, title3, body, cta] = copy(blocks, `home.logistics.${key}`, fallback, vars);
            const points = copy(blocks, `home.logistics.${key}.points`, '', vars).filter((p) => p && !hasToken(p));
            return (
              <li key={key} className="relative overflow-hidden rounded-[18px] bg-white text-navy p-[26px] flex flex-col gap-3.5">
                <span aria-hidden className={`absolute -top-10 -right-10 w-[180px] h-[180px] rounded-full ${blob}`} />
                <span className={`relative w-[50px] h-[50px] rounded-xl text-white flex items-center justify-center ${icon}`} aria-hidden>
                  <Icon className="w-6 h-6" strokeWidth={2} focusable="false" />
                </span>
                <div className="relative flex flex-col gap-1.5">
                  <span className={`mono text-[11px] uppercase tracking-[0.08em] font-semibold ${eyebrow}`}>{eb}</span>
                  <h3 className="text-[20px] sm:text-[22px] font-extrabold leading-[1.2]">{hasToken(title3) ? block(blocks, `home.logistics.${key}.title_plain`, eb) : title3}</h3>
                </div>
                {body && <p className="relative text-[14px] leading-[1.55] text-[#3B4556]">{body}</p>}
                {points.length > 0 && (
                  <ul className="relative list-disc pl-[18px] flex flex-col gap-1.5 text-[13.5px] text-[#3B4556]">
                    {points.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
                <Link href={href} className={`${btn} relative self-start mt-auto min-h-11`}>{cta}</Link>
              </li>
            );
          })}
        </ul>

        {chips.length === 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3.5 pt-6 border-t border-white/10">
            <h3 className="!text-[#B4BECD] mono text-[12px] font-medium uppercase tracking-[0.08em]">{block(blocks, 'home.logistics.destinations_label', 'Key destinations')}</h3>
            <p className="text-[13px] text-[#C3CBD7]">{block(blocks, 'home.logistics.destinations_empty', 'Destinations are listed here once orders ship.')}</p>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3.5 pt-6 border-t border-white/10">
            <h3 id="home-destinations-h" className="!text-[#B4BECD] mono text-[12px] font-medium uppercase tracking-[0.08em]">{block(blocks, 'home.logistics.destinations_label', 'Key destinations')}</h3>
            <ul className="flex flex-wrap gap-2" aria-labelledby="home-destinations-h">
              {chips.map((c) => (
                <li key={c.name} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-[#E4E8EE]">
                  {c.flag && <span aria-hidden>{c.flag}</span>}{c.name}
                </li>
              ))}
              {moreChips ? <li className="inline-flex items-center px-1 text-[13px] text-[#B4BECD]">+ {moreChips} more</li> : null}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
