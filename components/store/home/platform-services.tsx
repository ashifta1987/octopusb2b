import Link from 'next/link';
import { FileText, Users, ShieldCheck, Award, Container, Truck, Globe, Wallet, Bot, Plug } from 'lucide-react';
import { block } from '@/lib/content';
import { copy, SectionHead } from './shared';

type Blocks = Record<string, string>;

const CARDS = {
  rfq: { href: '/request/sourcing', Icon: FileText, bg: 'bg-[#E6EFFC]', fg: 'text-[#1E4FA0]', fallback: 'RFQ to many suppliers||Send an RFQ' },
  pool: { href: '/pools', Icon: Users, bg: 'bg-[#FFF4E5]', fg: 'text-[#92400E]', fallback: 'Group buy (MOQ pools)||Browse pools' },
  turnkey: { href: '/turnkey', Icon: Container, bg: 'bg-blue', fg: 'text-white', fallback: 'Turnkey Projects||Explore projects' },
  dropship: { href: '/request/dropship', Icon: Truck, bg: 'bg-[#F3E8FF]', fg: 'text-[#6B21A8]', fallback: 'Dropshipping||How it works' },
  '3pl': { href: '/#global-shipping', Icon: Globe, bg: 'bg-[#DBEAFE]', fg: 'text-[#1E40AF]', fallback: '3PL & global shipping||See coverage' },
  qc: { href: '/request/qc', Icon: ShieldCheck, bg: 'bg-[#DCFCE7]', fg: 'text-[#166534]', fallback: 'QC inspection||Book a QC check' },
  certification: { href: '/request/certification', Icon: Award, bg: 'bg-[#FEE2E2]', fg: 'text-[#B91C1C]', fallback: 'Certification||Request certification' },
  wallet: { href: '/account/wallet', Icon: Wallet, bg: 'bg-[#ECFDF5]', fg: 'text-[#047857]', fallback: 'Wallet & escrow||Open wallet' },
  assistant: { href: '/account/assistant', Icon: Bot, bg: 'bg-[#EEF2FF]', fg: 'text-[#4338CA]', fallback: 'AI account manager||Meet Octo' },
  api: { href: '/account/developer', Icon: Plug, bg: 'bg-[#F1F5F9]', fg: 'text-[#334155]', fallback: 'API & integrations||View API' },
} as const;
export type FeatureKey = keyof typeof CARDS;
export const FEATURE_KEYS = Object.keys(CARDS) as FeatureKey[];

/** ADDON-32 "Everything you need, in one platform" — 10 cards; order + visibility from site_settings `home.feature_cards`,
 *  copy from content_blocks `home.platform.<key>`. Turnkey is highlighted with a "New" pill. Group buy hides when pools are off. */
export function PlatformServices({ blocks, poolsOn, order, vars }: { blocks: Blocks; poolsOn: boolean; order: unknown; vars: Record<string, string | number | null | undefined> }) {
  const keys = (Array.isArray(order) ? order : FEATURE_KEYS).filter((k): k is FeatureKey => typeof k === 'string' && k in CARDS).filter((k) => k !== 'pool' || poolsOn);
  if (!keys.length) return null;
  return (
    <section aria-labelledby="home-platform-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-14" data-testid="home-features">
      <div className="mono text-[11px] uppercase tracking-[.08em] text-blue font-semibold mb-1">The platform</div>
      <SectionHead id="home-platform-h" size="md" title={block(blocks, 'home.platform.title', 'Everything you need, in one platform')} />
      {block(blocks, 'home.platform.subtitle') && <p className="text-[15px] text-[#3B4556] -mt-3 mb-5 max-w-2xl">{block(blocks, 'home.platform.subtitle')}</p>}
      <ul className="grid gap-3.5 grid-cols-1 min-[481px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {keys.map((key) => {
          const { href, Icon, bg, fg, fallback } = CARDS[key];
          const [title, body, cta] = copy(blocks, `home.platform.${key}`, fallback, vars);
          const hi = key === 'turnkey';
          return (
            <li key={key}>
              <Link href={href} data-feature={key} className={`group relative card rounded-[14px] p-5 flex flex-col gap-2.5 h-full hover:border-blue ${hi ? 'border-[1.5px] border-blue shadow-[0_0_0_4px_rgba(42,111,214,.08)]' : ''}`}>
                {hi && <span className="absolute top-3 right-3 mono text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">New</span>}
                <span className={`w-11 h-11 rounded-[10px] flex items-center justify-center ${bg} ${fg}`} aria-hidden>
                  <Icon className="w-5 h-5" strokeWidth={2} focusable="false" />
                </span>
                <h3 className="font-display font-bold text-[16px] leading-[1.25]">{title}</h3>
                {body && <p className="text-[13.5px] leading-[1.5] text-[#3B4556]">{body}</p>}
                <span className="mt-auto text-[12.5px] font-semibold text-blue group-hover:underline">{cta} <span aria-hidden>→</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
