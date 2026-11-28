'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, Bell, Bot, Box, Briefcase, Building2, CheckSquare, CirclePause, ClipboardCheck, Coins, CreditCard, Database, Factory, FilePen,
  FileText, Globe, Hash, Home, Hourglass, IdCard, Inbox, Landmark, Layers, LayoutDashboard, LifeBuoy, Map as MapIcon, Megaphone, Monitor, Package,
  Plug, Search, Send, Settings, Shield, ShoppingCart, Sparkles, Split, Tags, Truck, Upload, UserRound, Users, UsersRound, Wallet, type LucideIcon,
} from 'lucide-react';
import {
  AuthBroadcastListener,
  BottomNav,
  CommandPalette,
  Icon,
  Modal,
  ODS_SHORTCUTS,
  OfficeSidebar,
  OfficeTopbar,
  ShortcutsList,
  Workspace,
  broadcastAuth,
  type BottomNavItem,
  type CommandPaletteItem,
  type OfficeSidebarGroup,
  type OfficeSidebarItem,
  type ShortcutItem,
  type WorkspaceHandle,
  type WorkspaceTab,
} from '@octopus/ui';
import { staffSignOut } from '@/lib/staff/actions';
import { setDivisionScope } from '@/app/admin/division-scope-actions';
import {
  appsFor,
  buildOfficeNav,
  currentAppId,
  currentSidebarId,
  dashboardHref,
  gotoItems,
  isDesktopEditingPath,
  isOfficeHref,
  navLabelFor,
  newItemsFor,
  phoneNavCurrent,
  PHONE_APPROVALS_HREF,
  currentNavId,
  ALL_NAV,
  EXTRA_GOTO,
  type IconKey,
  type ResolvedNavItem,
} from '../_lib/nav';
import { sectionFor, sectionItems, SECTION_LABEL } from '../_lib/section-nav';
import {
  dashboardTab,
  localOnlyPersistence,
  newTabId,
  parseRecent,
  prepareWorkspace,
  pushRecent,
  recentStorageKey,
  samePath,
  sidebarStorageKey,
  workspaceStorageKey,
  type OfficePersistence,
  type RecentEntry,
} from '../_lib/persistence';
import type { PaletteRecord } from '../_lib/search-core';
import { createServerPersistence } from '../_lib/persistence-server';
import type { StaffNotification } from '@/lib/office/workspace-core';
import { NotificationsDrawer } from './notifications-drawer';
import type { OfficeFrameData } from '../_lib/frame-data';
import { OfficePermsContext, OfficeWorkspaceContext, type OfficeWorkspaceApi } from './office-context';

export const OFFICE_ICONS: Record<IconKey, LucideIcon> = {
  dashboard: LayoutDashboard, inbox: Inbox, check: CheckSquare, users: Users, id: IdCard, file: FileText, quote: FilePen, cart: ShoppingCart,
  briefcase: Briefcase, help: LifeBuoy, bot: Bot, pools: UsersRound, layers: Layers, clipboard: ClipboardCheck, sparkle: Sparkles, truck: Truck,
  package: Package, send: Send, chart: BarChart3, pause: CirclePause, wallet: Wallet, credit: CreditCard, bank: Landmark, ageing: Hourglass,
  report: BarChart3, card: CreditCard, box: Box, upload: Upload, tags: Tags, hash: Hash, factory: Factory, globe: Globe, megaphone: Megaphone,
  shield: Shield, settings: Settings, coins: Coins, map: MapIcon, building: Building2, split: Split, plug: Plug, database: Database, bell: Bell,
  user: UserRound,
};

const NAV_DEFS = [...ALL_NAV, ...EXTRA_GOTO];
const iconKeyFor = (path: string): IconKey | undefined => NAV_DEFS.find((d) => d.id === currentNavId(path))?.icon;

/** "Orders · Back office · Octopus B2B" → "Orders". */
const cleanTitle = (t: string) => t.split(' · ')[0]?.trim() ?? '';

export type OfficeFrameSearch = (q: string) => Promise<{ items: PaletteRecord[]; error?: string }>;

