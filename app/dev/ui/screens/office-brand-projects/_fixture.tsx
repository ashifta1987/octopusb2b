'use client';

import type { ComponentProps } from 'react';
import { BrandListScreen } from '@/app/ods/admin/brand-projects/_components/brand-list';

export function BrandListFixture(props: Omit<ComponentProps<typeof BrandListScreen>, 'recordHref'>) {
  return <BrandListScreen {...props} recordHref={(r) => `/dev/ui/screens/office-brand-project?ref=${encodeURIComponent(r.ref)}`} />;
}
