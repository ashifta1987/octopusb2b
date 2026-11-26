import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * Design handoff 26 Nov 2026 §3 — the logo at the top of every App shell sidebar (full-colour on white), or the
 * Octopus Dropship logo in the Dropship areas. Same link target and accessible name as the existing <Logo />.
 * Files: public/images/design/logos/ (copied from the handoff, original names).
 */
const LOGOS = {
  b2b: { src: '/images/design/logos/octopus-b2b-colour.svg', width: 1018, height: 211, alt: 'Octopus B2B' },
  dropship: { src: '/images/design/logos/octopus-dropship-colour.svg', width: 848, height: 306, alt: 'Octopus Dropship' },
} as const;

export function AppLogo({ variant = 'b2b', href = '/', label = 'Octopus B2B home', size = 'sidebar', className }: {
  variant?: keyof typeof LOGOS; href?: string; label?: string; size?: 'sidebar' | 'bar'; className?: string;
}) {
  const l = LOGOS[variant];
  return (
    <Link href={href} aria-label={label} className={cn('inline-flex items-center shrink-0', className)}>
      <Image src={l.src} alt={l.alt} width={l.width} height={l.height} loading="eager" unoptimized
        sizes={size === 'sidebar' ? '210px' : '140px'}
        className={cn('block w-auto', size === 'sidebar' ? 'h-[54px]' : 'h-9')} />
    </Link>
  );
}
