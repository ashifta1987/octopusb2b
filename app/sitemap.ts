import type { MetadataRoute } from 'next';
import { getSiteContent, categoryPath } from '@/lib/content';
import { getSitemapProducts, getLegalSlugs } from '@/components/store/data';
import { SITE_URL } from '@/components/store/seo';

/** sitemap.xml — home, products, categories (full slug paths), live product pages and CMS pages (SPEC §12 SEO). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ categories }, products, legal] = await Promise.all([getSiteContent(), getSitemapProducts(), getLegalSlugs()]);
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    ...categories.map((c) => ({
      url: `${SITE_URL}/c/${categoryPath(categories, c.id).map((x) => x.slug).join('/')}`,
      changeFrequency: 'weekly' as const, priority: c.level === 1 ? 0.8 : 0.6,
    })),
    ...products.map((p) => ({ url: `${SITE_URL}/p/${p.slug}`, lastModified: new Date(p.updated_at), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...['about', 'contact', 'request/sourcing'].map((p) => ({ url: `${SITE_URL}/${p}`, changeFrequency: 'monthly' as const, priority: 0.4 })),
    { url: `${SITE_URL}/legal/terms`, changeFrequency: 'monthly', priority: 0.2 },
    ...legal.map((s) => ({ url: `${SITE_URL}/legal/${s}`, changeFrequency: 'monthly' as const, priority: 0.2 })),
  ];
}
