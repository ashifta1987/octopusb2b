'use client';
import { usePathname } from 'next/navigation';

/** Renders its (server-rendered) children on the homepage only — the design's announcement bar (handoff §3). */
export function HomeOnly({ children }: { children: React.ReactNode }) {
  return usePathname() === '/' ? <>{children}</> : null;
}
