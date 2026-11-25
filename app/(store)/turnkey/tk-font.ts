import { Outfit } from 'next/font/google';

/** Turnkey design (docs/design/turnkey-v2): Outfit headings (Inter body comes from the page). Loaded only by /turnkey pages. */
export const tkOutfit = Outfit({ subsets: ['latin'], variable: '--font-tk-outfit', weight: ['500', '600', '700'], display: 'swap', preload: false });
