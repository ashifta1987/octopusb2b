'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { categoryLabel, projectFrom, type TkProject } from '@/lib/turnkey/format';

type Card = TkProject & { image: string | null };
const PAGE = 48;

const chip = 'inline-flex items-center min-h-11 px-[18px] rounded-full border-2 border-ink text-[15px] font-semibold cursor-pointer';

/**
 * Turnkey catalogue (design page 08): live projects (turnkey_projects, photos in site-media) with search, category chips,
 * "Show more" and a project pop-up. The pop-up is a native <dialog>: it traps focus and closes with Escape.
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 id="tk-projects-h" className="m-0 text-[length:clamp(26px,4.5vw,34px)] font-extrabold">Projects</h2>
          <p className="m-0 mt-1 text-[16px] text-muted" role="status" data-testid="tk-count">{list.length} project{list.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {hasArea && (
            <div>
              <label htmlFor="tk-size" className="block text-[14px] font-semibold text-ink mb-1">Space size</label>
              <select id="tk-size" value={size} onChange={(e) => { setSize(e.target.value); setShown(PAGE); }}
                className="h-12 rounded-[10px] border-2 border-line-strong bg-white px-3 text-[16px] text-black">
                <option value="">Any size</option><option value="s">Under 100 m²</option><option value="m">100–500 m²</option><option value="l">Over 500 m²</option>
              </select>
            </div>
          )}
          <div className="w-full sm:w-[340px]">
            <label htmlFor="tk-search" className="sr-only">Search projects</label>
            <input id="tk-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search projects"
              className="w-full h-12 rounded-[10px] border-2 border-line-strong bg-white px-4 text-[16px] text-black placeholder:text-muted" data-testid="tk-search" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Project categories">
        {[['', 'All'], ...cats.map((c) => [c, categoryLabel(c)])].map(([c, label]) => (
          <button key={c || 'all'} type="button" aria-pressed={cat === c} onClick={() => { setCat(c); setShown(PAGE); }}
            className={`${chip} ${cat === c ? 'bg-ink text-white' : 'bg-transparent text-ink hover:bg-tint'}`}
            data-testid={`tk-chip-${c || 'all'}`}>
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-line-strong bg-white p-8 text-center" data-testid="tk-empty">
          <p className="m-0 font-semibold text-ink">No project matches.</p>
          <p className="mt-1 mb-3 text-[15px] text-muted">Tell us what you want to open and we’ll plan it with you.</p>
          <Link href="/account/turnkey/new" className="inline-flex min-h-12 items-center px-6 rounded-[10px] bg-ink text-white font-semibold hover:bg-ink-2 hover:text-white">Ask for a new project</Link>
        </div>
      ) : (
        <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="tk-cards">
          {list.slice(0, shown).map((p) => (
            <li key={p.project_id} className="min-w-0 flex">
              <button type="button" onClick={() => show(p)} className="w-full text-left rounded-[18px] border border-line bg-white overflow-hidden hover:border-coral-text cursor-pointer flex flex-col"
                data-testid={`tk-card-${p.project_id}`} aria-haspopup="dialog">
                <span className="relative block w-full aspect-[3/2] bg-tint">
                  {p.image
                    ? <Image src={p.image} alt={p.hero_image_alt ?? p.title} fill sizes="(min-width:1280px) 290px, (min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover" unoptimized />
                    : <span className="absolute inset-0 flex items-center justify-center text-[14px] text-muted">Photo coming</span>}
                </span>
                <span className="px-5 pt-4 pb-5 flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-coral-text">{categoryLabel(p.category)}</span>
                  <span className="text-[19px] font-bold text-ink leading-tight">{p.title}</span>
                  {projectFrom(p) && <span className="text-[14px] text-muted">{projectFrom(p)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown < list.length && (
        <div className="text-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="inline-flex items-center min-h-12 px-7 rounded-[10px] border-2 border-ink bg-transparent text-ink font-semibold cursor-pointer hover:bg-ink hover:text-white" data-testid="tk-more">
            Show more projects ({list.length - shown} left)
          </button>
        </div>
      )}

      <dialog ref={dlg} onClose={() => setOpen(null)} aria-labelledby="tk-dlg-title" data-testid="tk-dialog"
        className="w-[min(680px,calc(100vw-32px))] m-auto rounded-[18px] p-0 backdrop:bg-black/50">
        {open && (
          <div>
            <div className="relative aspect-[3/2] bg-tint">
              {open.image
                ? <Image src={open.image} alt={open.hero_image_alt ?? open.title} fill sizes="680px" className="object-cover" unoptimized />
                : <span className="absolute inset-0 flex items-center justify-center text-muted">Photo coming</span>}
            </div>
            <div className="p-6 flex flex-col gap-3">
              <span className="text-[13px] font-semibold text-coral-text">{categoryLabel(open.category)}</span>
              <h3 id="tk-dlg-title" className="text-[26px] font-extrabold m-0">{open.title}</h3>
              {open.short_reason && <p className="m-0 text-[16px] text-muted">{open.short_reason}</p>}
              <dl className="m-0 grid grid-cols-[140px_1fr] gap-y-1 text-[15px]">
                {projectFrom(open) && <><dt className="text-muted">Starting budget</dt><dd className="m-0 text-black">{projectFrom(open)}</dd></>}
                {open.floor_area_m2 != null && <><dt className="text-muted">Space</dt><dd className="m-0 text-black">About {open.floor_area_m2} m²</dd></>}
              </dl>
              <p className="m-0 text-[14px] text-muted">The enquiry is free. The first paid step is a consultation, and we set the exact fee with you before any work starts.</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href={`/account/turnkey/new?project=${encodeURIComponent(open.project_id)}`} data-testid="tk-dialog-start" className="inline-flex min-h-12 items-center px-6 rounded-[10px] bg-coral text-white font-semibold hover:bg-coral-text hover:text-white">Book a consultation</Link>
                <button type="button" onClick={() => dlg.current?.close()} className="inline-flex items-center min-h-12 px-6 rounded-[10px] border-2 border-ink text-ink font-semibold cursor-pointer hover:bg-ink hover:text-white">Close</button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
