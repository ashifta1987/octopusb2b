/**
 * Logo files and link rules (Part 2.3). Pure module (no React), unit-tested in tests/unit/ods-tokens.test.ts.
 * Files are copied unchanged from docs/design/dropship-v2/assets to public/images/ods (never redrawn or recoloured).
 */
export type LogoVariant = 'mark' | 'mark-white' | 'white-tagline' | 'full';
export type LogoArea = 'public' | 'shop' | 'account' | 'office';

export const LOGO_ALT = 'Octopus B2B';
/** Named browser tabs (Part 3): the Shop and My account each reuse one tab. */
export const SHOP_TAB = 'octopus-shop';
export const ACCOUNT_TAB = 'octopus-account';

export const LOGO_FILES: Record<LogoVariant, { src: string; width: number; height: number; defaultHeight: number; minWidth?: number; onDark: boolean; use: string }> = {
  mark: { src: '/images/ods/octopus-b2b-logo-mark.png', width: 640, height: 128, defaultHeight: 32, onDark: false, use: 'White headers: introduction header, sign-in on phones, setup' },
  'mark-white': { src: '/images/ods/octopus-b2b-logo-mark-white.png', width: 640, height: 128, defaultHeight: 28, onDark: true, use: 'Navy headers: Shop header, phone headers, Back Office top bar' },
  'white-tagline': { src: '/images/ods/octopus-b2b-logo-white.png', width: 640, height: 166, defaultHeight: 52, minWidth: 200, onDark: true, use: 'Footer, sign-in side panel, My account sidebar (≥ 200 px wide only)' },
  full: { src: '/images/ods/octopus-b2b-logo.png', width: 640, height: 166, defaultHeight: 64, onDark: false, use: 'Large white areas only' },
};

/** Rendered size: keeps the file's aspect ratio; the tagline version is never narrower than 200 px. */
export function logoSize(variant: LogoVariant, height?: number): { width: number; height: number } {
  const f = LOGO_FILES[variant];
  let h = height ?? f.defaultHeight;
  let w = Math.round((h * f.width) / f.height);
  if (f.minWidth && w < f.minWidth) {
    w = f.minWidth;
    h = Math.round((w * f.height) / f.width);
  }
  return { width: w, height: h };
}

/**
 * Where the logo links (it is always a link):
 *  - introduction site → `/`, or `/shop` when signed in;
 *  - Shop → `/shop`;
 *  - My account → `/shop` in the named Shop tab (`target="octopus-shop"`), except on phones (`sameTab`), where
 *    everything opens in the same tab (Part 10);
 *  - Back Office → `/office`.
 */
export function logoLink(area: LogoArea, opts: { signedIn?: boolean; sameTab?: boolean } = {}): { href: string; target?: string } {
  switch (area) {
    case 'public':
      return { href: opts.signedIn ? '/shop' : '/' };
    case 'shop':
      return { href: '/shop' };
    case 'account':
      return opts.sameTab ? { href: '/shop' } : { href: '/shop', target: SHOP_TAB };
    case 'office':
      return { href: '/office' };
  }
}
