import type { MetadataRoute } from 'next';
import { getSiteContent, categoryPath } from '@/lib/content';
import { getSitemapProducts, getLegalSlugs, getCategoryCounts } from '@/components/store/data';
import { stockedCategories } from '@/lib/category-stock';
import { SITE_URL } from '@/components/store/seo';
import { getTurnkeySlugs } from '@/lib/turnkey/data';

/** sitemap.xml — home, products, categories (full slug paths), live product pages and CMS pages (SPEC §12 SEO). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ categories }, products, legal, turnkey, counts] = await Promise.all([getSiteContent(), getSitemapProducts(), getLegalSlugs(), getTurnkeySlugs(), getCategoryCounts()]);
  // ADDON-36 C4: empty categories are noindex and left out of the sitemap
  const stocked = stockedCategories(categories, counts);
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/pools`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${SITE_URL}/pools/terms`, changeFrequency: 'monthly', priority: 0.2 },
    { url: `${SITE_URL}/turnkey`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/turnkey/atlas`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    ...turnkey.map((slug) => ({ url: `${SITE_URL}/turnkey/${slug}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...stocked.map((c) => ({
      url: `${SITE_URL}/c/${categoryPath(categories, c.id).map((x) => x.slug).join('/')}`,
      changeFrequency: 'weekly' as const, priority: c.level === 1 ? 0.8 : 0.6,
    })),
    ...products.map((p) => ({ url: `${SITE_URL}/p/${p.slug}`, lastModified: new Date(p.updated_at), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...['about', 'contact', 'request/sourcing', 'suppliers', 'wallet', 'assistant', 'developers'].map((p) => ({ url: `${SITE_URL}/${p}`, changeFrequency: 'monthly' as const, priority: 0.4 })),
    { url: `${SITE_URL}/legal/terms`, changeFrequency: 'monthly', priority: 0.2 },
    ...legal.map((s) => ({ url: `${SITE_URL}/legal/${s}`, changeFrequency: 'monthly' as const, priority: 0.2 })),
  ];
}
