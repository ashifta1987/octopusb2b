import 'server-only';
import { getSiteContent } from '@/lib/content';
import { getCurrencyContext, type CurrencyContext } from '@/lib/currency';
import { withCurrency } from '@/lib/format';

/** Replace the `{currency}` CMS variable in every content block with the active platform currency (SPEC §15.1). */
export function currencyBlocks(blocks: Record<string, string>, currency: string): Record<string, string> {
  return Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, typeof v === 'string' ? withCurrency(v, currency) : v]));
}

/** getSiteContent() + the platform currency context, with `{currency}` already substituted in `blocks`. */
export async function getStoreContent(): Promise<Awaited<ReturnType<typeof getSiteContent>> & { ctx: CurrencyContext }> {
  const [content, ctx] = await Promise.all([getSiteContent(), getCurrencyContext()]);
  return { ...content, blocks: currencyBlocks(content.blocks, ctx.currency), ctx };
}

/** Banner after a switch: shown for 14 days after `applied_at`. */
export function activeSwitchBanner(ctx: CurrencyContext, now = Date.now()) {
  const b = ctx.banner;
  if (!b?.applied_at || !b.to) return null;
  const t = new Date(b.applied_at).getTime();
  if (!Number.isFinite(t) || now - t > 14 * 864e5 || t > now + 60_000) return null;
  return b;
}
