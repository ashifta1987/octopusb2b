import type { MetadataRoute } from 'next';

/** Web app manifest (brand kit): Octopus Ink theme, Aqua Pearl background, icons from public/brand. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Octopus B2B',
    short_name: 'Octopus B2B',
    description: 'Sourcing, Make My Brand, dropshipping, MOQ pools, turnkey projects and 3PL from China, in one account.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFDEF',
    theme_color: '#1A174A',
    icons: [
      { src: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { src: '/brand/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/octopus-icon-ink-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
