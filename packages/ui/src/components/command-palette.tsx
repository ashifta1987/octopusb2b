'use client';

import { useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { CornerDownLeft, LoaderCircle, Search, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useEscape, useFocusTrap, useHotkey, useLockBodyScroll, useControllable } from '../hooks';
import { Kbd } from './button';

export type CommandPaletteGroup = 'records' | 'actions' | 'goto';

export type CommandPaletteItem = {
  id: string;
  group: CommandPaletteGroup;
  label: string;
  /** Second line, e.g. "Customer · Dubai" or "Invoice · US$ 2,870.00 · Overdue". */
  description?: string;
  icon?: LucideIcon;
  /** Key sequence hint, e.g. ['G', 'I'] for Go to › Invoices. */
  shortcut?: string[];
  keywords?: string[];
  /** Hidden unless `can(permission)` is true (Part 7.1: items the role can't open are removed from the palette). */
  permission?: string;
  href?: string;
};

export type CommandPaletteSelectOptions = { newTab: boolean };

export type CommandPaletteProps = {
  items: CommandPaletteItem[];
  /** Called on Enter / click (`newTab: false`) and Ctrl/⌘ + Enter (`newTab: true`). The palette closes first. */
  onSelect: (item: CommandPaletteItem, opts: CommandPaletteSelectOptions) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Ids of recently opened items, newest first; shown first as "Recent" while the search is empty. */
  recent?: string[];
  /** Permission check; items with a `permission` the user lacks are hidden. */
  can?: (permission: string) => boolean;
  /** Server search: set `loading` while results load; the query is passed to `onSearchChange`. */
  loading?: boolean;
  onSearchChange?: (query: string) => void;
  /**
   * Keyboard trigger. Staff: Ctrl K (also ⌘K on a Mac — "Ctrl" matches both). Later, customers: pass `hotkey="/"` so
   * "/" opens search (Part 2.5). `null` turns the global shortcut off (e.g. a second copy on the same page).
   */
  hotkey?: string | string[] | null;
  placeholder?: string;
};

/** The input is always focused while open; its ring is replaced by the amber bar under the search row (focus-within). */
const NO_OUTLINE = { outline: 'none' } as const;
const GROUP_LABEL: Record<CommandPaletteGroup, string> = { records: 'Records', actions: 'Actions', goto: 'Go to' };

/**
 * CommandPalette (Part 7.1, cmdk 1.1): Ctrl/⌘ K opens it anywhere; also controlled with `open` / `onOpenChange`.
 * A modal dialog (aria-label "Command palette", aria-modal, focus trapped, focus starts in the search box, Esc closes and
 * focus returns to the trigger, page scroll locked, z palette). Groups: Recent (search empty), Records, Actions, Go to,
 * each item with an optional key hint (G I). The cmdk list is a combobox + listbox (↑ ↓ move, Enter opens,
 * Ctrl/⌘ Enter opens in a new tab). "No results for …" when nothing matches; a spinner + "Searching…" while `loading`.
 * Phones (< 768): full screen, the footer hints are hidden (no keyboard).
 */
export function CommandPalette({
  items,
  onSelect,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  recent = [],
  can,
  loading,
  onSearchChange,
  hotkey = 'Ctrl+K',
  placeholder = 'Search customers, RFQs, orders, invoices… or type a command',
}: CommandPaletteProps) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange);
  const [search, setSearch] = useState('');
  const [value, setValue] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useHotkey(hotkey ?? 'Ctrl+K', () => setOpen(!open), { enabled: hotkey !== null });
  useFocusTrap(dialogRef, open, { initialFocus: inputRef });
  useEscape(open, () => close());
  useLockBodyScroll(open);

  const allowed = useMemo(() => items.filter((i) => !i.permission || (can ? can(i.permission) : false)), [items, can]);
  const byId = useMemo(() => new Map(allowed.map((i) => [i.id, i])), [allowed]);
  const recentItems = search ? [] : recent.map((id) => byId.get(id)).filter((i): i is CommandPaletteItem => !!i);
  const recentIds = new Set(recentItems.map((i) => i.id));
  const groups = (['records', 'actions', 'goto'] as const).map((g) => ({ g, items: allowed.filter((i) => i.group === g && !recentIds.has(i.id)) }));

  function close() {
    setOpen(false);
    setSearch('');
    onSearchChange?.('');
  }
  function choose(item: CommandPaletteItem, newTab: boolean) {
    close();
    onSelect(item, { newTab });
  }

  if (!open) return null;

  const renderItem = (item: CommandPaletteItem, scope: string) => (
    <Command.Item
      key={`${scope}:${item.id}`}
      value={`${scope}:${item.id}`}
      keywords={[item.label, item.description ?? '', ...(item.keywords ?? [])]}
      onSelect={() => choose(item, false)}
      className="flex min-h-ods-control cursor-pointer items-center gap-3 rounded-ods-control px-3 py-1.5 text-ods-text data-[selected=true]:bg-ods-blue-tint"
    >
      {item.icon ? <Icon icon={item.icon} className="text-ods-slate" /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.label}</span>
        {item.description ? <span className="truncate text-ods-small text-ods-slate">{item.description}</span> : null}
      </span>
      {item.shortcut?.length ? (
        <span className="flex shrink-0 gap-1 text-ods-slate" aria-label={`Shortcut ${item.shortcut.join(' then ')}`}>
          {item.shortcut.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </span>
      ) : null}
    </Command.Item>
  );

  const headingClass =
    '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ods-small [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ods-slate';

  return (
    <div className="fixed inset-0 z-(--z-palette) flex items-start justify-center ods-tablet:px-4 ods-tablet:pt-[12vh]">
      <div aria-hidden className="absolute inset-0 bg-ods-navy-dark/50" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="relative flex h-full w-full flex-col overflow-hidden bg-ods-surface shadow-ods-dialog ods-tablet:h-auto ods-tablet:max-h-[70vh] ods-tablet:max-w-[640px] ods-tablet:rounded-ods-card"
      >
        <Command
          label="Command palette"
          value={value}
          onValueChange={setValue}
          loop
          vimBindings={false}
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              const id = value.slice(value.indexOf(':') + 1);
              const item = byId.get(id);
              if (item) {
                e.preventDefault();
                e.stopPropagation();
                choose(item, true);
              }
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-ods-line px-3 focus-within:shadow-[inset_0_-2px_0_var(--ods-focus)]">
            <Icon icon={Search} className="text-ods-slate" />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={(q) => {
                setSearch(q);
                onSearchChange?.(q);
              }}
              placeholder={placeholder}
              aria-label="Search records, actions and pages"
              className="h-[calc(var(--ods-control-h)+12px)] min-w-0 flex-1 bg-transparent text-ods-body text-ods-text placeholder:text-ods-slate"
              style={NO_OUTLINE}
            />
            <button type="button" onClick={close} className="rounded-ods-control px-2 py-1 text-ods-small font-semibold text-ods-slate hover:bg-ods-canvas">
              Esc<span className="sr-only"> — close the command palette</span>
            </button>
          </div>
          <Command.List label="Results" className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain p-2', headingClass)}>
            {loading ? (
              <Command.Loading label="Searching">
                <div className="flex items-center gap-2 px-3 py-2 text-ods-small text-ods-slate">
                  <Icon icon={LoaderCircle} className="animate-spin" /> Searching records…
                </div>
              </Command.Loading>
            ) : null}
            <Command.Empty className="px-3 py-8 text-center text-ods-slate">
              No results for “{search}”. Try a customer name, an invoice or order number, or a page name.
            </Command.Empty>
            {recentItems.length ? <Command.Group heading="Recent">{recentItems.map((i) => renderItem(i, 'recent'))}</Command.Group> : null}
            {groups.map(({ g, items: gi }) =>
              gi.length ? (
                <Command.Group key={g} heading={GROUP_LABEL[g]}>
                  {gi.map((i) => renderItem(i, g))}
                </Command.Group>
              ) : null,
            )}
          </Command.List>
          <div aria-hidden className="hidden items-center gap-4 border-t border-ods-line px-3 py-2 text-ods-small text-ods-slate ods-tablet:flex">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <Icon icon={CornerDownLeft} size="xs" />
              </Kbd>{' '}
              open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd> open in new tab
            </span>
            <span className="ms-auto flex items-center gap-1">
              <Kbd>Esc</Kbd> close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
