import { Inter } from 'next/font/google';

/**
 * ODS 1.0 font: Inter 400/500/600/700 (Part 2.2), with tabular figures available for numbers and money.
 * Exposed only as the CSS variable --font-ods-inter, which tokens.css reads inside [data-theme="ods"] (--ods-font).
 * The class is put on ODS roots by <OdsThemeRoot>, never on <html>, so the current Rubik site does not load or
 * preload Inter while the ods_theme_v1 flag is off.
 */
export const odsInter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ods-inter',
  display: 'swap',
});
