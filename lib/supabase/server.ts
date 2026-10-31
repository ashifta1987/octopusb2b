import { createServerClient } from '@supabase/ssr';
import { createClient as createJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Per-request client with the user's cookie, so RLS applies (SPEC §9). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

/** Anonymous client for public, cacheable storefront reads (no cookies). */
export function createPublicClient() {
  return createJsClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Service-role client. SERVER ONLY: webhooks, cron, admin user management, API keys. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createJsClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
