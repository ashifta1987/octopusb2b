import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '@/app/ods/account/_services/ui';
import type { BrandTab } from '@/app/ods/account/_services/logic';
import { BrandView, type BrandProject, type BrandState } from '@/app/ods/account/brand/_components/brand-view';
import { ServicesFixtureFrame, fixtureState } from '../account-turnkey/_frame';

export const metadata: Metadata = { title: 'My account · Make My Brand · ODS fixtures (staging)', robots: { index: false, follow: false } };

/* SAMPLE brand projects (C_Brand board example) — staging only. */
const PROJECTS: BrandProject[] = [
  { id: 'b1', ref: 'MB-0007', status: 'proof', createdAt: '2026-11-12T09:00:00Z', product: { title: 'Silicone baking mat set', href: null }, productLink: null, quantity: 1000, branding: 'Branded colour box · Inserts and manuals', destination: 'Octopus warehouse, order by order', logos: [{ path: 'org/a-logo.ai', name: 'anna-home-logo.ai', url: null }] },
  { id: 'b2', ref: 'MB-0005', status: 'production', createdAt: '2026-10-02T09:00:00Z', product: { title: 'Bamboo storage box', href: null }, productLink: null, quantity: 600, branding: 'Laser engraving · Plain box with your label', destination: 'Bulk to United Arab Emirates', logos: [{ path: 'org/b-logo.png', name: 'anna-home-mark.png', url: null }] },
  { id: 'b3', ref: 'MB-0003', status: 'submitted', createdAt: '2026-11-25T09:00:00Z', product: null, productLink: 'https://example.com/pet-bowl', quantity: null, branding: 'Not sure yet', destination: 'Octopus warehouse, order by order', logos: [] },
];

const STATES = [
  { id: 'proofs', label: 'Proof to approve or comment' }, { id: 'files', label: 'Files' }, { id: 'orders', label: 'Orders' },
  { id: 'no-proof', label: 'No proof waiting' }, { id: 'empty', label: 'No projects' }, { id: 'loading', label: 'Loading' }, { id: 'error', label: 'Error' },
];

export default function BrandFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  const s: BrandState = state === 'empty' ? { kind: 'ready', projects: [] } : state === 'loading' ? { kind: 'loading' } : state === 'error' ? { kind: 'error' }
    : { kind: 'ready', projects: state === 'no-proof' ? PROJECTS.filter((p) => p.status !== 'proof') : PROJECTS };
  const tab: BrandTab = state === 'files' ? 'files' : state === 'orders' ? 'orders' : 'proofs';
  return (
    <ServicesFixtureFrame path="/account/brand" states={STATES} current={state}>
      <PageWrap><BrandView key={state} state={s} tab={tab} tabParam={null} /></PageWrap>
    </ServicesFixtureFrame>
  );
}
