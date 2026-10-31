import type { Metadata } from 'next';
import { Inter, Lexend, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend', weight: ['500', '600', '700', '800'], display: 'swap' });
const plex = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-plex-mono', weight: ['400', '500', '600'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Octopus B2B · Global Sourcing, Simplified', template: '%s · Octopus B2B' },
  description: 'Global B2B marketplace for industrial supplies with tiered USD pricing, RFQs, 3PL and dropshipping.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lexend.variable} ${plex.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
