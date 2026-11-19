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
