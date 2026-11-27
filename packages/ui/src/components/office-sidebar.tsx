'use client';

import Link from 'next/link';
import { useId, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useHotkey, useStoredState } from '../hooks';
import { useOverflowing } from './use-overflowing';
import { CountBadge, Kbd } from './button';
import { Tooltip } from './tooltip';

export type OfficeSidebarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  count?: number;
  /** The role can't open it: not rendered (and the palette drops it too). */
  hidden?: boolean;
};
export type OfficeSidebarGroup = { id: string; label: string; items: OfficeSidebarItem[]; defaultOpen?: boolean };

export type OfficeSidebarProps = {
  /** Top items: Dashboard, My work (count). */
  items: OfficeSidebarItem[];
  /** Sales, Services, Accounts, Catalogue, Website, Admin. */
  groups: OfficeSidebarGroup[];
  current?: string;
  /** Controlled collapsed state; default is remembered in localStorage. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  storageKey?: string;
  /** Bind Ctrl B (default true; only one sidebar per page should bind it). */
  hotkey?: boolean;
  label?: string;
  testId?: string;
  className?: string;
};

/**
 * OfficeSidebar (Back Office, compact): 232 px navy, 56 px icons when collapsed. Dashboard and My work, then groups
 * Sales · Services · Accounts · Catalogue · Website · Admin. Group headers are buttons (aria-expanded/aria-controls);
 * open groups and the collapsed state are remembered (localStorage). Current page = 3 px teal bar, bold,
 * aria-current="page". "« Collapse sidebar Ctrl B" (Ctrl B toggles; aria-keyshortcuts). Collapsed: every item is an
 * icon with aria-label and a tooltip; counts become a dot badge. Items with `hidden` are not rendered; empty groups disappear.
 * Phones: not used (Back Office phone frame uses BottomNav).
 */
export function OfficeSidebar({ items, groups, current, collapsed: collapsedProp, onCollapsedChange, storageKey = 'ods:office-sidebar', hotkey = true, label = 'Back Office', testId, className }: OfficeSidebarProps) {
  const id = useId();
  const [storedCollapsed, setStoredCollapsed] = useStoredState<boolean>(`${storageKey}:collapsed`, false);
  const [openGroups, setOpenGroups] = useStoredState<Record<string, boolean>>(`${storageKey}:groups`, {});
  const collapsed = collapsedProp ?? storedCollapsed;
  const [listRef, listOver] = useOverflowing<HTMLDivElement>();
  const toggle = () => {
    setStoredCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  useHotkey('Ctrl+B', toggle, { enabled: hotkey });

  const tip = (name: string, el: ReactElement): ReactNode =>
    collapsed ? (
      <Tooltip content={name} side="end">
        {el}
      </Tooltip>
    ) : (
      el
    );

  const renderItem = (it: OfficeSidebarItem) => {
    const isCurrent = it.id === current;
    return (
      <li key={it.id}>
        {tip(
          it.label,
          <Link
            href={it.href}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={collapsed ? `${it.label}${it.count ? `, ${it.count} waiting` : ''}` : undefined}
            className={cx(
              'relative flex items-center gap-2.5 rounded-ods-control text-ods-table',
              collapsed ? 'size-ods-control justify-center' : 'min-h-ods-control w-full px-3',
              isCurrent ? 'border-s-[3px] border-ods-teal bg-ods-navy-hover font-bold text-white' : 'text-white/90 hover:bg-ods-navy-hover',
              isCurrent && !collapsed && 'ps-[9px]',
            )}
          >
            <Icon icon={it.icon} />
            {collapsed ? (
              it.count ? <span aria-hidden className="absolute top-1 end-1 size-2 rounded-ods-pill bg-ods-danger ring-2 ring-ods-navy" /> : null
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.count ? <CountBadge count={it.count} label="waiting" /> : null}
              </>
            )}
          </Link>,
        )}
      </li>
    );
  };

  const visibleTop = items.filter((i) => !i.hidden);
  const visibleGroups = groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) })).filter((g) => g.items.length);

  return (
    <nav
      aria-label={label}
      data-testid={testId}
      data-collapsed={collapsed}
      className={cx('flex h-full shrink-0 flex-col bg-ods-navy text-white transition-[width] duration-(--ods-motion) ease-ods motion-reduce:transition-none', collapsed ? 'w-[56px]' : 'w-[232px]', className)}
    >
      <div ref={listRef} className={cx('min-h-0 flex-1 py-2', collapsed ? 'px-1.5' : 'px-2', (!collapsed || listOver) && 'overflow-y-auto')}>
        <ul className={cx('grid gap-0.5', collapsed && 'justify-center')}>{visibleTop.map(renderItem)}</ul>
        {visibleGroups.map((g) => {
          const open = collapsed || (openGroups[g.id] ?? g.defaultOpen ?? true);
          const listId = `${id}-${g.id}`;
          return (
            <div key={g.id} className={cx('mt-2', collapsed && 'border-t border-white/15 pt-2')}>
              {collapsed ? (
                <span id={`${listId}-h`} className="sr-only">
                  {g.label}
                </span>
              ) : (
                <button
                  type="button"
                  id={`${listId}-h`}
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => setOpenGroups({ ...openGroups, [g.id]: !open })}
                  className="flex h-[calc(var(--ods-control-h)-4px)] w-full items-center gap-2 rounded-ods-control px-3 text-[11px] font-semibold tracking-wide text-white/75 uppercase hover:bg-white/5 hover:text-white"
                >
                  <span className="flex-1 text-start">{g.label}</span>
                  <Icon icon={ChevronDown} size="xs" className={cx('transition-transform duration-(--ods-motion-fast)', !open && '-rotate-90 rtl:rotate-90')} />
                </button>
              )}
              <ul id={listId} aria-labelledby={`${listId}-h`} hidden={!open} className={cx('grid gap-0.5', collapsed && 'justify-center')}>
                {g.items.map(renderItem)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className={cx('border-t border-white/15 py-2', collapsed ? 'flex justify-center px-1.5' : 'px-2')}>
        {tip(
          'Expand sidebar (Ctrl B)',
          <button
            type="button"
            onClick={toggle}
            aria-keyshortcuts="Control+B"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : undefined}
            className={cx('flex items-center gap-2 rounded-ods-control text-ods-label text-white/85 hover:bg-white/10', collapsed ? 'size-ods-control justify-center' : 'min-h-ods-control w-full px-3')}
          >
            <Icon icon={collapsed ? ChevronsRight : ChevronsLeft} className="rtl:-scale-x-100" />
            {collapsed ? null : (
              <>
                <span className="flex-1 text-start">Collapse sidebar</span>
                <span aria-hidden className="flex gap-1 text-white/75">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>B</Kbd>
                </span>
              </>
            )}
          </button>,
        )}
      </div>
    </nav>
  );
}
