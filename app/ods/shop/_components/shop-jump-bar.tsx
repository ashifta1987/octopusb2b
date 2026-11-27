'use client';

import { JumpBar, type JumpBarSection } from '@octopus/ui';

/** Client wrapper so server components can render the JumpBar inline (sticky handled by JumpBarSlot). */
export function ShopJumpBar({ sections }: { sections: JumpBarSection[] }) {
  return <JumpBar sections={sections} sticky={false} stickyTop={68} label="Jump to a section" className="py-2" />;
}
