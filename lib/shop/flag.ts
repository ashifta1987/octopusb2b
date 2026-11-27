/**
 * Owner 27 Nov (19:24): the Shop (CH-1) stays OFF on live until the new theme (Cart) replaces the quote list.
 * One switch, read the same way by the proxy, server actions, route handlers and pages:
 *   1. site_settings `shop_enabled` (boolean, `is_public = true` so the anon read sees it — same as `dropship_v2_ui`);
 *   2. if that row is missing (or not a boolean): env `SHOP_ENABLED` ('true' / 'false'), a per-deployment default;
 *   3. otherwise: ON on staging (APP_ENVIRONMENT = 'staging'), OFF everywhere else (live).
 * No row + no env on live = OFF, so the safe state needs no action. Pure module (fetch only), so proxy.ts can use it.
 * When OFF: /shop/* → /account, customers land on /account after sign-in, signed-in / /login /signup behave as before CH-1.
 * Suppliers still go to /supplier and the strict same-site ?next= check stays either way.
 */
export const SHOP_SETTING = 'shop_enabled';
export const SHOP_HOME = '/shop';
export const ACCOUNT_HOME = '/account';

export function shopEnabledFrom(value: unknown, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  if (typeof value === 'boolean') return value;
  const o = (env.SHOP_ENABLED ?? '').trim().toLowerCase();
  if (o === 'true' || o === '1' || o === 'on') return true;
  if (o === 'false' || o === '0' || o === 'off') return false;
  return env.APP_ENVIRONMENT === 'staging';
}

/** Where a signed-in customer lands when no usable ?next= is given. */
export const customerHome = (shopOn: boolean) => (shopOn ? SHOP_HOME : ACCOUNT_HOME);

/**
 * Reads the switch with the public (anon) REST call the proxy already uses for dropship_v2_ui. Never cached, so a change
 * applies on the next request. On any read failure → the environment default (OFF on live).
 */
export async function isShopEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return shopEnabledFrom(undefined);
  try {
    const res = await fetch(`${url}/rest/v1/site_settings?select=value&key=eq.${SHOP_SETTING}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return shopEnabledFrom(undefined);
    const rows = (await res.json()) as { value: unknown }[];
    return shopEnabledFrom(rows[0]?.value);
  } catch {
    return shopEnabledFrom(undefined);
  }
}
