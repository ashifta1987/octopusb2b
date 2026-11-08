'use client';
import { useRef, useState, useSyncExternalStore } from 'react';

/** Brand kit / ADDON-48 — the full-width Ink "What do you want to do?" picker. Tabs: aria-pressed, arrow keys, ?do= in the URL. */
export type PickerTab = { key: string; label: string; service: string; promise: string; steps: string[]; fact: string; cta: string; href: string };
const COUNTRIES: [string, string][] = [['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['DE', 'Germany'], ['AU', 'Australia'], ['', 'Other country']];

export function ServicePicker({ tabs, initial }: { tabs: PickerTab[]; initial?: string }) {
  // ?do= from the URL (read on the client only; the page itself stays static)
  const urlTab = useSyncExternalStore(
    (cb) => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); },
    () => new URLSearchParams(window.location.search).get('do'),
    () => null,
  );
  const [picked, setActive] = useState<string | null>(null);
  const valid = (k: string | null | undefined) => (k && tabs.some((t) => t.key === k) ? k : null);
  const active = valid(picked) ?? valid(urlTab) ?? valid(initial) ?? tabs[0].key;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (k: string, focus = false) => {
    setActive(k);
    const u = new URL(window.location.href); u.searchParams.set('do', k); window.history.replaceState(null, '', u.toString());
    if (focus) refs.current[tabs.findIndex((t) => t.key === k)]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return; e.preventDefault();
    pick(tabs[(i + d + tabs.length) % tabs.length].key, true);
  };
  const p = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <section aria-labelledby="picker-h" className="rounded-[22px] bg-ink text-white p-5 sm:p-7" data-testid="service-picker">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="picker-h" className="!text-white !text-[22px] sm:!text-[26px] font-extrabold">What do you want to do?</h2>
        <p className="text-on-ink text-[14px]">Pick one. You can use every service from the same account.</p>
      </div>
      <div className="mt-4 flex lg:grid lg:grid-cols-5 gap-2 overflow-x-auto snap-x -mx-1 px-1 pb-1" role="group" aria-label="Services">
        {tabs.map((t, i) => {
          const on = t.key === active;
          return (
            <button key={t.key} ref={(el) => { refs.current[i] = el; }} type="button" aria-pressed={on} onClick={() => pick(t.key)} onKeyDown={(e) => onKey(e, i)}
              data-testid={`picker-tab-${t.key}`}
              className={`shrink-0 w-[150px] lg:w-auto min-h-14 px-4 rounded-[12px] text-[15px] font-semibold snap-start border ${on ? 'bg-white text-ink border-white' : 'bg-white/[.06] text-white border-white/15 hover:bg-white/10'}`}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2" aria-live="polite">
        <div>
          <div className="label-caps text-on-ink-link">{p.service}</div>
          <p className="mt-1.5 text-white text-[19px] font-bold leading-snug">{p.promise}</p>
          <ol className="mt-4 space-y-2.5">
            {p.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[15px] text-on-ink">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-coral text-white text-[13px] font-bold shrink-0">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-3">
          {p.key === 'source' && (
            <form action="/request/sourcing" className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr_1.1fr]" id="picker-source">
              <div><label htmlFor="pk-title" className="label !text-white">Product</label><input id="pk-title" name="title" className="input" placeholder="e.g. handheld fan" /></div>
              <div><label htmlFor="pk-qty" className="label !text-white">Quantity</label><input id="pk-qty" name="qty" inputMode="numeric" className="input" placeholder="500" /></div>
              <div><label htmlFor="pk-country" className="label !text-white">Destination country</label>
                <select id="pk-country" name="country" className="input">{COUNTRIES.map(([c, n]) => <option key={n} value={c}>{n}</option>)}</select></div>
            </form>
          )}
          <div className="mt-auto flex items-center gap-2 rounded-[10px] bg-white/[.08] px-3.5 py-3 text-[13.5px] font-semibold text-on-ink-muted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-on-ink-link shrink-0" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{p.fact}
          </div>
          {p.key === 'source'
            ? <button type="submit" form="picker-source" className="btn btn-primary w-full min-h-[54px] text-[16px]">{p.cta}</button>
            : <a href={p.href} className="btn btn-primary w-full min-h-[54px] text-[16px]" data-testid="picker-cta">{p.cta}</a>}
        </div>
      </div>
    </section>
  );
}

