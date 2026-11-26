import type { ReactNode } from 'react';
import { dsInter } from '@/components/dropship-ui/font';

/** The Dropship design tokens (.ds-v2) around supplier pages; max width 1240px like the other Dropship screens. */
export function SupplierFrame({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className={`${dsInter.variable} ds-v2 flex flex-col gap-5 max-w-[1240px] mx-auto w-full`}>
      {children}
    </div>
  );
}
