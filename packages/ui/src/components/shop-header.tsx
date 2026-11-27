'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUpRight, Bell, Search, ShoppingCart } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { useDebounced } from '../hooks';
import { flattenSuggestions, moveActive, parseSuggestResponse, SUGGEST_MIN_CHARS, type SuggestGroup } from '../suggest';
import { IconButton } from './button';
import { NamedTabLink } from './named-tab-link';

export type { SuggestGroup, SuggestItem } from '../suggest';

export type ShopHeaderProps = {
  cartCount?: number;
  /** Visible cart label, default "Cart". */
  cartLabel?: string;
  notificationsCount?: number;
  /** Notifications as a link (opens My account in its named tab). Takes precedence over `onNotifications`. */
  notificationsHref?: string;
  onNotifications?: () => void;
  /** Search submit. Without it, the form does a GET to `searchAction` with `q`. */
  onSearch?: (query: string) => void;
  searchAction?: string;
  defaultQuery?: string;
  /**
   * Suggestions endpoint (GET `?q=&limit=`, JSON `{ groups: SuggestGroup[] }`). When set, the search box is a combobox
   * with suggestions after 2 characters (debounced 200 ms).
   */
  suggestUrl?: string;
  cartHref?: string;
  /** Opens the mini-cart drawer instead of following the link (desktop). */
  onCartClick?: () => void;
  accountHref?: string;
  /** Sticky at the top (default). Set false to render in place (demos). */
  sticky?: boolean;
  /** data-testid of the <header> (default "shop-header"); the form is "shop-search", the listbox "suggestions". */
  testId?: string;
  className?: string;
};

const PLACEHOLDER = 'Search all products, MOQ pools and turnkey projects';

/**
 * ShopHeader (Shop, tab 2): 68 px navy (56 compact). White logo mark (→ /shop); ONE search form ("Search all products,
 * MOQ pools and turnkey projects", labelled, role="search"); Cart with count; notifications with count; "My account ↗"
 * (NamedTabLink → `target="octopus-account"`, same tab on phones).
 * Search suggestions (`suggestUrl`): WAI-ARIA combobox — input role="combobox" aria-expanded / aria-controls /
 * aria-activedescendant / aria-autocomplete="list"; a listbox with one group per type (products, pools, projects,
 * categories). ↓/↑ move through the options (wrapping back to the text box), Enter opens the active option (or submits
 * the search when none is active), Esc closes the list (a second Esc clears the text). The number of suggestions is read
 * out politely. Options are not focusable (focus stays in the text box).
 * Phones (container < 768 px): logo, cart icon (count) and bell in the top row; the same search form wraps to a full-width
 * row below; My account moves to the BottomNav.
 */
