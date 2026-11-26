import type { ReactNode } from 'react';
import { dsInter } from '@/components/dropship-ui/font';

/**
 * The Dropship kit scope (.ds-v2) around supplier pages; max width 1240px like the other Dropship screens.
 * Design handoff 26 Nov 2026: .ds-v2 now maps to the Octopus tokens (Figtree, Pearl, 16 px cards, 10 px controls), so the
 * supplier pages sit inside the restyled portal shell's main without a second look.
 */
export function SupplierFrame({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className={`${dsInter.variable} ds-v2 flex flex-col gap-6 max-w-[1240px] mx-auto w-full min-w-0`}>
      {children}
    </div>
  );
}
