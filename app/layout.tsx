import type { Metadata } from 'next';
import { Figtree, Jost } from 'next/font/google';
import { block, getSiteContent } from '@/lib/content';
import { getCurrencyContext } from '@/lib/currency';
import { withCurrency } from '@/lib/format';
import { revealTimeout } from '@/lib/password-reveal';
import { PasswordRevealProvider } from '@/components/password/password-input';
import './globals.css';

// ADDON-46 fonts: Degular Display (headings) / Degular (text) / Futura (labels). Until the licences arrive:
// Figtree 400–800 stands in for both Degular cuts, Jost 600 for Futura (same CSS variables, so the swap is one file).
const text = Figtree({ subsets: ['latin'], variable: '--font-text', weight: ['400', '500', '600', '700', '800'], display: 'swap' });
const label = Jost({ subsets: ['latin'], variable: '--font-label', weight: ['500', '600'], display: 'swap' });

/** Default title/description come from CMS (company profile + home copy with the active {currency}), SPEC §8.4 / §15.1. */
export async function generateMetadata(): Promise<Metadata> {
  const [{ blocks, company }, ctx] = await Promise.all([getSiteContent(), getCurrencyContext()]);
  const brand = company?.brand ?? company?.legal_name ?? '';
  // ADDON-44-D (audit 19): site description names every service; editable as content block `site.description`.
  const description = withCurrency(block(blocks, 'site.description', 'Source from verified factories in China, put your brand on proven products, dropship to your customers and store stock near your buyers. Paid from your US dollar wallet.'), ctx.currency).slice(0, 200);
  const title = [brand, company?.tagline].filter(Boolean).join(' · ');
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: title, template: `%s · ${brand}` },
    description,
    // Link previews (WhatsApp, LinkedIn): pages without their own Open Graph tags inherit these.
    openGraph: { type: 'website', siteName: brand || undefined, title, description, images: [{ url: '/home/sourcing.png', alt: brand }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/home/sourcing.png'] },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ADDON-25: how long a revealed password stays visible (site_settings auth.password_reveal_timeout_s, cached)
  const { settings } = await getSiteContent();
  return (
    <html lang="en" className={`${text.variable} ${label.variable}`}>
      <body className="antialiased">
        <PasswordRevealProvider timeoutS={revealTimeout(settings['auth.password_reveal_timeout_s'])}>{children}</PasswordRevealProvider>
      </body>
    </html>
  );
}
