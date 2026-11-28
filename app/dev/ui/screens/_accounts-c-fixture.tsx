'use client';

import type { ReactNode } from 'react';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { CreditNotesScreen, type CreditNotesScreenProps } from '@/app/ods/office/accounts/credit-notes/_components/credit-notes-screen';
import { LedgerScreen, type LedgerScreenProps } from '@/app/ods/office/accounts/ledger/_components/ledger-screen';
import { PaymentsScreen, type PaymentsScreenProps } from '@/app/ods/office/accounts/payments/_components/payments-screen';
import type { ViewActions } from '@/app/ods/office/accounts/_shared/accounts-list-screen';
import type { JournalLoader } from '@/app/ods/office/accounts/_shared/journal-panel';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE } from './office-frame/sample-data';
import { SAMPLE_JOURNAL } from './_accounts-c-sample';

/** Staging fixtures (ODS T9 Accounts part C): the real frame + screens with sample actions (nothing is read or saved). */
const VIEWS: ViewActions = {
  listViews: async (page) => ({ ok: true, data: [{ id: 'sv-c1', page, name: 'My month-end check', scope: 'personal', sharedRole: null, filters: {}, columns: [], sort: [], isDefault: false, mine: true, updatedAt: '2026-11-20T10:00:00Z' }] }),
  saveView: async (v) => ({ ok: true, data: { id: `sv-${v.name.length}`, page: v.page, name: v.name, scope: 'personal', sharedRole: null, filters: v.filters ?? {}, columns: [], sort: v.sort ?? [], isDefault: false, mine: true, updatedAt: '2026-11-27T10:00:00Z' } }),
};
const JOURNAL: JournalLoader = async () => ({ ok: true, journal: SAMPLE_JOURNAL });

function Frame({ path, title, nav, children }: { path: string; title: string; nav: ReactNode; children: ReactNode }) {
  return (
    <OfficeFrame
      data={SAMPLE_OFFICE}
      search={async () => ({ items: [] })}
      fixture={{
        pathname: path,
        tabs: [
          { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
          { id: 's-invoices', title: 'Invoices', href: '/office/accounts/invoices', icon: 'file' },
          { id: 's-this', title, href: path, icon: 'file' },
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

export function CreditNotesFixture({ nav, screen }: { nav: ReactNode; screen: Omit<CreditNotesScreenProps, 'viewActions'> }) {
  return (
    <Frame path="/office/accounts/credit-notes" title="Credit notes" nav={nav}>
      <CreditNotesScreen {...screen} viewActions={VIEWS} />
    </Frame>
  );
}
export function LedgerFixture({ nav, screen }: { nav: ReactNode; screen: Omit<LedgerScreenProps, 'viewActions' | 'loadJournal'> }) {
  return (
    <Frame path="/office/accounts/ledger" title="Ledger" nav={nav}>
      <LedgerScreen {...screen} viewActions={VIEWS} loadJournal={JOURNAL} />
    </Frame>
  );
}
export function PaymentsFixture({ nav, screen }: { nav: ReactNode; screen: Omit<PaymentsScreenProps, 'viewActions' | 'loadJournal'> }) {
  return (
    <Frame path="/office/accounts/payments" title="Payments" nav={nav}>
      <PaymentsScreen {...screen} viewActions={VIEWS} loadJournal={JOURNAL} />
    </Frame>
  );
}

/** Fixture state links (one H1 stays the screen's). */
export function StateNav({ base, state, states }: { base: string; state: string; states: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="Fixture states (sample data)" className="mb-4">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {states.map(([id, label]) => (
          <li key={id}>
            <a
              href={`${base}?state=${id}`}
              aria-current={state === id ? 'page' : undefined}
              className={`inline-flex min-h-8 items-center rounded-ods-control border px-3 text-ods-small font-semibold no-underline ${state === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
