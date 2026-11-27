import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/components/store/seo';

/** robots.txt — portals and APIs are never indexed (SPEC §12 SEO). CH-1: the signed-in Shop (/shop) too; /products and /p/… stay the indexed pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/office', '/admin', '/distributor', '/supplier', '/api', '/onboarding', '/search', '/shop'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
