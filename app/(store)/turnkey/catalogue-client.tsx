'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { categoryLabel, projectFrom, type TkProject } from '@/lib/turnkey/format';

type Card = TkProject & { image: string | null };
const PAGE = 48;

/**
 * Turnkey catalogue cards (design: 300 photo cards, search, category chips, project detail pop-up).
 * The pop-up is a native <dialog>: it traps focus and closes with Escape.
 */
export function CatalogueClient({ projects }: { projects: Card[] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [size, setSize] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Card | null>(null);
  const dlg = useRef<HTMLDialogElement | null>(null);
  const cats = useMemo(() => [...new Set(projects.map((p) => p.category))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))), [projects]);
  const hasArea = projects.some((p) => p.floor_area_m2 != null);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return projects.filter((p) =>
      (!cat || p.category === cat)
      && (!term || p.title.toLowerCase().includes(term) || categoryLabel(p.category).toLowerCase().includes(term) || (p.short_reason ?? '').toLowerCase().includes(term))
      && (!size || (p.floor_area_m2 != null && (size === 's' ? p.floor_area_m2 < 100 : size === 'm' ? p.floor_area_m2 >= 100 && p.floor_area_m2 <= 500 : p.floor_area_m2 > 500))));
  }, [projects, q, cat, size]);

  const show = (p: Card) => { setOpen(p); requestAnimationFrame(() => dlg.current?.showModal()); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-[13px] text-[#5A6080] flex-1 basis-[260px] max-w-[420px]">
          <span>Search projects</span>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Gym, laundry, vending…"
            className="min-h-11 rounded-[10px] border border-[#D3DAEC] bg-white px-3 text-[15px] text-[#1A174A]" data-testid="tk-search" />
        </label>
        {hasArea && (
          <label className="flex flex-col gap-1 text-[13px] text-[#5A6080]">
            <span>Space size</span>
            <select value={size} onChange={(e) => { setSize(e.target.value); setShown(PAGE); }} className="min-h-11 rounded-[10px] border border-[#D3DAEC] bg-white px-3 text-[15px] text-[#1A174A]">
              <option value="">Any size</option><option value="s">Under 100 m²</option><option value="m">100–500 m²</option><option value="l">Over 500 m²</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
        {[['', 'All'], ...cats.map((c) => [c, categoryLabel(c)])].map(([c, label]) => (
          <button key={c || 'all'} type="button" aria-pressed={cat === c} onClick={() => { setCat(c); setShown(PAGE); }}
            className={`min-h-11 px-4 rounded-full border text-[14px] font-medium ${cat === c ? 'bg-[#1A174A] text-white border-[#1A174A]' : 'bg-white text-[#1A174A] border-[#D3DAEC] hover:border-[#2F6FE0]'}`}
            data-testid={`tk-chip-${c || 'all'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="m-0 text-[13.5px] text-[#5A6080]" role="status" data-testid="tk-count">{list.length} project{list.length === 1 ? '' : 's'}</p>
      {list.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#D3DAEC] bg-white p-8 text-center" data-testid="tk-empty">
          <p className="m-0 font-semibold text-[#1A174A]">No project matches.</p>
          <p className="mt-1 mb-3 text-[14px] text-[#5A6080]">Tell us what you want to open and we’ll plan it with you.</p>
          <Link href="/account/turnkey/new" className="inline-flex min-h-11 items-center px-4 rounded-[10px] bg-[#2559B8] text-white font-semibold no-underline">Ask for a new project</Link>
        </div>
      ) : (
        <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="tk-cards">
          {list.slice(0, shown).map((p) => (
            <li key={p.project_id}>
              <button type="button" onClick={() => show(p)} className="w-full text-left rounded-[14px] border border-[#E1E6F2] bg-white overflow-hidden hover:border-[#2F6FE0] focus-visible:outline-2 focus-visible:outline-[#2F6FE0]"
                data-testid={`tk-card-${p.project_id}`} aria-haspopup="dialog">
                <div className="aspect-[4/3] bg-[#E8F0FD] flex items-center justify-center text-[13px] text-[#5A6080]">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt={p.hero_image_alt ?? p.title} loading="lazy" className="w-full h-full object-cover" />
                  ) : 'Photo coming'}
                </div>
                <div className="p-4 flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-[#2F6FE0]">{categoryLabel(p.category)}</span>
                  <span className="font-[family-name:var(--font-tk-outfit)] text-[18px] font-semibold text-[#1A174A] leading-tight">{p.title}</span>
                  {projectFrom(p) && <span className="text-[14px] text-[#3B4160]">{projectFrom(p)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown < list.length && (
        <div className="text-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="min-h-11 px-5 rounded-[10px] border border-[#D3DAEC] bg-white text-[#1A174A] font-semibold hover:border-[#2F6FE0]" data-testid="tk-more">
            Show more ({list.length - shown} left)
          </button>
        </div>
      )}

      <dialog ref={dlg} onClose={() => setOpen(null)} aria-labelledby="tk-dlg-title" data-testid="tk-dialog"
        className="w-[min(680px,calc(100vw-32px))] rounded-[16px] p-0 backdrop:bg-black/50">
        {open && (
          <div>
            <div className="aspect-[16/9] bg-[#E8F0FD] flex items-center justify-center text-[#5A6080]">
              {open.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.image} alt={open.hero_image_alt ?? open.title} className="w-full h-full object-cover" />
              ) : 'Photo coming'}
            </div>
            <div className="p-6 flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-[#2F6FE0]">{categoryLabel(open.category)}</span>
              <h3 id="tk-dlg-title" className="font-[family-name:var(--font-tk-outfit)] text-[26px] font-bold text-[#1A174A] m-0">{open.title}</h3>
              {open.short_reason && <p className="m-0 text-[15px] text-[#3B4160]">{open.short_reason}</p>}
              <dl className="m-0 grid grid-cols-[140px_1fr] gap-y-1 text-[14px]">
                {projectFrom(open) && <><dt className="text-[#5A6080]">Starting budget</dt><dd className="m-0">{projectFrom(open)}</dd></>}
                {open.floor_area_m2 != null && <><dt className="text-[#5A6080]">Space</dt><dd className="m-0">About {open.floor_area_m2} m²</dd></>}
              </dl>
              <p className="m-0 text-[13.5px] text-[#5A6080]">The enquiry is free. The first paid step is a consultation, and we set the exact fee with you before any work starts.</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href={`/account/turnkey/new?project=${encodeURIComponent(open.project_id)}`} data-testid="tk-dialog-start" className="inline-flex min-h-11 items-center px-5 rounded-[10px] bg-[#2559B8] text-white font-semibold no-underline">Book a consultation</Link>
                <button type="button" onClick={() => dlg.current?.close()} className="min-h-11 px-5 rounded-[10px] border border-[#D3DAEC] text-[#1A174A] font-semibold">Close</button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
