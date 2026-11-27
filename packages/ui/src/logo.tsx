import Image from 'next/image';
import Link from 'next/link';
import { LOGO_ALT, LOGO_FILES, logoLink, logoSize, type LogoArea, type LogoVariant } from './logo-href';

export type LogoProps = {
  /** mark (navy, white headers) · mark-white (navy headers) · white-tagline (footer, sign-in panel, account sidebar ≥ 200 px) · full (large white areas) */
  variant?: LogoVariant;
  /** decides the link (Part 2.3) */
  area: LogoArea;
  /** introduction site only: signed-in visitors go to /shop */
  signedIn?: boolean;
  /** My account on phones: open the Shop in the same tab */
  sameTab?: boolean;
  /** image height in px (width follows the file's aspect ratio) */
  height?: number;
  priority?: boolean;
  className?: string;
};

/** The Octopus B2B logo, always a link, `alt="Octopus B2B"`, never recoloured. */
export function Logo({ variant = 'mark', area, signedIn, sameTab, height, priority, className }: LogoProps) {
  const file = LOGO_FILES[variant];
  const size = logoSize(variant, height);
  const { href, target } = logoLink(area, { signedIn, sameTab });
  return (
    <Link
      href={href}
      target={target}
      data-ods-logo={variant}
      className={['inline-flex shrink-0 items-center rounded-ods-control', className].filter(Boolean).join(' ')}
    >
      <Image src={file.src} alt={LOGO_ALT} width={size.width} height={size.height} priority={priority} style={{ width: size.width, height: 'auto' }} />
      {target ? <span className="sr-only"> (opens the Shop tab)</span> : null}
    </Link>
  );
}
