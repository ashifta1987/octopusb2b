'use client';

import type { ReactNode } from 'react';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { ContentScreen, CONTENT_ACTIONS, type ContentActions, type ContentScreenProps } from '@/app/ods/admin/content/_components/content-screen';
import { AdsScreen, ADS_ACTIONS, type AdsActions, type AdsScreenProps } from '@/app/ods/admin/ads/_components/ads-screen';
import { NotificationsScreen, type NotificationActions, type NotificationsScreenProps } from '@/app/ods/admin/notifications/_components/notifications-screen';
import { CurrencyScreen, CURRENCY_ACTIONS, type CurrencyActions, type CurrencyScreenProps } from '@/app/ods/admin/currency/_components/currency-screen';
import { Note } from '@/app/ods/admin/_website/ods-form';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE } from './office-frame/sample-data';

/** Staging fixtures (ODS T9 Website): the real frame + screens with SAMPLE actions — nothing is read or saved. */
const ok = async () => ({ ok: true as const, message: 'Saved (sample — nothing changed)' });
const sample = <T extends Record<string, unknown>>(live: T): T => Object.fromEntries(Object.keys(live).map((k) => [k, ok])) as unknown as T;
const CONTENT: ContentActions = sample(CONTENT_ACTIONS);
const ADS: AdsActions = sample(ADS_ACTIONS);
const CURRENCY: CurrencyActions = sample(CURRENCY_ACTIONS);
const NOTES: NotificationActions = {
  markNotificationsRead: async () => {},
  openNotification: async () => ({ ok: true, link: null }),
};

function Frame({ path, title, nav, children }: { path: string; title: string; nav: ReactNode; children: ReactNode }) {
  return (
    <OfficeFrame
      data={SAMPLE_OFFICE}
      search={async () => ({ items: [] })}
      fixture={{
        pathname: path,
        tabs: [
          { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
          { id: 's-this', title, href: path, icon: 'globe' },
        ],
        activeId: 's-this',
        notifications: SAMPLE_NOTIFICATIONS,
        storageKey: `ods.office.fixture.${path}`,
      }}
    >
      {nav}
      {children}
    </OfficeFrame>
  );
}

export function ContentFixture({ nav, screen }: { nav: ReactNode; screen: Omit<ContentScreenProps, 'actions' | 'companyAlert'> }) {
  return (
    <Frame path="/admin/content" title="Site content" nav={nav}>
      <ContentScreen {...screen} actions={CONTENT} companyAlert={screen.tab === 'company' ? <Note tone="success">✓ Email deliverability: every contact domain has an MX record (sample).</Note> : undefined} />
    </Frame>
  );
}
export function AdsFixture({ nav, screen }: { nav: ReactNode; screen: Omit<AdsScreenProps, 'actions'> }) {
  return (
    <Frame path="/admin/ads" title="Advertising" nav={nav}>
      <AdsScreen {...screen} actions={ADS} />
    </Frame>
  );
}
export function NotificationsFixture({ nav, screen }: { nav: ReactNode; screen: Omit<NotificationsScreenProps, 'actions'> }) {
  return (
    <Frame path="/admin/notifications" title="Notifications" nav={nav}>
      <NotificationsScreen {...screen} actions={NOTES} />
    </Frame>
  );
}
export function CurrencyFixture({ nav, screen }: { nav: ReactNode; screen: Omit<CurrencyScreenProps, 'actions' | 'wizard'> }) {
  return (
    <Frame path="/admin/currency" title="Currency" nav={nav}>
      <CurrencyScreen {...screen} actions={CURRENCY} wizard={<Note>Sample: today’s switch wizard (choose currency, rate, wallets, timing, impact preview, request) renders here on the live page.</Note>} />
    </Frame>
  );
}

export function StateNav({ base, state, states }: { base: string; state: string; states: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="Fixture states (sample data)" className="mb-4">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {states.map(([sid, label]) => (
          <li key={sid}>
            <a
              href={`${base}?state=${sid}`}
              aria-current={state === sid ? 'page' : undefined}
              className={`inline-flex min-h-8 items-center rounded-ods-control border px-3 text-ods-small font-semibold no-underline ${state === sid ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
