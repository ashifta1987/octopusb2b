'use client';

import { Bell, CircleHelp, Plus, Search } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { useHotkey } from '../hooks';
import { IconButton, Kbd } from './button';
import { MenuButton, type MenuButtonItem } from './menu-button';

export type OfficeApp = { id: string; label: string; href: string };

export type OfficeTopbarProps = {
  /** Apps the role allows (Back Office, Accounts, Warehouse OS, Website admin). */
  apps: OfficeApp[];
  currentApp: string;
  /** Opens the CommandPalette (built by the data group). */
  onOpenPalette: () => void;
  /** Also bind Ctrl K here (leave false when the CommandPalette binds it itself). */
  bindPaletteHotkey?: boolean;
  /** + New ▾ items for the role (invoice, payment, quote, customer, product…). */
  newItems: MenuButtonItem[];
  notificationsCount?: number;
  onNotifications?: () => void;
  onHelp?: () => void;
  user: { name: string; role: string };
  userMenuItems?: MenuButtonItem[];
  className?: string;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

const ON_DARK = 'inline-flex h-[min(var(--ods-control-h),40px)] items-center gap-1.5 rounded-ods-control px-2 text-ods-label font-semibold whitespace-nowrap text-white hover:bg-white/10 aria-expanded:bg-white/10';
const PALETTE_TEXT = 'Search customers, RFQs, orders, invoices… or type a command';

/**
 * OfficeTopbar (Back Office, compact): 48 px navy-dark. White logo mark (→ /office); divider; app switcher
 * "Back Office ▾" (menu, only the apps the role allows); centred command button (up to 520 px) with Ctrl K hints
 * that calls `onOpenPalette` (aria-keyshortcuts="Control+K"); "+ New ▾" menu; notifications (count); help;
 * avatar + name + role (a menu when `userMenuItems` is given).
 * Narrow containers: the command button shrinks to a search icon, then name/role hide (avatar stays). Phones use the
 * Back Office phone frame (Approvals + BottomNav Home · Approvals · Search · Alerts) instead.
 */
export function OfficeTopbar({ apps, currentApp, onOpenPalette, bindPaletteHotkey = false, newItems, notificationsCount, onNotifications, onHelp, user, userMenuItems, className }: OfficeTopbarProps) {
  useHotkey('Ctrl+K', () => onOpenPalette(), { enabled: bindPaletteHotkey });
  const app = apps.find((a) => a.id === currentApp) ?? apps[0];
  const who = (
    <>
      <span aria-hidden className="inline-grid size-7 shrink-0 place-items-center rounded-ods-pill bg-ods-teal text-[11px] font-bold text-ods-navy">
        {initials(user.name)}
      </span>
      <span className="sr-only min-w-0 text-start leading-tight @min-[900px]:not-sr-only">
        <span className="block max-w-36 truncate text-ods-label font-semibold text-white">{user.name}</span>
        <span className="block max-w-36 truncate text-[11px] font-normal text-white/75">{user.role}</span>
      </span>
    </>
  );
  return (
    <header className={cx('@container', className)}>
      <div className="flex h-12 items-center gap-1 bg-ods-navy-dark px-2 text-white @min-[560px]:gap-2 @min-[560px]:px-3">
      <span className="contents @max-[559px]:hidden">
        <Logo variant="mark-white" area="office" height={22} />
      </span>
      <span className="contents @min-[560px]:hidden">
        <Logo variant="mark-white" area="office" height={18} />
      </span>
      <span aria-hidden className="mx-1 hidden h-6 w-px bg-white/25 @min-[560px]:block" />
      {app ? (
        <span className="hidden @min-[560px]:contents">
        <MenuButton
          label={app.label}
          menuLabel="Switch app"
          items={apps.map((a) => ({ id: a.id, label: a.label, href: a.href, checked: a.id === app.id }))}
          triggerClassName={ON_DARK}
        />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts="Control+K"
          className="hidden h-8 w-full max-w-[520px] items-center gap-2 rounded-ods-control border border-white/20 bg-white/10 px-3 text-start text-ods-label text-white/85 hover:bg-white/15 @min-[760px]:flex"
        >
          <Icon icon={Search} size="xs" />
          <span className="min-w-0 flex-1 truncate">{PALETTE_TEXT}</span>
          <span aria-hidden className="flex gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <span className="ms-auto @min-[760px]:hidden">
          <IconButton icon={Search} label="Search or type a command (Ctrl K)" variant="on-navy" onClick={onOpenPalette} aria-keyshortcuts="Control+K" />
        </span>
      </div>
      <MenuButton
        align="end"
        label={
          <>
            <Icon icon={Plus} />
            <span className="sr-only @min-[480px]:not-sr-only">New</span>
          </>
        }
        menuLabel="Create new"
        items={newItems}
        triggerClassName="inline-flex h-[min(var(--ods-control-h),40px)] items-center gap-1 rounded-ods-control bg-ods-blue px-2.5 text-ods-label font-semibold whitespace-nowrap text-white hover:bg-ods-blue-hover"
      />
      <IconButton icon={Bell} label="Notifications" count={notificationsCount} variant="on-navy" onClick={onNotifications} />
      <span className="hidden @min-[420px]:inline-flex">
        <IconButton icon={CircleHelp} label="Help" variant="on-navy" onClick={onHelp} />
      </span>
      {userMenuItems ? (
        <MenuButton align="end" showChevron={false} label={who} menuLabel="Account menu" items={userMenuItems} triggerClassName={cx(ON_DARK, 'gap-2')} />
      ) : (
        <span className="flex items-center gap-2 px-1">
          {who}
        </span>
      )}
      </div>
    </header>
  );
}
