import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

/**
 * CH-1: link between the two areas (Shop ↔ Account panel). Desktop: a NEW tab (`target="_blank" rel="noopener"`, ↗ icon,
 * screen-reader text "(opens in a new tab)"). Phone: the SAME tab. Two anchors, one hidden per breakpoint with display:none,
 * so screen readers meet only one and no JavaScript is needed. `className` must not set `display` (the breakpoints do).
 * Shared by the Shop header, the welcome strip and (CH-2) the panel's "Browse products ↗".
 */
export function PanelLink({ href, children, className = '', testId, icon = true }: {
  href: string; children: React.ReactNode; className?: string; testId?: string; icon?: boolean;
}) {
  return (
    <>
      <a href={href} target="_blank" rel="noopener" className={`hidden md:inline-flex items-center gap-1.5 ${className}`} data-testid={testId} data-newtab="desktop">
        {children}
        {icon && <ExternalLink size={16} strokeWidth={1.9} aria-hidden />}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <Link href={href} prefetch={false} className={`inline-flex md:hidden items-center gap-1.5 ${className}`} data-testid={testId ? `${testId}-phone` : undefined} data-newtab="phone">
        {children}
      </Link>
    </>
  );
}