export type OfficeFrameProps = {
  data: OfficeFrameData;
  /** Record search for the palette (the server action; fixtures pass a sample filter). */
  search: OfficeFrameSearch;
  /** Where tabs / prefs go besides localStorage (T8-DATA server actions when available). */
  persistence?: OfficePersistence;
  /** Server-rendered notice above the frame (today's MaintenanceNotice). */
  notice?: ReactNode;
  children: ReactNode;
  /** Staging fixtures only: fixed path, no navigation, sample tabs and states. */
  fixture?: {
    pathname: string;
    tabs?: WorkspaceTab[];
    activeId?: string;
    dirtyTabId?: string;
    collapsed?: boolean;
    paletteOpen?: boolean;
    shortcutsOpen?: boolean;
    notificationsOpen?: boolean;
    notifications?: StaffNotification[];
    storageKey: string;
  };
};

/**
 * ODS T8 · Back Office frame (Part 7.1, compact): OfficeTopbar (48 px navy-dark) · OfficeSidebar (232 / 56 px, Ctrl B) ·
 * Workspace tabs (36 px) · section menu (Dropshipping / Warehouse OS) · page · CommandPalette (Ctrl K) · keyboard
 * shortcuts dialog · phone BottomNav (Part 7.8) · AuthBroadcastListener (overlay). Today's page modules render as
 * `children`, unchanged; packages/ui/src/bridge-office.css restyles their legacy classes inside `.ods-office`.
 *
 * Workspace tabs (each tab = a real route):
 *  - sidebar, app switcher, + New, bottom nav and palette Ctrl Enter open a tab (or activate the one already showing
 *    that page); a plain in-page link / palette Enter shows the page in the current tab (Part 7.1: "Enter opens in the
 *    current tab"), except on the pinned Dashboard or a tab with unsaved changes, which get a new tab;
 *  - Ctrl / ⌘ click and middle click on any Back Office link open it in a background workspace tab;
 *  - activating / closing tabs navigates; restore after reload via localStorage (+ the server row when available).
 */
