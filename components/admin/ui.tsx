import Link from 'next/link';
import { cn } from '@/lib/cn';

/** Link-based tabs (server-rendered; state lives in the URL). */
export function Tabs({ tabs, active, base, param = 'tab' }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string; param?: string }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-2 mb-6">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?${param}=${t.key}`}
          aria-current={active === t.key ? 'page' : undefined}
          className={cn('rounded-full border px-4 py-2 text-sm font-semibold', active === t.key ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line-strong hover:border-ink')}
        >
          {t.label}{t.count != null && <span className="ml-1.5 mono text-xs opacity-85">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Horizontal share bar with an accessible text value. */
export function Bar({ label, value, max, display, tone = 'blue' }: { label: React.ReactNode; value: number; max: number; display: React.ReactNode; tone?: 'blue' | 'navy' }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="py-2">
      <div className="flex justify-between gap-3 text-[15px]"><span className="font-semibold">{label}</span><span className="mono text-sm">{display}</span></div>
      <div className="mt-1.5 h-2 rounded-full bg-line" aria-hidden>
        <div className={cn('h-2 rounded-full', tone === 'navy' ? 'bg-ink' : 'bg-coral')} style={{ width: `${value > 0 ? pct : 0}%` }} />
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, children, hint, className }: { label: string; htmlFor: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function CountryTag({ code }: { code: string | null | undefined }) {
  if (!code) return null;
  return <span className="mono text-[10px] font-semibold bg-pearl border border-line rounded px-1 py-px text-ink">{code}</span>;
}

export function Loading() {
  return <div className="card p-10 text-center text-muted" role="status">Loading…</div>;
}
