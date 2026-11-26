import { Inter } from 'next/font/google';

/**
 * Dropship design v2 font (Inter 400–700).
 * Imported ONLY by the Dropship shells and standalone Dropship routes with preload: false so non-Dropship pages
 * (/, /products, /account, /admin) never preload or request the Inter woff2 files.
 * Design handoff 26 Nov 2026: the kit now renders in Figtree (--ds-font = the app's --font-text); this export stays so
 * existing imports keep working, and with no rule using --font-ds-inter the browser never downloads Inter.
 */
export const dsInter = Inter({
  subsets: ['latin'],
  variable: '--font-ds-inter',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});