export function OfficeFrame({ data, search, persistence: persistenceProp, notice, children, fixture }: OfficeFrameProps) {
  const routerPath = usePathname();
  const pathname = fixture?.pathname ?? routerPath ?? '/office';
  const router = useRouter();
  const { perms, counts, user } = data;
  const dashHref = dashboardHref(perms);
  // T8-DATA rows when the layout found them (source 'db'); localStorage only otherwise or in fixtures
  const [persistence] = useState<OfficePersistence>(() => persistenceProp ?? (data.persistence === 'db' && !fixture ? createServerPersistence() : localOnlyPersistence));

  /* ───────── nav data ───────── */
  const nav = useMemo(() => buildOfficeNav(perms, counts), [perms, counts]);
  const toSidebar = (i: ResolvedNavItem): OfficeSidebarItem => ({ id: i.id, label: i.label, href: i.href, icon: OFFICE_ICONS[i.icon], count: i.count, hidden: i.hidden });
  const sidebarItems = nav.top.map(toSidebar);
  const sidebarGroups: OfficeSidebarGroup[] = nav.groups.map((g) => ({ id: g.id, label: g.label, items: g.items.map(toSidebar) }));
  const current = currentSidebarId(pathname, perms);
  const apps = appsFor(perms);
  const goto = useMemo(() => gotoItems(perms, counts), [perms, counts]);

  /* ───────── navigation helpers ───────── */
  const intent = useRef<'new' | null>(null);
  const navigate = useCallback(
    (href: string, mode: 'new' | 'current' = 'current') => {
      if (fixture) return;
      intent.current = mode === 'new' ? 'new' : null;
      router.push(href);
    },
    [fixture, router],
  );

  /* ───────── workspace tabs ───────── */
  const wsRef = useRef<WorkspaceHandle>(null);
  const storageKey = fixture?.storageKey ?? workspaceStorageKey(user.id);
  const fixtureTabs = fixture?.tabs;
  const defaultTabs = useMemo(() => (fixtureTabs?.length ? fixtureTabs : [dashboardTab(dashHref)]), [fixtureTabs, dashHref]);
  const pathRef = useRef(pathname);
  useLayoutEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Before the Workspace restores (its effect runs after this render): make the stored tabs match the URL being loaded.
  useState(() => {
    if (typeof window === 'undefined' || fixture) return null;
    try {
      const v = prepareWorkspace(
        localStorage.getItem(storageKey),
        data.workspace,
        { path: pathname, href: pathname + window.location.search, title: cleanTitle(document.title) || navLabelFor(pathname) || 'Page', icon: iconKeyFor(pathname) },
        dashHref,
      );
      localStorage.setItem(storageKey, v);
      // server ui_prefs: sidebar collapsed, when this device has no choice of its own yet
      const sk = `${sidebarStorageKey(user.id)}:collapsed`;
      if (data.sidebarCollapsed != null && localStorage.getItem(sk) == null) localStorage.setItem(sk, JSON.stringify(data.sidebarCollapsed));
    } catch {
      /* storage blocked: the Workspace keeps its defaults */
    }
    return null;
  });

  const onActivate = useCallback(
    (tab: WorkspaceTab) => {
      if (fixture || !tab.href || samePath(tab.href, pathRef.current)) return;
      intent.current = null;
      router.push(tab.href);
    },
    [fixture, router],
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWorkspaceChange = useCallback(
    (s: { tabs: WorkspaceTab[]; activeId: string | null }) => {
      if (fixture || persistence.kind === 'local') return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persistence.saveTabs({ tabs: s.tabs.map(({ id, title, href, icon, pinned, openedAt }) => ({ id, title, href, icon, pinned, openedAt })), activeId: s.activeId }), 800);
    },
    [fixture, persistence],
  );

  // every navigation opens or activates a tab (first render is handled by prepareWorkspace above)
  const mounted = useRef(false);
  useEffect(() => {
    if (fixture) return;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const ws = wsRef.current;
    if (!ws) return;
    const st = ws.getState();
    const href = pathname + window.location.search;
    const title = navLabelFor(pathname) ?? 'Page';
    const icon = iconKeyFor(pathname);
    const mode = intent.current;
    intent.current = null;
    let targetId: string;
    if (samePath(pathname, dashHref)) {
      targetId = 'dashboard';
      ws.activate(targetId);
    } else {
      const existing = st.tabs.find((t) => samePath(t.href, pathname));
      const active = st.tabs.find((t) => t.id === st.activeId);
      if (existing) {
        targetId = existing.id;
        ws.activate(existing.id);
        ws.update(existing.id, { href });
      } else if (mode === 'new' || !active || active.pinned || active.dirty) {
        targetId = newTabId();
        ws.open({ id: targetId, title, href, icon });
      } else {
        targetId = active.id;
        ws.update(active.id, { href, title, icon });
      }
    }
    // the page's own <title> arrives after navigation: use it as the tab title
    const t = setTimeout(() => {
      const real = cleanTitle(document.title);
      if (real && targetId !== 'dashboard') wsRef.current?.update(targetId, { title: real });
    }, 400);
    return () => clearTimeout(t);
  }, [pathname, dashHref, fixture]);

  // fixture: unsaved state
  useEffect(() => {
    if (fixture?.dirtyTabId) wsRef.current?.markDirty(fixture.dirtyTabId, true);
  }, [fixture?.dirtyTabId]);

  const openTab = useCallback(
    (href: string, opts: { title?: string; background?: boolean } = {}) => {
      const ws = wsRef.current;
      if (!ws) return;
      const path = href.split(/[?#]/)[0];
      const existing = ws.getState().tabs.find((t) => samePath(t.href, path));
      if (opts.background) {
        if (!existing) ws.open({ id: newTabId(), title: opts.title || navLabelFor(path) || 'Page', href, icon: iconKeyFor(path) }, { activate: false });
        return;
      }
      if (existing) ws.activate(existing.id);
      else navigate(href, 'new');
    },
    [navigate],
  );

  const workspaceApi = useMemo<OfficeWorkspaceApi>(
    () => ({
      inFrame: true,
      openTab,
      markDirty: (dirty) => {
        const ws = wsRef.current;
        const id = ws?.getState().activeId;
        if (ws && id && id !== 'dashboard') ws.markDirty(id, dirty);
      },
    }),
    [openTab],
  );

  // Ctrl / ⌘ / middle click on a Back Office link → background workspace tab; nav-area clicks → new-tab intent
  const onLinkIntent = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    const href = a.getAttribute('href') ?? '';
    const background = e.ctrlKey || e.metaKey || e.button === 1;
    if (background) {
      if (!isOfficeHref(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openTab(href, { title: a.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60), background: true });
      return;
    }
    if (e.button === 0 && a.closest('[data-office-nav]')) intent.current = 'new';
  };

  /* ───────── palette ───────── */
  const [paletteOpen, setPaletteOpen] = useState(!!fixture?.paletteOpen);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<PaletteRecord[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentKey = fixture ? `${fixture.storageKey}.recent` : recentStorageKey(user.id);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored recent items once after mount
      setRecent(parseRecent(localStorage.getItem(recentKey)));
    } catch {
      /* ignore */
    }
  }, [recentKey]);

  // fixtures: show the sample results straight away
  useEffect(() => {
    if (!fixture?.paletteOpen) return;
    let live = true;
    void search('').then((r) => live && setRecords(r.items));
    return () => {
      live = false;
    };
  }, [fixture?.paletteOpen, search]);

  const onSearchChange = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    if (q.trim().length < 2) {
      setLoading(false);
      if (!fixture?.paletteOpen) setRecords([]);
      return;
    }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await search(q);
        if (seq === searchSeq.current) setRecords(r.items);
      } catch {
        if (seq === searchSeq.current) setRecords([]);
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, 250);
  };

  const paletteItems = useMemo<CommandPaletteItem[]>(() => {
    const gotoList: CommandPaletteItem[] = goto.map((g) => ({
      id: `goto:${g.id}`,
      group: 'goto',
      label: g.label,
      description: g.count ? `${g.count} waiting` : undefined,
      icon: OFFICE_ICONS[g.icon],
      shortcut: g.g ? ['G', g.g] : undefined,
      keywords: g.keywords,
      href: g.href,
    }));
    const recs: CommandPaletteItem[] = records.map((r) => ({ id: r.id, group: r.group, label: r.label, description: r.description, href: r.href, icon: r.group === 'actions' ? FilePen : undefined }));
    const seen = new Set([...gotoList, ...recs].map((i) => i.id));
    const old: CommandPaletteItem[] = recent.filter((r) => !seen.has(r.id) && r.group !== 'goto').map((r) => ({ id: r.id, group: r.group, label: r.label, description: r.description, href: r.href }));
    return [...recs, ...old, ...gotoList];
  }, [goto, records, recent]);

  const onPaletteSelect = (item: CommandPaletteItem, opts: { newTab: boolean }) => {
    if (!item.href) return;
    const entry: RecentEntry = { id: item.id, group: item.group, label: item.label, description: item.description, href: item.href };
    const next = pushRecent(recent, entry);
    setRecent(next);
    try {
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    // Go to = module pages: open-or-activate a tab; records follow Part 7.1 (Enter current tab, Ctrl Enter new tab)
    navigate(item.href, opts.newTab || item.group === 'goto' ? 'new' : 'current');
  };

  /* ───────── G shortcuts (G then a letter) ───────── */
  useEffect(() => {
    if (fixture) return;
    let armed = 0;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || !t || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const k = e.key.toUpperCase();
      if (k === 'G' && !armed) {
        armed = window.setTimeout(() => (armed = 0), 1500);
        return;
      }
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        const hit = goto.find((g) => g.g === k);
        if (hit) {
          e.preventDefault();
          navigate(hit.href, 'new');
        }
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [goto, navigate, fixture]);

  /* ───────── notifications (today's inbox count + T8-DATA staff alerts) ───────── */
  const [notesOpen, setNotesOpen] = useState(!!fixture?.notificationsOpen);
  const [staffUnread, setStaffUnread] = useState<number | null>(data.staffUnread);
  const bellCount = (counts.unread ?? 0) + (staffUnread ?? 0);

  /* ───────── help, account ───────── */
  const [shortcutsOpen, setShortcutsOpen] = useState(!!fixture?.shortcutsOpen);
  const shortcuts: ShortcutItem[] = useMemo(
    () => [...ODS_SHORTCUTS, ...goto.filter((g) => g.g).map((g) => ({ keys: ['G', g.g!], action: `Go to ${g.label}`, join: 'then' as const }))],
    [goto],
  );
  const [, startSignOut] = useTransition();
  const userMenuItems = [
    { id: 'profile', label: 'Profile', href: '/staff/account#profile' },
    { id: 'password', label: 'Change password', href: '/staff/account#password' },
    { id: '2fa', label: '2FA devices', href: '/staff/account#2fa' },
    { id: 'workspaces', label: 'All workspaces', href: '/staff/workspace' },
    {
      id: 'sign-out',
      label: 'Sign out',
      onSelect: () => {
        if (fixture) return;
        broadcastAuth({ type: 'signed-out' });
        startSignOut(() => staffSignOut());
      },
    },
  ];
  const newItems = newItemsFor(perms);

  /* ───────── layout ───────── */
  const section = sectionFor(pathname, perms);
  const sectionList = section ? sectionItems(section, pathname, perms) : [];
  const phoneCurrent = phoneNavCurrent(pathname);
  const bottomItems: BottomNavItem[] = [
    { id: 'home', label: 'Home', icon: Home, href: dashHref },
    { id: 'approvals', label: 'Approvals', icon: CheckSquare, href: PHONE_APPROVALS_HREF, count: counts.approvals || undefined },
    { id: 'search', label: 'Search', icon: Search, expanded: paletteOpen },
    { id: 'alerts', label: 'Alerts', icon: Bell, count: bellCount || undefined, expanded: notesOpen },
  ];
  const showDivision = data.division.options.length > 1;

  return (
    <OfficePermsContext.Provider value={{ perms, pathname }}>
      <OfficeWorkspaceContext.Provider value={workspaceApi}>
        <div
          className="ods-office flex min-h-screen flex-col bg-ods-canvas text-ods-text"
          data-density="compact"
          data-testid="office-frame"
          onClickCapture={onLinkIntent}
          onAuxClickCapture={onLinkIntent}
        >
          <a
            href="#office-main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy focus:shadow-ods-pop"
          >
            Skip to content
          </a>
          {notice}
          <div className="sticky top-0 z-(--z-sticky)" data-office-nav>
            <OfficeTopbar
              apps={apps}
              currentApp={currentAppId(pathname, perms)}
              onOpenPalette={() => setPaletteOpen(true)}
              newItems={newItems.length ? newItems.map((n) => ({ id: n.id, label: n.label, href: n.href, description: n.description })) : [{ id: 'none', label: 'Nothing to create', disabled: true, disabledReason: 'Your role has no create actions' }]}
              notificationsCount={bellCount || undefined}
              onNotifications={() => setNotesOpen(true)}
              onHelp={() => setShortcutsOpen(true)}
              user={{ name: user.name, role: user.role }}
              userMenuItems={userMenuItems}
            />
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="sticky top-12 hidden h-[calc(100vh-48px)] shrink-0 ods-tablet:block" data-office-nav>
              <OfficeSidebar
                items={sidebarItems}
                groups={sidebarGroups}
                current={current}
                testId="office-sidebar"
                storageKey={fixture ? fixture.storageKey : sidebarStorageKey(user.id)}
                collapsed={fixture?.collapsed}
                onCollapsedChange={(c) => void persistence.savePrefs({ sidebarCollapsed: c })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="sticky top-12 z-(--z-sticky) hidden ods-tablet:block">
                <Workspace
                  ref={wsRef}
                  data-testid="workspace-strip"
                  defaultTabs={defaultTabs}
                  defaultActiveId={fixture?.activeId}
                  storageKey={fixture ? undefined : storageKey}
                  icons={OFFICE_ICONS}
                  onActivate={onActivate}
                  onChange={onWorkspaceChange}
                  onNewTab={() => setPaletteOpen(true)}
                  label="Open tabs"
                />
              </div>
              {showDivision || data.staging ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ods-line bg-ods-surface px-ods-pad-page py-1.5 text-ods-small" data-testid="office-context-bar">
                  {showDivision ? <DivisionSelect options={data.division.options} current={data.division.current} disabled={!!fixture} /> : null}
                  {data.division.currentName ? (
                    <span data-testid="division-banner" className="flex flex-wrap items-center gap-x-2 text-ods-slate">
                      <span>
                        Showing <b className="text-ods-navy">{data.division.currentName}</b> only: lists, counts and notifications follow this division.
                      </span>
                      {data.division.options.length > 1 ? (
                        <form action={setDivisionScope}>
                          <input type="hidden" name="division" value="all" />
                          <button type="submit" disabled={!!fixture} className="font-semibold text-ods-info underline">
                            Show all divisions
                          </button>
                        </form>
                      ) : null}
                    </span>
                  ) : null}
                  {data.staging ? (
                    <span data-testid="staging-badge" title="Staging environment: test data, not the live site" className="ms-auto rounded-ods-pill bg-ods-warning-tint px-2 py-0.5 font-semibold text-ods-warning">
                      Staging
                    </span>
                  ) : null}
                </div>
              ) : null}
              <main id="office-main" tabIndex={-1} className="min-w-0 flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] focus:outline-none ods-tablet:pb-0">
                {isDesktopEditingPath(pathname) ? (
                  <div role="note" data-testid="open-on-computer" className="mx-ods-pad-page mt-3 flex items-start gap-2 rounded-ods-control border border-ods-line bg-ods-blue-tint px-3 py-2 text-ods-body text-ods-info ods-tablet:hidden">
                    <Icon icon={Monitor} className="mt-0.5 shrink-0" />
                    <span>
                      <b>Open this on a computer.</b> Editing here needs a bigger screen; you can still read this page.
                    </span>
                  </div>
                ) : null}
                {section && sectionList.length ? (
                  <nav
                    aria-label={`${SECTION_LABEL[section]} menu`}
                    // today's sub-shell sidebars had these test ids; the section menu does the same job (same link names, aria-current)
                    data-testid={section === 'warehouse' ? 'warehouse-sidebar' : 'dropship-staff-sidebar'}
                    data-office-section-nav={section}
                    className="border-b border-ods-line bg-ods-surface px-ods-pad-page"
                  >
                    <ul className="flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:thin]">
                      <li className="flex shrink-0 items-center pe-2 text-ods-label font-semibold text-ods-slate">{SECTION_LABEL[section]}</li>
                      {sectionList.map((it) => (
                        <li key={it.href} className="shrink-0">
                          <a
                            href={it.href}
                            onClick={(e) => {
                              if (e.ctrlKey || e.metaKey || e.button !== 0) return;
                              e.preventDefault();
                              navigate(it.href);
                            }}
                            aria-current={it.current ? 'page' : undefined}
                            className="flex h-[calc(var(--ods-control-h)-4px)] items-center whitespace-nowrap rounded-ods-control px-2.5 text-ods-small font-medium text-ods-navy hover:bg-ods-canvas aria-[current=page]:bg-ods-blue-tint aria-[current=page]:font-semibold aria-[current=page]:text-ods-info"
                          >
                            {it.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                ) : null}
                <div className="px-ods-pad-page py-ods-pad-page">{children}</div>
              </main>
            </div>
          </div>
          <div className="ods-tablet:hidden" data-office-nav>
            <BottomNav items={bottomItems} value={phoneCurrent} onAction={(id) => (id === 'search' ? setPaletteOpen(true) : id === 'alerts' ? setNotesOpen(true) : undefined)} label="Back Office" testId="office-bottom-nav" />
          </div>
          <CommandPalette
            items={paletteItems}
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            onSelect={onPaletteSelect}
            recent={recent.map((r) => r.id)}
            loading={loading}
            onSearchChange={onSearchChange}
          />
          <NotificationsDrawer
            open={notesOpen}
            onClose={() => setNotesOpen(false)}
            inboxUnread={counts.unread ?? 0}
            onOpenHref={(href) => {
              setNotesOpen(false);
              navigate(href, 'new');
            }}
            onUnreadChange={setStaffUnread}
            sample={fixture ? (fixture.notifications ?? []) : undefined}
          />
          <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" size="md" data-testid="shortcuts-dialog">
            {/* focusable list: on phones the dialog body scrolls, and a scroll region needs keyboard access (axe) */}
            <div tabIndex={0} role="group" aria-label="Shortcut list" className="rounded-ods-control">
              <ShortcutsList items={shortcuts} caption="On a Mac, Ctrl also works as ⌘." />
            </div>
          </Modal>
          {fixture ? null : <AuthBroadcastListener mode="overlay" signInHref="/staff/login" />}
        </div>
      </OfficeWorkspaceContext.Provider>
    </OfficePermsContext.Provider>
  );
}

/** Division scope (today's header switcher, same server action): submits on change. */
function DivisionSelect({ options, current, disabled }: { options: OfficeFrameData['division']['options']; current: string | null; disabled?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form ref={form} action={setDivisionScope} className="flex items-center gap-2" data-testid="division-switcher">
      <label htmlFor="ods-division" className="font-semibold text-ods-slate">
        Division
      </label>
      <select
        key={current ?? 'all'}
        id="ods-division"
        name="division"
        defaultValue={current ?? 'all'}
        disabled={pending || disabled}
        onChange={() => start(() => form.current?.requestSubmit())}
        className="h-[calc(var(--ods-control-h)-4px)] rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 pe-7 text-ods-small text-ods-navy"
      >
        <option value="all">All divisions</option>
        {options.map((d) => (
          <option key={d.code} value={d.code}>
            {d.name}
            {d.inactive ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
    </form>
  );
}
