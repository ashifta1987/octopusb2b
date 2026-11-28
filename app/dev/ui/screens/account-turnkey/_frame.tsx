import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { OdsThemeRoot } from '@octopus/ui';
import { AccountFrameShell } from '@/app/ods/account/_components/frame-shell';
import { AccountBottomBar, AccountSidebarNav, AccountTop } from '@/app/ods/account/_components/account-frame';
import type { AccountFrameData } from '@/app/ods/account/_lib/types';

/** SAMPLE frame data (Part 6.7 example company) — staging fixtures only, never live. */
export const SAMPLE_SERVICES_FRAME: AccountFrameData = {
  user: { name: 'Anna K.', email: 'anna@example.com' },
  company: { id: 'sample-org', name: 'Anna Home Trading' },
  companies: [{ id: 'sample-org', name: 'Anna Home Trading' }],
  counts: { action: 4, requests: 2, orders: 3 },
  unread: 2,
  started: { sourcing: true, turnkey: true, warehouse: true, shipping: true, brand: true, dropship: false },
};

/**
 * Full-page frame for the T6 ACCOUNT SERVICES fixtures (/dev/ui/screens/account-{turnkey,warehouse,shipping,brand,settings,support}):
 * staging only (404 on live), ODS theme, the FRAME builder's AccountFrameShell + sidebar / topbar / bottom bar with SAMPLE data,
 * a "Fixture states" nav (each state is its own URL `?state=`, so every state has exactly one H1 — the page's own), then the page.
 */
export function ServicesFixtureFrame({ path, states, current, children }: { path: string; states: { id: string; label: string }[]; current: string; children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen bg-ods-canvas">
      <AccountFrameShell sticky={false}
        sidebar={<AccountSidebarNav data={SAMPLE_SERVICES_FRAME} path={path} />}
        topbar={<AccountTop data={SAMPLE_SERVICES_FRAME} />}
        bottomNav={<AccountBottomBar data={SAMPLE_SERVICES_FRAME} path={path} />}>
        <div className="mx-auto w-full max-w-ods-content px-ods-pad-page pt-4">
          <nav aria-label="Fixture states" className="flex flex-wrap items-center gap-2 rounded-ods-card border border-dashed border-ods-line-strong bg-ods-surface px-3 py-2 text-ods-small" data-testid="fixture-states">
            <span className="rounded-ods-pill bg-ods-warning-tint px-2 py-0.5 font-semibold text-ods-navy">Example · sample data</span>
            {states.map((s) => (
              <Link key={s.id} href={`?state=${s.id}`} aria-current={s.id === current ? 'page' : undefined}
                className={s.id === current ? 'font-semibold text-ods-navy underline' : 'text-ods-blue underline'} data-testid={`fixture-state-${s.id}`}>{s.label}</Link>
            ))}
          </nav>
        </div>
        {children}
      </AccountFrameShell>
    </OdsThemeRoot>
  );
}

/** `?state=` → one of the ids (first when unknown). */
export function fixtureState(raw: string | string[] | undefined, ids: string[]): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && ids.includes(v) ? v : ids[0];
}
