import { Inter } from 'next/font/google';

/**
 * Dropship design v2 font (Inter 400–700).
 * Imported ONLY by the Dropship shells and standalone Dropship routes with preload: false so non-Dropship pages
 * (/, /products, /account, /admin) never preload or request the Inter woff2 files.
 */
export const dsInter = Inter({
  subsets: ['latin'],
  variable: '--font-ds-inter',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});