export function ShopHeader({
  cartCount = 0,
  cartLabel = 'Cart',
  notificationsCount,
  notificationsHref,
  onNotifications,
  onSearch,
  searchAction = '/shop/search',
  defaultQuery,
  suggestUrl,
  cartHref = '/shop/cart',
  onCartClick,
  accountHref = '/account',
  sticky = true,
  testId = 'shop-header',
  className,
}: ShopHeaderProps) {
  const id = useId();
  const cartSr = `(${cartCount} ${cartCount === 1 ? 'item' : 'items'})`;
  const unread = notificationsCount ?? 0;
  return (
    <header data-testid={testId} className={cx(sticky ? 'sticky top-0 z-(--z-sticky)' : 'relative', '@container bg-ods-navy text-white', className)}>
      <div className="mx-auto flex max-w-ods-content flex-wrap items-center gap-x-3 px-ods-pad-page py-3 @min-[768px]:min-h-[calc(var(--ods-control-h)+24px)] @min-[768px]:flex-nowrap @min-[768px]:gap-x-5 @min-[768px]:py-0">
        <Logo variant="mark-white" area="shop" />
        <SearchBox
          id={id}
          action={searchAction}
          defaultQuery={defaultQuery}
          onSearch={onSearch}
          suggestUrl={suggestUrl}
          className="order-last mt-3 w-full basis-full @min-[768px]:order-none @min-[768px]:mt-0 @min-[768px]:max-w-[640px] @min-[768px]:flex-1 @min-[768px]:basis-auto"
        />
        <div className="ms-auto flex items-center gap-1 @min-[768px]:gap-2">
          <Link
            href={cartHref}
            data-testid="shop-cart"
            onClick={
              onCartClick
                ? (e) => {
                    e.preventDefault();
                    onCartClick();
                  }
                : undefined
            }
            className="relative inline-flex h-ods-control min-w-ods-control items-center justify-center gap-2 rounded-ods-control px-2 font-semibold text-white hover:bg-white/10"
          >
            <Icon icon={ShoppingCart} />
            <span className="sr-only @min-[768px]:not-sr-only">{cartLabel}</span>
            {cartCount ? <span className="sr-only">{cartSr}</span> : null}
            {cartCount ? (
              <span aria-hidden className="inline-flex min-w-5 items-center justify-center rounded-ods-pill bg-ods-teal px-1.5 text-[11px] leading-5 font-bold text-ods-navy tabular-nums @max-[767px]:absolute @max-[767px]:-top-1 @max-[767px]:-end-1">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            ) : null}
          </Link>
          {notificationsHref ? (
            <NamedTabLink
              href={notificationsHref}
              tab="account"
              data-testid="shop-notifications"
              className="relative inline-flex size-ods-control items-center justify-center rounded-ods-control text-white hover:bg-white/10"
            >
              <Icon icon={Bell} />
              <span className="sr-only">
                Notifications{unread ? ` (${unread} unread)` : ''} (opens the My account tab)
              </span>
              {unread ? (
                <span aria-hidden className="absolute top-1 end-1 inline-flex min-w-[18px] items-center justify-center rounded-ods-pill bg-ods-danger px-1 text-[10px] leading-[18px] font-semibold text-white tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </NamedTabLink>
          ) : (
            <IconButton icon={Bell} label="Notifications" count={notificationsCount} variant="on-navy" onClick={onNotifications} />
          )}
          <NamedTabLink
            href={accountHref}
            tab="account"
            data-testid="shop-account-link"
            className="hidden h-ods-control items-center gap-1 rounded-ods-control border border-white/40 px-3 font-semibold whitespace-nowrap text-white hover:bg-white/10 @min-[768px]:inline-flex"
          >
            My account
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            <span className="sr-only">(opens the My account tab)</span>
          </NamedTabLink>
        </div>
      </div>
    </header>
  );
}

function SearchBox({
  id,
  action,
  defaultQuery,
  onSearch,
  suggestUrl,
  className,
}: {
  id: string;
  action: string;
  defaultQuery?: string;
  onSearch?: (q: string) => void;
  suggestUrl?: string;
  className?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery ?? '');
  const [open, setOpen] = useState(false);
  // results and the active option are keyed by the query they belong to, so a new query never shows stale state
  const [result, setResult] = useState<{ q: string; groups: SuggestGroup[] }>({ q: '', groups: [] });
  const [activeState, setActiveState] = useState<{ q: string; i: number }>({ q: '', i: -1 });
  const term = useDebounced(q.trim(), 200);
  const enabled = Boolean(suggestUrl) && term.length >= SUGGEST_MIN_CHARS;

  useEffect(() => {
    if (!suggestUrl || term.length < SUGGEST_MIN_CHARS) return;
    const ac = new AbortController();
    fetch(`${suggestUrl}?q=${encodeURIComponent(term)}&limit=5`, { signal: ac.signal, headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((body) => setResult({ q: term, groups: parseSuggestResponse(body) }))
      .catch(() => {
        if (!ac.signal.aborted) setResult({ q: term, groups: [] });
      });
    return () => ac.abort();
  }, [term, suggestUrl]);

  const ready = enabled && result.q === term;
  const groups = ready ? result.groups : [];
  const items = flattenSuggestions(groups);
  const active = activeState.q === term ? Math.min(activeState.i, items.length - 1) : -1;
  const expanded = open && items.length > 0;
  const listId = `${id}-suggestions`;
  const optId = (i: number) => `${id}-opt-${i}`;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (expanded && active >= 0) {
      e.preventDefault();
      go(items[active].href);
      return;
    }
    setOpen(false);
    if (!onSearch) return;
    e.preventDefault();
    onSearch(q.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestUrl) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveState({ q: term, i: moveActive(active, e.key === 'ArrowDown' ? 1 : -1, items.length) });
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        setOpen(false);
      } else if (q) {
        e.preventDefault();
        setQ('');
      }
    }
  };

  const status = !enabled || !open || !ready ? '' : items.length ? `${items.length} suggestion${items.length === 1 ? '' : 's'}. Use the up and down arrows to choose.` : 'No suggestions. Press Enter to search.';
  // option index across groups (display order = flattenSuggestions order)
  const starts = groups.reduce<number[]>((acc, g, i) => [...acc, i === 0 ? 0 : acc[i - 1] + groups[i - 1].items.length], []);

  return (
    <form role="search" action={action} onSubmit={submit} className={className} data-testid="shop-search">
      <label htmlFor={`${id}-q`} className="sr-only">
        {PLACEHOLDER}
      </label>
      <div className="relative">
        <Icon icon={Search} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ods-slate" />
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={PLACEHOLDER}
          autoComplete="off"
          enterKeyHint="search"
          {...(suggestUrl
            ? {
                role: 'combobox',
                'aria-autocomplete': 'list' as const,
                'aria-expanded': expanded,
                'aria-controls': expanded ? listId : undefined,
                'aria-activedescendant': expanded && active >= 0 ? optId(active) : undefined,
              }
            : {})}
          className="h-ods-control w-full rounded-ods-control border border-transparent bg-ods-surface ps-10 pe-3 text-ods-body text-ods-text placeholder:text-ods-slate"
        />
        {expanded ? (
          <div
            id={listId}
            role="listbox"
            aria-label="Search suggestions"
            data-testid="suggestions"
            className="absolute inset-x-0 top-full z-(--z-dropdown) mt-1 max-h-[min(70vh,480px)] overflow-y-auto rounded-ods-card border border-ods-line bg-ods-surface py-2 text-ods-text shadow-ods-pop"
          >
            {groups.map((g, gi) => (
              <div key={g.id} role="group" aria-labelledby={`${id}-g-${g.id}`} className="py-1">
                <div id={`${id}-g-${g.id}`} role="presentation" className="px-3 pb-1 text-ods-small font-semibold text-ods-slate">
                  {g.label}
                </div>
                {g.items.map((it, ii) => {
                  const i = starts[gi] + ii;
                  const on = i === active;
                  return (
                    <div
                      key={`${g.id}-${it.id}`}
                      id={optId(i)}
                      role="option"
                      aria-selected={on}
                      data-testid="suggestion"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => {
                        if (!on) setActiveState({ q: term, i });
                      }}
                      onClick={() => go(it.href)}
                      className={cx('flex min-h-ods-control cursor-pointer flex-col justify-center px-3 py-1.5', on ? 'bg-ods-blue-tint text-ods-navy' : 'hover:bg-ods-canvas')}
                    >
                      <span className="text-ods-table font-semibold">{it.label}</span>
                      {it.meta ? <span className="text-ods-small text-ods-slate">{it.meta}</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
        {open && ready && !items.length ? (
          <p className="absolute inset-x-0 top-full z-(--z-dropdown) mt-1 rounded-ods-card border border-ods-line bg-ods-surface px-3 py-2 text-ods-small text-ods-slate shadow-ods-pop">
            No suggestions for “{term}”. Press Enter to search everything.
          </p>
        ) : null}
        <span role="status" aria-live="polite" className="sr-only">
          {status}
        </span>
      </div>
    </form>
  );
}
