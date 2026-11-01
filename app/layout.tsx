import type { Metadata } from 'next';
import { Inter, Lexend, IBM_Plex_Mono } from 'next/font/google';
import { block, getSiteContent } from '@/lib/content';
import { getCurrencyContext } from '@/lib/currency';
import { withCurrency } from '@/lib/format';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend', weight: ['500', '600', '700', '800'], display: 'swap' });
const plex = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-plex-mono', weight: ['400', '500', '600'], display: 'swap' });

/** Default title/description come from CMS (company profile + home copy with the active {currency}), SPEC §8.4 / §15.1. */
export async function generateMetadata(): Promise<Metadata> {
  const [{ blocks, company }, ctx] = await Promise.all([getSiteContent(), getCurrencyContext()]);
  const brand = company?.brand ?? company?.legal_name ?? '';
  const subtitle = withCurrency(block(blocks, 'home.subtitle'), ctx.currency);
  const firstSentence = subtitle.split(/(?<=\.)\s/)[0] ?? subtitle;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: [brand, company?.tagline].filter(Boolean).join(' · '), template: `%s · ${brand}` },
    description: firstSentence.slice(0, 160),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lexend.variable} ${plex.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
