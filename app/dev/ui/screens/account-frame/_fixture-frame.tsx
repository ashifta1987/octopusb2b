import type { ReactNode } from 'react';
import { OdsThemeRoot } from '@octopus/ui';
import { AccountBottomBar, AccountSidebarNav, AccountTop } from '@/app/ods/account/_components/account-frame';
import { AccountFrameShell } from '@/app/ods/account/_components/frame-shell';
import type { AccountFrameData } from '@/app/ods/account/_lib/types';

/** Staging fixtures: the real My account frame pieces with SAMPLE props (sidebar inline, not sticky). */
export function AccountFixtureFrame({ data, path, collapsed, moreOpen, children }: { data: AccountFrameData; path: string; collapsed?: boolean; moreOpen?: boolean; children: ReactNode }) {
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <AccountFrameShell
        sticky={false}
        sidebar={<AccountSidebarNav data={data} path={path} collapsed={collapsed} />}
        topbar={<AccountTop data={data} />}
        bottomNav={<AccountBottomBar data={data} path={path} defaultOpen={moreOpen} />}
      >
        {children}
      </AccountFrameShell>
    </OdsThemeRoot>
  );
}

/** Small state switcher shown above the fixture content (labelled as sample). */
export function FixtureStates({ base, states, current, param = 'state' }: { base: string; states: readonly (readonly [string, string])[]; current: string; param?: string }) {
  return (
    <nav aria-label="Fixture states (sample data)" className="mx-auto w-full max-w-ods-content px-ods-pad-page pt-4">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {states.map(([id, label]) => (
          <li key={id}>
            <a
              href={`${base}?${param}=${id}`}
              aria-current={current === id ? 'page' : undefined}
              className={`inline-flex min-h-8 items-center rounded-ods-pill border px-3 text-ods-small font-semibold no-underline ${current === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
