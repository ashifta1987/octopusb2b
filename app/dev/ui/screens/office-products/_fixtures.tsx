'use client';

import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { ModerationScreen, type ModerationScreenProps } from '@/app/ods/office/products/_components/moderation-screen';
import { SuppliersScreen, type SuppliersScreenProps } from '@/app/ods/admin/suppliers/_components/suppliers-screen';
import { ImportListScreen, type ImportListProps } from '@/app/ods/admin/import/_components/import-list';
import { ImportRunScreen, type ImportRunProps } from '@/app/ods/admin/import/_components/import-run';
import { ImportReviewScreen, type ImportReviewProps } from '@/app/ods/admin/import/_components/import-review';
import { HsCodesScreen, type HsScreenProps } from '@/app/ods/admin/hs-codes/_components/hs-codes-screen';
import { CatalogScreen, type CatalogScreenProps } from '@/app/ods/admin/catalog/_components/catalog-screen';
import type { SampleRole } from '../office-dashboard/sample-data';

type Links = { href: string; text: string; current: boolean }[];
const S = ' (sample — nothing was saved)';
const ok = (m: string) => async () => ({ ok: true as const, message: m + S });

function Frame({ role, pathname, links, children }: { role: SampleRole; pathname: string; links: Links; children: React.ReactNode }) {
  return (
    <OfficeScreenFrame role={role} pathname={pathname}>
      <FixtureStates label="Fixture states (sample data)" links={links} />
      {children}
    </OfficeScreenFrame>
  );
}

export const ProductsFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<ModerationScreenProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/office/products" links={links}><ModerationScreen {...screen} fixture actions={{ moderate: async (_id, to) => ({ ok: true, message: (to === 'live' ? 'Published' : to === 'rejected' ? 'Rejected' : 'In review') + S }) }} /></Frame>
);
export const SuppliersFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<SuppliersScreenProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/admin/suppliers" links={links}><SuppliersScreen {...screen} fixture actions={{ create: ok('Supplier created'), update: ok('Supplier saved'), setSwitch: ok('Switch saved'), setArchived: ok('Supplier archived'), remove: ok('Supplier deleted'), setCanonical: ok('Canonical name chosen') }} /></Frame>
);
export const ImportFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<ImportListProps, 'actions'> }) => (
  <Frame role={role} pathname="/admin/import" links={links}>
    <ImportListScreen {...screen} actions={{ createUploads: async () => ({ ok: false, error: 'Uploads are switched off in the staging fixture (sample).' }), stage: async () => ({ ok: false, error: 'Sample' }), uploadFile: async () => ({ error: null }) }} />
  </Frame>
);
export const ImportRunFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<ImportRunProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/admin/import" links={links}><ImportRunScreen {...screen} fixture actions={{ commit: ok('Committed'), discard: ok('Preview discarded'), submit: ok('Submitted for moderation') }} /></Frame>
);
export const ImportReviewFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<ImportReviewProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/admin/import" links={links}><ImportReviewScreen {...screen} fixture actions={{ decide: ok('Decision saved'), setPricing: ok('Pricing applied') }} /></Frame>
);
export const HsFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<HsScreenProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/admin/hs-codes" links={links}>
    <HsCodesScreen {...screen} fixture actions={{ confirm: ok('Heading confirmed'), change: ok('Heading changed'), preview: async () => [{ sku: 'OCT-000231', title: 'Stainless lunch box', current_code: '7323' }, { sku: 'OCT-000240', title: 'Bento box', current_code: null }], backfillPreview: ok('Preview ready'), backfillApply: ok('Applied') }} />
  </Frame>
);
export const CatalogFixture = ({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<CatalogScreenProps, 'actions' | 'fixture'> }) => (
  <Frame role={role} pathname="/admin/catalog" links={links}>
    <CatalogScreen {...screen} fixture actions={{ createCategory: ok('Category added'), updateCategory: ok('Saved'), moveCategory: ok('Moved'), setCategoryActive: ok('Saved'), mergeCategory: ok('Merged'), saveTag: ok('Tag saved'), deleteTag: ok('Tag deleted') }} />
  </Frame>
);
