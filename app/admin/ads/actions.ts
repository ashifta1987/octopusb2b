'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { toCents } from '@/lib/format';
import { guard, fail, ok, str, type Result } from '@/components/admin/server';

const TARGETS = ['active', 'rejected', 'paused', 'ended', 'in_review'] as const;
type Target = (typeof TARGETS)[number];

/** Moderation / pause / resume / end via transition_campaign (status history + audit). */
export async function moderateCampaign(id: string, to: Target, reason?: string): Promise<Result> {
  const g = await guard('ads', 'edit');
  if ('error' in g) return g.error;
  if (!TARGETS.includes(to)) return fail('INVALID_TRANSITION');
  if (to === 'rejected' && !reason?.trim()) return fail('REASON_REQUIRED');
  const { error } = await g.sb.rpc('transition_campaign', { p_id: id, p_to: to, p_reason: reason?.trim() || null });
  if (error) return fail(error);
  revalidatePath('/admin/ads');
  revalidateTag('ads', 'max');
  return ok(to === 'active' ? 'Campaign is live' : `Campaign ${to.replace('_', ' ')}`);
}

/** Edit placement name and minimum CPC. */
export async function savePlacement(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('ads', 'edit');
  if ('error' in g) return g.error;
  const code = str(fd, 'code');
  const name = str(fd, 'name');
  const cents = toCents(str(fd, 'min_cpc'));
  if (!code || name.length < 2) return fail('Name is required.');
  if (!Number.isFinite(cents) || cents <= 0) return fail('INVALID_AMOUNT');
  const { data, error } = await g.sb.from('ad_placements').update({ name, min_cpc_cents: cents }).eq('code', code).select('code');
  if (error) return fail(error);
  if (!data?.length) return fail('FORBIDDEN');
  revalidatePath('/admin/ads');
  revalidateTag('ads', 'max');
  return ok('Saved');
}
