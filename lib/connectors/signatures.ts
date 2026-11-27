/**
 * C0 · Store-link checks (pure, client-safe, unit-tested): URL normalisation, the address ranges the server must never call, marketplace
 * hosts, and the page signatures of the six web platforms. The network part (DNS resolution, redirects, timeout) is
 * lib/connectors/detect.ts (server only).
 */
import type { StorePlatform } from './platforms';

export type NormalisedUrl = { url: string; host: string; port: number; path: string };

/** "  MyStore.com/collections " → https://mystore.com/collections. Only http(s), no credentials, no IP-literal tricks, ports 80/443. */
export function normaliseStoreUrl(input: string): NormalisedUrl | { error: string } {
  let s = String(input ?? '').trim();
  if (!s) return { error: 'Paste your store address, like mystore.com.' };
  if (s.length > 300) return { error: 'This address is too long.' };
  if (/\s/.test(s)) return { error: 'A store address has no spaces.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return { error: 'This is not a web address.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Use a web address that starts with https://.' };
  if (u.username || u.password) return { error: 'Remove the user name and password from the address.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return { error: 'Use your store\'s domain name, not an IP address.' };
  if (host === 'localhost' || /\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example|onion|arpa)$/.test(host)) return { error: 'This address is not a public store.' };
  if (!host.includes('.')) return { error: 'Use your full store address, like mystore.com.' };
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return { error: 'This domain name is not valid.' };
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (![80, 443].includes(port)) return { error: 'Use the normal address of your store (no port number).' };
  const path = (u.pathname || '/').slice(0, 200);
  // the check always starts on https; a plain-http store is followed only through its own redirect
  return { url: `https://${host}${path === '/' ? '/' : path}`, host, port: 443, path };
}

