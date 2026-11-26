'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { isChannel, type ChannelSettings } from '@/lib/dropship-ds14-shared';

/**
 * Release 6 · Step 14 — merchant actions for Integrations / Connect a channel. Settings are saved; connections are NOT possible yet
 * (owner decision: store connections come last), so there is no connect action: the buttons are disabled with a reason, and the RPC
 * ds_channel_action would refuse anyway.
 */
export type ChannelResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export async function saveChannelSettingsAction(channel: string, settings: ChannelSettings): Promise<ChannelResult> {
  await requireDropshipV2Merchant('/account/dropship/integrations');
  const p = z.object({ sync_stock: z.boolean(), sync_prices: z.boolean(), send_tracking: z.boolean(), cancel_on_store_cancel: z.boolean() }).safeParse(settings);
  if (!p.success || !isChannel(channel) || channel === 'amazon') return { ok: false, message: 'Check the settings and try again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('ds_channel_settings_save', { p_channel: channel, p: p.data });
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath('/account/dropship/integrations');
  revalidatePath(`/account/dropship/integrations/${channel}`);
  return { ok: true, data: undefined };
}

export async function channelWaitlistAction(channel: string, join: boolean): Promise<ChannelResult> {
  await requireDropshipV2Merchant('/account/dropship/integrations');
  if (!isChannel(channel)) return { ok: false, message: 'This channel is not available.' };
  const sb = await createClient();
  const { error } = await sb.rpc('ds_channel_waitlist', { p_channel: channel, p_join: join });
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath('/account/dropship/integrations');
  return { ok: true, data: undefined };
}
