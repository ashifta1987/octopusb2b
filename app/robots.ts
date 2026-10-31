import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/components/store/seo';

/** robots.txt — portals and APIs are never indexed (SPEC §12 SEO). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/office', '/admin', '/distributor', '/supplier', '/api', '/onboarding', '/search'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
