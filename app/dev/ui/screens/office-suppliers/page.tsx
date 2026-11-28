import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { SuppliersFixture } from '../office-products/_fixtures';
import { SUPPLIERS, VARIANTS, DEL_PREVIEW, COUNTRIES } from '../office-products/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-products/_shared';

export const metadata: Metadata = { title: 'Suppliers · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-suppliers';
const STATES = ['list', 'drawer', 'identity', 'new', 'archived', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): Suppliers, SAMPLE data. ?state=list|drawer|identity|new|archived|empty|error|loading|no-permission&role=finance|admin|sales */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'admin');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'list';
  const links = fixtureLinks(BASE, STATES, state, role);
  const isAdmin = role === 'admin';
  const rows = state === 'error' ? null : state === 'empty' ? [] : state === 'archived' ? SUPPLIERS : SUPPLIERS.filter((x) => !x.archived_at);
  return (
    <SuppliersFixture
      role={role}
      links={links}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        rows,
        includeArchived: state === 'archived',
        q: '',
        selected: state === 'drawer' ? { id: SUPPLIERS[0].id, variants: [], delPreview: null } : state === 'identity' ? { id: SUPPLIERS[1].id, variants: VARIANTS, delPreview: isAdmin ? DEL_PREVIEW : null } : null,
        creating: state === 'new',
        countries: COUNTRIES,
        perms: { canCreate: role !== 'sales', canEdit: role !== 'sales', isAdmin },
        basePath: BASE,
        extraParams: { state: 'list', role },
      }}
    />
  );
}
