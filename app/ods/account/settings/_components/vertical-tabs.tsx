'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { rovingKeyDown } from '@octopus/ui/hooks';
import { Select, cx } from '@octopus/ui';

export type VerticalTabItem = { id: string; label: string; panel: ReactNode; badge?: ReactNode };

/**
 * Vertical tabs for Settings (Part 6.7 "vertical tabs"; C_Team). From 768 px: a vertical tablist on the inline start
 * (selected = navy bold + 3 px teal bar, like the AccountSidebar), ArrowUp / ArrowDown / Home / End move and select.
 * Phones: a labelled select chooses the section (2.5 "on phones a select"). `?tab=` stays in the URL (replaceState, so the
 * route stays prerenderable; read on mount and on Back / Forward). Panels are lazy and kept mounted once opened.
 */
export function VerticalTabs({ items, value, param = 'tab', label, testId }: { items: VerticalTabItem[]; value: string; param?: string | null; label: string; testId?: string }) {
  const uid = useId();
  const [current, setCurrent] = useState(items.some((i) => i.id === value) ? value : items[0].id);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([current]));
  if (!visited.has(current)) setVisited(new Set(visited).add(current));
  const select = (id: string) => {
    setCurrent(id);
    if (param) {
      const u = new URL(window.location.href);
      u.searchParams.set(param, id);
      window.history.replaceState(null, '', u.toString());
    }
  };
  useEffect(() => {
    if (!param) return;
    const sync = () => { const v = new URLSearchParams(window.location.search).get(param); if (v && items.some((i) => i.id === v)) setCurrent(v); };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
    // items are static per render; reading the URL on mount is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);
  return (
    <div className="grid grid-cols-1 gap-6 ods-tablet:grid-cols-[220px_minmax(0,1fr)]">
      <div className="ods-tablet:hidden">
        <label htmlFor={`${uid}-sel`} className="mb-1 block text-ods-label font-semibold text-ods-navy">Section</label>
        <Select id={`${uid}-sel`} value={current} onChange={(e) => select(e.target.value)} data-testid="settings-select">
          {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select>
      </div>
      <div role="tablist" aria-label={label} aria-orientation="vertical" data-testid={testId}
        onKeyDown={(e) => rovingKeyDown(e, { orientation: 'vertical', onMove: (el) => el.dataset.tabId && select(el.dataset.tabId) })}
        className="hidden flex-col gap-1 self-start rounded-ods-card bg-ods-surface p-2 shadow-ods-card ods-tablet:flex">
        {items.map((i) => {
          const on = i.id === current;
          return (
            <button key={i.id} type="button" role="tab" id={`${uid}-t-${i.id}`} aria-selected={on} aria-controls={`${uid}-p-${i.id}`} tabIndex={on ? 0 : -1}
              data-roving="" data-tab-id={i.id} data-testid={`settings-tab-${i.id}`} onClick={() => select(i.id)}
              className={cx('relative flex min-h-ods-control items-center justify-between gap-2 rounded-ods-control ps-4 pe-3 text-start text-ods-body',
                on ? 'bg-ods-blue-tint font-semibold text-ods-navy before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-ods-teal' : 'text-ods-text hover:bg-ods-canvas')}>
              <span>{i.label}</span>{i.badge}
            </button>
          );
        })}
      </div>
      <div className="min-w-0">
        {items.map((i) => (
          <div key={i.id} role="tabpanel" id={`${uid}-p-${i.id}`} aria-labelledby={`${uid}-t-${i.id}`} hidden={i.id !== current} tabIndex={0}
            data-testid="settings-panel" data-tab={i.id} className="outline-none focus-visible:ring-2 focus-visible:ring-ods-focus rounded-ods-card">
            {visited.has(i.id) ? i.panel : null}
          </div>
        ))}
      </div>
    </div>
  );
}
