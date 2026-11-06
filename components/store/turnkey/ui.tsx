import Link from 'next/link';
import { CATEGORY_PILL, CATEGORY_PILL_CLASS, fromLabel, kUsd, type TurnkeyPackage, type TurnkeyProject } from '@/lib/turnkey/format';

/** Turnkey Projects UI pieces (ADDON-31, design/TurnkeyHub · TurnkeyAtlas · TurnkeyProject_*.dc.html). */

export function TkPill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mono text-[11px] font-semibold uppercase tracking-[.04em] leading-none ${className}`}>{children}</span>;
}
export const LivePill = () => <TkPill className="bg-[#DCFCE7] text-[#15803D]">Live</TkPill>;
export const TopPill = ({ rank }: { rank?: number | null }) => <TkPill className="bg-[#FEF3C7] text-[#92400E]">{rank ? `#${rank} top pick` : 'Top pick'}</TkPill>;
export const CategoryPill = ({ p }: { p: Pick<TurnkeyProject, 'category'> }) => <TkPill className={CATEGORY_PILL_CLASS[p.category]}>{CATEGORY_PILL[p.category]}</TkPill>;
export const Eyebrow = ({ children, className = 'text-blue' }: { children: React.ReactNode; className?: string }) =>
  <div className={`mono text-[11px] font-semibold uppercase tracking-[.08em] ${className}`}>{children}</div>;

/** Striped placeholder (the design has no photography yet). An admin-set hero image replaces it. */
export function TkImage({ p, label, className = '' }: { p?: Pick<TurnkeyProject, 'hero_image_path' | 'title'>; label: string; className?: string }) {
  if (p?.hero_image_path) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.hero_image_path} alt="" className={`object-cover w-full h-full ${className}`} loading="lazy" />;
  }
  return (
    <div aria-hidden className={`flex items-center justify-center mono text-[12px] text-muted ${className}`}
      style={{ background: 'repeating-linear-gradient(135deg,#EDEFF3 0 10px,#E5E8ED 10px 20px)' }}>{label}</div>
  );
}

export function ProjectCard({ p, compact = false }: { p: TurnkeyProject; compact?: boolean }) {
  return (
    <Link href={`/turnkey/${p.project_id}`} data-testid="turnkey-card" data-project={p.project_id}
      className="group bg-white border border-line rounded-[14px] overflow-hidden flex flex-col hover:border-blue hover:shadow-sm transition-colors focus-visible:outline-3 focus-visible:outline-[#1D4ED8]">
      <TkImage p={p} label={p.title} className={compact ? 'h-[120px]' : 'h-[140px]'} />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex flex-wrap gap-1.5">
          {p.status === 'live' && <LivePill />}
          {p.is_starter_pick && <TopPill />}
          <CategoryPill p={p} />
        </div>
        <div className="font-display font-bold text-[15px] text-navy leading-snug group-hover:text-blue">{p.title}</div>
        {p.short_reason && <p className="text-[13px] text-muted leading-snug">{p.short_reason}</p>}
        <div className="mt-auto pt-1 flex items-end justify-between gap-2">
          <span className="font-semibold text-[14px] text-navy">{fromLabel(p)}</span>
          <span className="mono text-[11px] uppercase text-muted text-right">{[p.hub_label, p.lead_time_days ? `~${p.lead_time_days} d` : null].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
    </Link>
  );
}

/** "Start with these five" — swipe strip (scroll-snap) on phones, 5-up grid on desktop. */
export function StarterStrip({ projects }: { projects: TurnkeyProject[] }) {
  const picks = projects.filter((p) => p.is_starter_pick).sort((a, b) => (a.starter_rank ?? 9) - (b.starter_rank ?? 9));
  if (!picks.length) return null;
  return (
    <ul className="flex lg:grid lg:grid-cols-5 gap-3.5 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 lg:mx-0 lg:px-0 lg:overflow-visible" data-testid="starter-strip">
      {picks.map((p) => (
        <li key={p.project_id} className="snap-start shrink-0 w-[220px] lg:w-auto">
          <Link href={`/turnkey/${p.project_id}`} data-testid="starter-card" className="h-full bg-white border border-line rounded-[14px] overflow-hidden flex flex-col hover:border-blue">
            <TkImage p={p} label={p.title} className="h-[120px] lg:h-[140px]" />
            <div className="p-3.5 flex flex-col gap-1.5 flex-1">
              <div className="flex items-start justify-between gap-2">
                <TopPill rank={p.starter_rank} />
                <span className="mono text-[10.5px] uppercase text-muted text-right">{p.hub_label}</span>
              </div>
              <div className="font-display font-bold text-[14.5px] text-navy leading-snug">{p.title}</div>
              {p.short_reason && <p className="text-[12.5px] text-muted leading-snug">{p.short_reason}</p>}
              <div className="mt-auto flex justify-between text-[13px] pt-1">
                <b className="text-navy">{fromLabel(p)}</b>
                {p.lead_time_days && <span className="text-muted">~{p.lead_time_days} days</span>}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Live module card (hub "Four packages you can quote today"). */
export function LiveModuleCard({ p, packages }: { p: TurnkeyProject; packages: TurnkeyPackage[] }) {
  const tiers = packages.filter((k) => k.project_id === p.project_id).sort((a, b) => a.tier_rank - b.tier_rank);
  return (
    <div className="bg-white border border-line rounded-[14px] overflow-hidden grid sm:grid-cols-[150px_1fr]">
      <TkImage p={p} label={p.title} className="h-[120px] sm:h-full" />
      <div className="p-4 sm:p-5 flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1.5"><LivePill /><CategoryPill p={p} /></div>
        <h3 className="font-display font-bold text-[18px] text-navy">{p.title}</h3>
        {p.short_reason && <p className="text-[13.5px] text-muted">{p.short_reason}</p>}
        {tiers.length > 0 && (
          <dl className="grid grid-cols-3 gap-2 rounded-[10px] bg-surface px-3 py-2">
            {tiers.map((k) => (
              <div key={k.package_id}><dt className="mono text-[10px] uppercase text-muted">{k.tier_name}</dt><dd className="font-semibold text-[13px] text-navy">{kUsd(k.starting_budget_usd)}</dd></div>
            ))}
          </dl>
        )}
        <div><Link href={`/turnkey/${p.project_id}`} className="btn btn-primary min-h-10 text-[14px]">View packages →</Link></div>
      </div>
    </div>
  );
}

export const SIX_STEPS: [string, string][] = [
  ['Specify', 'Pick a package, send us your floor plan.'], ['Quote', 'USD price and Incoterm in 24 h.'], ['Sample', 'Key items optional, before you commit.'],
  ['QC', 'Our inspector at the factory, before packing.'], ['Ship', 'Consolidated, DAP or FOB — your choice.'], ['Install', 'On-site guide, training, 12-mo support.'],
];

export const FOUR_TESTS: [string, string][] = [
  ['Equipment is most of the cost', "So sourcing moves the needle. Civil works and real estate aren't in our scope."],
  ['Ships in containers', 'So one consolidated shipment reaches your door intact.'],
  ['Revenue model is simple', 'So the payback period is predictable. We publish the range.'],
  ["Buyer isn't an expert", 'So the specification, QC and training we provide actually earns its keep.'],
];

export const COVERED: string[] = ['Pre-shipment QC, photos + video', 'Consolidated shipment', 'Floor plan review by our team', 'On-site install & staff training (opt)', '12-month post-sale support'];

