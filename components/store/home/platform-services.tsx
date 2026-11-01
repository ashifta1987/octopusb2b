import Link from 'next/link';
import { FileText, Users, ShieldCheck, Award } from 'lucide-react';
import { block } from '@/lib/content';
import { copy, SectionHead } from './shared';

type Blocks = Record<string, string>;

const CARDS = [
  { key: 'rfq', href: '/request/sourcing', Icon: FileText, bg: 'bg-[#E6EFFC]', fg: 'text-[#1E4FA0]', fallback: 'RFQ to many suppliers||Send an RFQ' },
  { key: 'pool', href: '/pools', Icon: Users, bg: 'bg-[#FFF4E5]', fg: 'text-[#92400E]', fallback: 'Group buy (MOQ pools)||Browse pools' },
  { key: 'qc', href: '/request/qc', Icon: ShieldCheck, bg: 'bg-[#DCFCE7]', fg: 'text-[#166534]', fallback: 'QC inspection||Book a QC check' },
  { key: 'certification', href: '/request/certification', Icon: Award, bg: 'bg-[#FEE2E2]', fg: 'text-[#B91C1C]', fallback: 'Certification||Request certification' },
] as const;

/** Main.png "Everything you need, in one platform" — 4 service cards (copy from content_blocks `home.platform.*`).
 *  The group-buy card is hidden when pools are switched off; its deposit % comes from site_settings.pool_deposit_pct. */
export function PlatformServices({ blocks, poolsOn, depositPct }: { blocks: Blocks; poolsOn: boolean; depositPct: number }) {
  const cards = CARDS.filter((c) => c.key !== 'pool' || poolsOn);
  return (
    <section aria-labelledby="home-platform-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-12">
      <SectionHead id="home-platform-h" size="md" title={block(blocks, 'home.platform.title', 'Everything you need, in one platform')}
        href="/request" link={block(blocks, 'home.platform.link', 'Open the Request Center')} />
      <ul className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]">
        {cards.map(({ key, href, Icon, bg, fg, fallback }) => {
          const [title, body, cta] = copy(blocks, `home.platform.${key}`, fallback, { deposit_pct: depositPct });
          return (
            <li key={key}>
              <Link href={href} className="group card rounded-[14px] p-5 flex flex-col gap-2.5 h-full hover:border-blue">
                <span className={`w-11 h-11 rounded-[10px] flex items-center justify-center ${bg} ${fg}`} aria-hidden>
                  <Icon className="w-5 h-5" strokeWidth={2} focusable="false" />
                </span>
                <h3 className="font-display font-bold text-[16px] leading-[1.25]">{title}</h3>
                {body && <p className="text-[13.5px] leading-[1.5] text-[#3B4556]">{body}</p>}
                <span className="mt-auto text-[12px] font-semibold text-blue group-hover:underline">{cta} <span aria-hidden>→</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
