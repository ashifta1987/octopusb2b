/**
 * C0 · Connector platforms (client-safe: names, kinds, what each needs from the owner). The database lists are the source of truth
 * (c0_platforms() and the CHECKs on store_connections / store_orders / dropship_channel_waitlist); keep these in step.
 * Nothing here talks to a platform. Every real platform stays "not configured" until its owner keys exist on the server.
 */
export type StorePlatform =
  | 'shopify' | 'woocommerce' | 'wix' | 'bigcommerce' | 'magento' | 'prestashop' | 'opencart'
  | 'ebay' | 'tiktok_shop' | 'amazon' | 'walmart' | 'etsy';
export type RequestPlatform = StorePlatform | 'salla' | 'zid' | 'shopee' | 'lazada' | 'other';
export type PlatformKind = 'web' | 'marketplace' | 'regional';
/** How the merchant connects once it is built: OAuth app install, approval link with keys, or a pasted key. */
export type ConnectMethod = 'oauth_app' | 'approval_link' | 'pasted_key' | 'seller_auth';

export type PlatformInfo = {
  key: RequestPlatform;
  name: string;
  kind: PlatformKind;
  method?: ConnectMethod;
  /** server env var NAMES that must exist before the connector can be switched on (values are never read here) */
  env: string[];
  /** what the owner must create first (plain words, for the staff health card and NOTES) */
  ownerNeeds: string;
};

export const PLATFORMS: PlatformInfo[] = [
  { key: 'shopify', name: 'Shopify', kind: 'web', method: 'oauth_app', env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_APP_URL', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'Shopify Dev Dashboard app (staging + production), dev store, staging DNS' },
  { key: 'woocommerce', name: 'WooCommerce', kind: 'web', method: 'approval_link', env: ['CONNECTOR_TOKEN_KEY'], ownerNeeds: 'a test WordPress + WooCommerce store on HTTPS' },
  { key: 'wix', name: 'Wix', kind: 'web', method: 'oauth_app', env: ['WIX_APP_ID', 'WIX_APP_SECRET', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'Wix Developers app (app ID, secret, redirect URL)' },
  { key: 'bigcommerce', name: 'BigCommerce', kind: 'web', method: 'oauth_app', env: ['BIGCOMMERCE_CLIENT_ID', 'BIGCOMMERCE_CLIENT_SECRET', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'BigCommerce Developer Portal app + sandbox store' },
  { key: 'magento', name: 'Magento (Adobe Commerce)', kind: 'web', method: 'pasted_key', env: ['CONNECTOR_TOKEN_KEY'], ownerNeeds: 'a test Magento store' },
  { key: 'prestashop', name: 'PrestaShop', kind: 'web', method: 'pasted_key', env: ['CONNECTOR_TOKEN_KEY'], ownerNeeds: 'a test PrestaShop store' },
  { key: 'opencart', name: 'OpenCart', kind: 'web', method: 'pasted_key', env: ['CONNECTOR_TOKEN_KEY'], ownerNeeds: 'a test OpenCart store' },
  { key: 'ebay', name: 'eBay', kind: 'marketplace', method: 'seller_auth', env: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RUNAME', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'eBay Developers Program keysets, RuName, account-deletion endpoint, sandbox seller' },
  { key: 'tiktok_shop', name: 'TikTok Shop', kind: 'marketplace', method: 'seller_auth', env: ['TIKTOK_SHOP_APP_KEY', 'TIKTOK_SHOP_APP_SECRET', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'TikTok Shop Partner Center app per region + test seller' },
  { key: 'amazon', name: 'Amazon', kind: 'marketplace', method: 'seller_auth', env: ['AMAZON_SP_CLIENT_ID', 'AMAZON_SP_CLIENT_SECRET', 'AMAZON_SP_APP_ID', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'SP-API developer registration, app, LWA credentials, restricted-role approval' },
  { key: 'walmart', name: 'Walmart', kind: 'marketplace', method: 'pasted_key', env: ['CONNECTOR_TOKEN_KEY'], ownerNeeds: 'Walmart Marketplace seller approval (merchant keys per seller)' },
  { key: 'etsy', name: 'Etsy', kind: 'marketplace', method: 'seller_auth', env: ['ETSY_KEYSTRING', 'CONNECTOR_TOKEN_KEY'], ownerNeeds: 'Etsy Open API v3 app (PKCE) + a check of Etsy\'s dropshipping rules' },
  { key: 'salla', name: 'Salla', kind: 'regional', env: [], ownerNeeds: 'not planned yet (request counter only)' },
  { key: 'zid', name: 'Zid', kind: 'regional', env: [], ownerNeeds: 'not planned yet (request counter only)' },
  { key: 'shopee', name: 'Shopee', kind: 'regional', env: [], ownerNeeds: 'not planned yet (request counter only)' },
  { key: 'lazada', name: 'Lazada', kind: 'regional', env: [], ownerNeeds: 'not planned yet (request counter only)' },
  { key: 'other', name: 'Other platform', kind: 'regional', env: [], ownerNeeds: 'merchant typed the name' },
];

export const STORE_PLATFORMS = PLATFORMS.filter((p) => p.kind !== 'regional').map((p) => p.key as StorePlatform);
export const WEB_PLATFORMS: StorePlatform[] = ['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop', 'opencart'];
/** The six signatures the store-link check recognises from a page (marketplaces are recognised by their address, never fetched). */
export const DETECTABLE: StorePlatform[] = ['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'prestashop'];
export const isStorePlatform = (k: string): k is StorePlatform => (STORE_PLATFORMS as string[]).includes(k);
export const isRequestPlatform = (k: string): k is RequestPlatform => PLATFORMS.some((p) => p.key === k);
export const platformName = (k: string | null | undefined): string => PLATFORMS.find((p) => p.key === k)?.name ?? (k === 'csv' ? 'CSV file' : 'Unknown platform');

/** store_connections status words (DS6) in merchant language; the plan's pending / connected / error map onto them. */
export const CONNECTION_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  connecting: { label: 'Connecting', tone: 'info' },
  active: { label: 'Connected', tone: 'ok' },
  needs_reconnect: { label: 'Could not connect', tone: 'bad' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
};
