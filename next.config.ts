import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // brand kit step 4: pictures from the media store (public site-media bucket) through next/image
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/site-media/**' }],
  },
  // authInterrupts: forbidden() → 403 page for another supplier's product in the distributor portal (item 3, 8 Nov 2026)
  experimental: { serverActions: { bodySizeLimit: '6mb' }, authInterrupts: true },
  partialPrefetching: true,
  // Turnkey T0 (26 Nov 2026): the ADDON-31 project, Atlas and lead pages are retired; their URLs go to the Turnkey overview.
  // Design handoff (Nov 2026): /turnkey is the overview (page 07) and the live catalogue is /turnkey/catalogue (page 08), so `catalogue` is excluded too.
  redirects() {
    return [
      { source: '/turnkey/atlas', destination: '/turnkey', permanent: true },
      { source: '/turnkey/confirmation/:id', destination: '/account/turnkey', permanent: true },
      { source: '/turnkey/:slug((?!(?:services|terms|catalogue)$)[a-z0-9-]+)/:rest*', destination: '/turnkey', permanent: true },
      { source: '/turnkey/:slug((?!(?:services|terms|catalogue)$)[a-z0-9-]+)', destination: '/turnkey', permanent: true },
      // Warehouse OS W7 (owner, 26 Nov 2026: "remove the old, follow the new"): the legacy 3PL / shipping screens are gone.
      // Query strings pass through (e.g. /office/shipping?order=<id> opens the shipment creator on B2B shipments).
      { source: '/office/shipping', destination: '/office/warehouse/b2b-shipments', permanent: true },
      { source: '/request/3pl', destination: '/3pl', permanent: true },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
