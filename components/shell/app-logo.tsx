import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * Design handoff 26 Nov 2026 §3 — the logo at the top of every App shell sidebar (full-colour on white), or the
 * Octopus Dropship logo in the Dropship areas. Same link target and accessible name as the existing <Logo />.
 * Brand pass 27 Nov: sub-brand lockups for the areas that have one (Octopus 3PL, Octopus Turnkey, Octopus MOQ Pool).
 * Those PNGs have a real alpha channel but a dark wordmark, so they are only placed on white / Pearl (brand guide:
 * logos on Ink, Pearl, black or white only; never on Coral). Files: public/images/design/logos/.
 */
const LOGOS = {
  b2b: { src: '/images/design/logos/octopus-b2b-original.jpg', width: 1024, height: 270, alt: 'Octopus B2B', svg: false }, // owner's original logo (27 Nov)
  dropship: { src: '/images/design/logos/octopus-dropship-colour.svg', width: 848, height: 306, alt: 'Octopus Dropship', svg: true },
  '3pl': { src: '/images/design/logos/octopus-3pl.png', width: 720, height: 297, alt: 'Octopus 3PL', svg: false },
  turnkey: { src: '/images/design/logos/octopus-turnkey.png', width: 720, height: 308, alt: 'Octopus Turnkey', svg: false },
  moq: { src: '/images/design/logos/octopus-moq-pool.png', width: 720, height: 306, alt: 'Octopus MOQ Pool', svg: false },
} as const;
export type AppLogoVariant = keyof typeof LOGOS;

export function AppLogo({ variant = 'b2b', href = '/', label = 'Octopus B2B home', size = 'sidebar', className }: {
  variant?: AppLogoVariant; href?: string; label?: string; size?: 'sidebar' | 'bar'; className?: string;
}) {
  const l = LOGOS[variant];
  // the stacked sub-brand lockups are taller than wide wordmarks: give them a little more height so the word reads the same size
  const h = l.svg ? (size === 'sidebar' ? 'h-[54px]' : 'h-9') : (size === 'sidebar' ? 'h-[60px]' : 'h-10');
  return (
    <Link href={href} aria-label={label} className={cn('inline-flex items-center shrink-0', className)}>
      <Image src={l.src} alt={l.alt} width={l.width} height={l.height} loading="eager" unoptimized={l.svg}
        sizes={size === 'sidebar' ? '210px' : '140px'}
        className={cn('block w-auto', h)} />
    </Link>
  );
}
