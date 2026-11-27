import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { isShopEnabled } from './flag';
import { createClient } from '@/lib/supabase/server';
import { getAccountContext, nowIso } from '@/lib/core/account';
import { countWaiting } from '@/lib/core/waiting';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import type { ShopRole } from './shared';

/**
 * CH-1: everything the Shop needs about the signed-in customer, read ONCE per request (React cache) and shared by the header,
 * the section bar, the phone tabs and the rails. Wallet + unread notifications come from getAccountContext(), the same source
 * as the /account shell, so both tabs always show the same numbers. Request-time data: only ever called inside <Suspense>.
 */
export const getShopViewer = cache(async () => {
  // the proxy already sends /shop/* to /account while the Shop is switched off; this is the server-side backstop
  if (!(await isShopEnabled())) redirect('/account');
  const s = await requireCustomer('/shop');
  const org = s.org!;
  const sb = await createClient();
  const [ctx, member, quoteList, waiting, dropshipV2] = await Promise.all([
    getAccountContext(org.id),
    sb.from('org_members').select('member_role').eq('org_id', org.id).eq('user_id', s.userId).maybeSingle(),
    sb.from('quote_list_items').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
    countWaiting(org.id, nowIso()).catch(() => null),
    isDropshipV2UiEnabled(),
  ]);
  return {
    session: s,
    org,
    firstName: (s.profile?.full_name ?? '').trim().split(/\s+/)[0] || null,
    role: ((member.data?.member_role as string | undefined) ?? null) as ShopRole,
    wallet: ctx.wallet,
    unread: ctx.unread,
    services: ctx.services,
    quoteCount: quoteList.count ?? 0,
    /** null = could not be counted right now (shown as "Open my account panel", never as 0) */
    waiting,
    dropshipV2,
  };
});

export type ShopViewer = Awaited<ReturnType<typeof getShopViewer>>;

/** Ranked product ids for "Recommended sourcing products" (shop_personal_picks: history → popular → featured → newest). */
export async function getPersonalPickIds(limit = 8): Promise<{ ids: string[]; personal: boolean }> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('shop_personal_picks', { p_limit: limit });
  if (error) return { ids: [], personal: false };
  const rows = (data ?? []) as { product_id: string; reason: string }[];
  return { ids: rows.map((r) => r.product_id), personal: rows.some((r) => r.reason === 'history') };
}

/** The member's recently viewed products (own rows only, RLS), newest first. */
export async function getRecentlyViewedIds(limit = 8): Promise<string[]> {
  const sb = await createClient();
  const { data } = await sb.from('product_views').select('product_id').order('viewed_at', { ascending: false }).limit(limit);
  return (data ?? []).map((r) => r.product_id as string);
}

export type QuoteListRow = { id: string; product_id: string; quantity: number; notes: string | null };
/** The company's quote list, in the order products were added. */
export async function getQuoteList(orgId: string): Promise<QuoteListRow[]> {
  const sb = await createClient();
  const { data } = await sb.from('quote_list_items').select('id, product_id, quantity, notes').eq('org_id', orgId).order('seq');
  return (data ?? []) as QuoteListRow[];
}
