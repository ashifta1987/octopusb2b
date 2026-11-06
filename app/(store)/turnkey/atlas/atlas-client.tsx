'use client';
import { createContext, useContext, useMemo, useState } from 'react';
import { CATEGORY_LABEL, TURNKEY_CATEGORIES, filterProjects, hubPosition, type AtlasSort, type TurnkeyHub, type TurnkeyProject } from '@/lib/turnkey/format';
import { ProjectCard } from '@/components/store/turnkey/ui';
import { logTurnkeySignal } from '../actions';

type State = { hub: string | null; setHub: (h: string | null) => void; category: string | null; setCategory: (c: string | null) => void; sort: AtlasSort; setSort: (s: AtlasSort) => void };
const Ctx = createContext<State | null>(null);
const useAtlas = () => useContext(Ctx)!;

export function AtlasProvider({ children }: { children: React.ReactNode }) {
  const [hub, setHub] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<AtlasSort>('budget');
  return <Ctx.Provider value={{ hub, setHub, category, setCategory, sort, setSort }}>{children}</Ctx.Provider>;
}

/** Stylised China map with hub dots (dot size = number of projects). Tap = filter + panel with what the hub is known for. */
export function AtlasMap({ hubs, projects }: { hubs: TurnkeyHub[]; projects: TurnkeyProject[] }) {
  const { hub, setHub } = useAtlas();
  const count = (id: string) => projects.filter((p) => p.factory_hub_ids.includes(id)).length;
  const sel = hubs.find((h) => h.hub_id === hub);
  return (
    <div className="relative h-[360px] sm:h-[440px] rounded-[16px] border border-[#2A2F5E] bg-[#1C204C] overflow-hidden" data-testid="atlas-map">
      <svg viewBox="0 0 800 500" className="absolute inset-0 w-full h-full opacity-55" aria-hidden preserveAspectRatio="none">
        <path fill="#262A6B" stroke="#3A3F80" strokeWidth="1.5" d="M120,260 C140,200 180,150 240,130 C290,112 330,105 380,110 C440,116 490,100 540,110 C600,124 650,145 690,180 C720,210 735,240 720,290 C700,340 670,370 620,390 C560,414 510,420 460,410 C390,400 340,425 290,420 C230,412 180,390 150,350 C125,318 108,295 120,260 Z" />
        <g stroke="#2A2F5E" strokeWidth=".5" opacity=".6">
          <line x1="0" y1="125" x2="800" y2="125" /><line x1="0" y1="250" x2="800" y2="250" /><line x1="0" y1="375" x2="800" y2="375" />
          <line x1="200" y1="0" x2="200" y2="500" /><line x1="400" y1="0" x2="400" y2="500" /><line x1="600" y1="0" x2="600" y2="500" />
        </g>
      </svg>
      <div className="absolute left-4 top-3 mono text-[10.5px] uppercase tracking-[.08em] text-[#8B93B5]">Factory hubs · tap to filter</div>
      {hubs.map((h) => {
        const pos = hubPosition(h); const n = count(h.hub_id); const active = hub === h.hub_id;
        const size = n >= 4 ? 20 : n >= 2 ? 15 : 11;
        return (
          <button key={h.hub_id} type="button" data-testid="hub-dot" data-hub={h.hub_id}
            onClick={() => { const next = active ? null : h.hub_id; setHub(next); if (next) void logTurnkeySignal('tap_hub', null, next); }}
            aria-pressed={active} aria-label={`${h.name}: ${n} project${n === 1 ? '' : 's'}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group min-w-11 min-h-11 justify-center"
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>
            <span className={`block rounded-full ring-4 ${active ? 'bg-[#F5B544] ring-[#F5B544]/30' : 'bg-[#3B82F6] ring-[#3B82F6]/25 group-hover:bg-[#60A5FA]'}`} style={{ width: size, height: size }} />
            <span className={`mono text-[10px] whitespace-nowrap px-1 rounded ${active ? 'bg-[#F5B544] text-navy font-semibold' : 'text-[#C9D0E8]'}`}>{h.name}</span>
          </button>
        );
      })}
      {sel && (
        <div className="absolute left-3 right-3 bottom-3 rounded-[12px] border border-[#FDE68A]/35 bg-[#F59E0B]/10 backdrop-blur px-4 py-3 flex flex-wrap gap-3 items-center justify-between" role="status" data-testid="hub-panel">
          <div>
            <div className="mono text-[10.5px] uppercase tracking-[.08em] text-[#FDE68A]">Filter · {sel.name}</div>
            <div className="text-white font-display font-bold text-[14.5px] mt-0.5">Known for {sel.known_for?.replace(/^./, (c) => c.toLowerCase())} · {count(sel.hub_id)} project{count(sel.hub_id) === 1 ? '' : 's'}</div>
          </div>
          <button type="button" onClick={() => setHub(null)} className="mono text-[11px] uppercase text-[#FDE68A] hover:text-white min-h-11 px-2">Clear filter ×</button>
        </div>
      )}
    </div>
  );
}

export function AtlasList({ projects, hubs }: { projects: TurnkeyProject[]; hubs: TurnkeyHub[] }) {
  const { hub, setHub, category, setCategory, sort, setSort } = useAtlas();
  const list = useMemo(() => filterProjects(projects, { category, hub, sort }), [projects, category, hub, sort]);
  const counts = useMemo(() => Object.fromEntries(TURNKEY_CATEGORIES.map((c) => [c, projects.filter((p) => p.category === c && (!hub || p.factory_hub_ids.includes(hub))).length])), [projects, hub]);
  const hubName = hubs.find((h) => h.hub_id === hub)?.name;
  const chip = (active: boolean) => `inline-flex items-center gap-2 min-h-10 px-3.5 rounded-full border text-[13.5px] whitespace-nowrap ${active ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-line hover:border-navy'}`;
  return (
    <>
      <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap pb-1" role="group" aria-label="Filter by category">
          <button type="button" className={chip(!category)} aria-pressed={!category} onClick={() => setCategory(null)}>All <span className="mono text-[11px] opacity-70">{hub ? list.length : projects.length}</span></button>
          {TURNKEY_CATEGORIES.map((c) => (
            <button key={c} type="button" data-testid="category-chip" data-category={c} className={chip(category === c)} aria-pressed={category === c}
              onClick={() => { setCategory(category === c ? null : c); }}>
              {CATEGORY_LABEL[c]} <span className="mono text-[11px] opacity-70">{counts[c]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <label htmlFor="tk-sort" className="text-muted">Sort:</label>
          <select id="tk-sort" value={sort} onChange={(e) => setSort(e.target.value as AtlasSort)} className="input min-h-10 py-0 w-auto text-[13.5px]">
            <option value="budget">Starting budget (low → high)</option>
            <option value="lead">Lead time</option>
            <option value="hub">Factory hub</option>
          </select>
          {(category || hub) && <button type="button" className="text-blue font-semibold" onClick={() => { setCategory(null); setHub(null); }}>Clear filters</button>}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{list.length} projects{hubName ? ` from ${hubName}` : ''}{category ? ` in ${CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL]}` : ''}</p>
      {list.length ? (
        <ul className="grid gap-3.5 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4" data-testid="atlas-list">
          {list.map((p) => <li key={p.project_id} className="flex"><ProjectCard p={p} /></li>)}
        </ul>
      ) : (
        <p className="text-muted text-[15px] py-10 text-center">No project matches these filters. <button type="button" className="text-blue font-semibold" onClick={() => { setCategory(null); setHub(null); }}>Clear filters</button></p>
      )}
    </>
  );
}