/** IPv4 / IPv6 addresses the server must never connect to (private, loopback, link-local, metadata, CGNAT, multicast, reserved). */
export function isBlockedAddress(ip: string): boolean {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [p, q, r] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if ([p, q, r, Number(v4[4])].some((n) => n > 255)) return true;
    return p === 0 || p === 10 || p === 127 || p >= 224 // this network, private, loopback, multicast + reserved + broadcast
      || (p === 100 && q >= 64 && q <= 127) // CGNAT
      || (p === 169 && q === 254) // link-local incl. 169.254.169.254 metadata
      || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) // private
      || (p === 192 && q === 0 && (r === 0 || r === 2)) || (p === 198 && (q === 18 || q === 19)) // IETF, TEST-NET-1, benchmarking
      || (p === 198 && q === 51 && r === 100) || (p === 203 && q === 0 && r === 113); // TEST-NET-2/3
  }
  if (!a.includes(':')) return true; // not an IP at all → refuse
  // IPv4-mapped / -compatible / NAT64 / 6to4 → check the embedded IPv4
  const mapped = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return isBlockedAddress(mapped[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hexMapped) {
    const n = (parseInt(hexMapped[1], 16) << 16) >>> 0 | parseInt(hexMapped[2], 16);
    return isBlockedAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  if (a === '::' || a === '::1') return true;
  const first = parseInt(a.split(':')[0] || '0', 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && /^2001:0?db8:/.test(a)) return true; // documentation
  if (first === 0x2002) { // 6to4: the next 32 bits are an IPv4
    const parts = a.split(':');
    const hi = parseInt(parts[1] || '0', 16); const lo = parseInt(parts[2] || '0', 16);
    return isBlockedAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  if (first === 0x0064 && a.startsWith('64:ff9b:')) return true; // NAT64 with a non-dotted tail: refuse
  return first === 0; // ::/8 reserved
}

/** Marketplaces are recognised by their address and never fetched (a seller signs in there; there is no store link). */
export function marketplaceFor(host: string): StorePlatform | null {
  const h = host.toLowerCase();
  if (/(^|\.)amazon\.(com|ae|sa|co\.uk|de|fr|it|es|nl|ca|com\.au|in|co\.jp|com\.tr|eg|sg|pl|se|com\.be|com\.mx|com\.br)$/.test(h) || /(^|\.)sellercentral\.amazon\./.test(h)) return 'amazon';
  if (/(^|\.)ebay\.(com|co\.uk|de|fr|it|es|ca|com\.au|nl|be|at|ch|ie|pl|com\.sg|com\.hk|ph|com\.my)$/.test(h)) return 'ebay';
  if (/(^|\.)etsy\.(com|me)$/.test(h)) return 'etsy';
  if (/(^|\.)walmart\.(com|ca)$/.test(h)) return 'walmart';
  if (/(^|\.)tiktok\.com$/.test(h) || /(^|\.)tiktokshop\.com$/.test(h)) return 'tiktok_shop';
  return null;
}

export type PageSample = { host: string; headers: Record<string, string>; html: string; cookies: string[] };

/** Page signatures. Each returns the evidence found (empty = not this platform). Two independent hints are needed, or one strong one. */
const SIGNATURES: { platform: StorePlatform; strong: (p: PageSample) => string[]; weak: (p: PageSample) => string[] }[] = [
  {
    platform: 'shopify',
    strong: (p) => [
      /\.myshopify\.com$/.test(p.host) && 'myshopify.com address',
      p.headers['x-shopid'] && 'X-ShopId header',
      /shopify/i.test(p.headers['powered-by'] ?? '') && 'Powered-By: Shopify header',
      /Shopify\.theme\s*=|window\.Shopify\s*=|Shopify\.shop\s*=/.test(p.html) && 'Shopify theme script',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /cdn\.shopify\.com/i.test(p.html) && 'cdn.shopify.com assets',
      p.headers['x-shopify-stage'] && 'X-Shopify-Stage header',
      p.cookies.some((c) => /^(_shopify_|cart_sig|_secure_session_id)/.test(c)) && 'Shopify cookies',
    ].filter(Boolean) as string[],
  },
  {
    platform: 'woocommerce',
    strong: (p) => [
      /\/wp-content\/plugins\/woocommerce\//i.test(p.html) && 'WooCommerce plugin assets',
      /<meta[^>]+name=["']generator["'][^>]+content=["']WooCommerce/i.test(p.html) && 'WooCommerce generator tag',
      /class=["'][^"']*\bwoocommerce(-page|-no-js)?\b/i.test(p.html) && 'woocommerce page class',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /wp-content|wp-includes/i.test(p.html) && 'WordPress assets',
      /\bwc-block|wc_add_to_cart_params|woocommerce_params/i.test(p.html) && 'WooCommerce scripts',
      /rel="https:\/\/api\.w\.org\/"/i.test(p.headers.link ?? '') && 'WordPress REST API link',
      p.cookies.some((c) => /^(woocommerce_|wp_woocommerce_session_)/.test(c)) && 'WooCommerce cookies',
    ].filter(Boolean) as string[],
  },
  {
    platform: 'wix',
    strong: (p) => [
      p.headers['x-wix-request-id'] && 'X-Wix-Request-Id header',
      /<meta[^>]+name=["']generator["'][^>]+content=["']Wix\.com/i.test(p.html) && 'Wix generator tag',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /static\.parastorage\.com|static\.wixstatic\.com/i.test(p.html) && 'Wix static assets',
      /wix-ecommerce|wixstores/i.test(p.html) && 'Wix Stores scripts',
      /\.wixsite\.com$/.test(p.host) && 'wixsite.com address',
    ].filter(Boolean) as string[],
  },
  {
    platform: 'bigcommerce',
    strong: (p) => [
      /\.mybigcommerce\.com$/.test(p.host) && 'mybigcommerce.com address',
      /cdn\d*\.bigcommerce\.com\/s-[a-z0-9]+/i.test(p.html) && 'BigCommerce store CDN',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /bigcommerce/i.test(p.html) && 'BigCommerce mention in page code',
      /stencil-utils|BCData\s*=/i.test(p.html) && 'BigCommerce Stencil scripts',
      p.cookies.some((c) => /^(SHOP_SESSION_TOKEN|fornax_anonymousId)/.test(c)) && 'BigCommerce cookies',
    ].filter(Boolean) as string[],
  },
  {
    platform: 'magento',
    strong: (p) => [
      /type=["']text\/x-magento-init["']/i.test(p.html) && 'x-magento-init scripts',
      /Magento_[A-Z][A-Za-z]+\//.test(p.html) && 'Magento module assets',
      p.headers['x-magento-cache-debug'] && 'X-Magento header',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /mage\/cookies|requirejs-config\.js|\/static\/version\d+\/frontend\//i.test(p.html) && 'Magento static paths',
      p.cookies.some((c) => /^(X-Magento-Vary|mage-cache-sessid|mage-cache-storage|form_key)/i.test(c)) && 'Magento cookies',
    ].filter(Boolean) as string[],
  },
  {
    platform: 'prestashop',
    strong: (p) => [
      /<meta[^>]+name=["']generator["'][^>]+content=["']PrestaShop/i.test(p.html) && 'PrestaShop generator tag',
      /var\s+prestashop\s*=|prestashop\s*=\s*\{/i.test(p.html) && 'prestashop script object',
    ].filter(Boolean) as string[],
    weak: (p) => [
      /\/modules\/ps_[a-z]+\/|\/themes\/classic\/assets\//i.test(p.html) && 'PrestaShop module / theme paths',
      p.cookies.some((c) => /^PrestaShop-[0-9a-f]+/i.test(c)) && 'PrestaShop cookie',
    ].filter(Boolean) as string[],
  },
];

/** Which web platform is this page? null = not recognised ("unknown"). */
export function matchSignature(p: PageSample): { platform: StorePlatform; evidence: string[] } | null {
  let best: { platform: StorePlatform; evidence: string[]; score: number } | null = null;
  for (const s of SIGNATURES) {
    const strong = s.strong(p);
    const weak = s.weak(p);
    const score = strong.length * 2 + weak.length;
    if ((strong.length >= 1 || weak.length >= 2) && (!best || score > best.score)) best = { platform: s.platform, evidence: [...strong, ...weak], score };
  }
  return best ? { platform: best.platform, evidence: best.evidence } : null;
}
