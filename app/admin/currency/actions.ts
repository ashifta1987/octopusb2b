'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { CURRENCIES, type Currency } from '@/lib/format';
import { guard, fail, failAt, ok, str, type Result } from '@/components/admin/server';
import { isStepUpError } from '@/lib/staff/step-up';

/** Currency-switch error codes raised by the RPCs (SPEC §15.1) → user-facing text. */
const CURRENCY_ERRORS: Record<string, string> = {
  MAKER_CANNOT_APPROVE: 'You requested this switch, so you cannot approve it. Another Finance user must approve (maker–checker).',
  PAYMENT_ADAPTER_UNSUPPORTED: 'The active payment adapter does not support this currency. Enable it on Integrations first.',
  SWITCH_ALREADY_PENDING: 'A currency switch is already waiting for approval or scheduled. Approve or cancel it first.',
  ALREADY_ACTIVE: 'That currency is already the platform currency.',
  INVALID_RATE: 'Enter a rate greater than zero.',
  UNSUPPORTED_CURRENCY: 'Only USD and CNY are supported.',
  FX_RATE_MISSING: 'No approved exchange rate is set yet.',
  INVALID_TRANSITION: 'This request can no longer be changed (it was already approved, applied or cancelled).',
};

function failCur(e: { message?: string } | string | null | undefined): Result {
  if (isStepUpError(e)) return failAt(e, '/admin/currency');   // step-up (SPEC §17.3) → /staff/verify and back
  const raw = typeof e === 'string' ? e : e?.message ?? '';
  const code = raw.split(':')[0].trim();
  return CURRENCY_ERRORS[code] ? { ok: false, error: CURRENCY_ERRORS[code] } : fail(e);
}

/** Storefront prices, service prices and products depend on the currency + rate. */
function revalidateCurrency() {
  revalidateTag('currency', 'max');
  revalidateTag('site-content', 'max');
  revalidateTag('products', 'max');
  revalidateTag('service-prices', 'max');
  revalidatePath('/admin/currency');
  revalidatePath('/admin/services');
}

function parseRate(v: string) {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 1e6) / 1e6 : NaN;
}

function parseWhen(v: string): string | null | 'invalid' {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

/** Admin: set a new approved (manual) rate, CNY per 1 USD. Billing uses only approved rates. */
export async function setFxRate(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('finance', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const rate = parseRate(str(fd, 'rate'));
  if (!Number.isFinite(rate)) return failCur('INVALID_RATE');
  const when = parseWhen(str(fd, 'effective_from_iso'));
  if (when === 'invalid') return fail('Invalid date');
  const { error } = await g.sb.rpc('set_fx_rate', { p_rate: rate, p_note: str(fd, 'note') || null, p_effective_from: when });
  if (error) return failCur(error);
  revalidateCurrency();
  return ok(when && new Date(when).getTime() > Date.now() + 60_000 ? `Rate ${rate} scheduled` : `Approved rate set to ${rate} CNY per USD`);
}

export type ImpactResult = { ok: true; impact: Record<string, unknown> } | { ok: false; error: string };

/** Impact preview for a switch to `to` (currency_switch_impact). */
export async function previewImpact(to: string): Promise<ImpactResult> {
  const g = await guard('finance', 'view');
  if ('error' in g) return g.error as { ok: false; error: string };
  if (!CURRENCIES.includes(to as Currency)) return failCur('UNSUPPORTED_CURRENCY') as { ok: false; error: string };
  const { data, error } = await g.sb.rpc('currency_switch_impact', { p_to: to });
  if (error) return failCur(error) as { ok: false; error: string };
  return { ok: true, impact: (data ?? {}) as Record<string, unknown> };
}

/** Admin: request a switch (maker). Finance approves it (checker). */
export async function requestSwitch(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('finance', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const to = str(fd, 'to');
  if (!CURRENCIES.includes(to as Currency)) return failCur('UNSUPPORTED_CURRENCY');
  const rate = parseRate(str(fd, 'rate'));
  if (!Number.isFinite(rate)) return failCur('INVALID_RATE');
  const wallet = str(fd, 'wallet_option');
  if (wallet !== 'keep' && wallet !== 'convert') return fail('Choose a wallet option.');
  let when: string | null = null;
  if (str(fd, 'timing') === 'scheduled') {
    const w = parseWhen(str(fd, 'effective_at_iso'));
    if (!w || w === 'invalid') return fail('Pick a valid effective date and time.');
    if (new Date(w).getTime() <= Date.now()) return fail('The scheduled time must be in the future.');
    when = w;
  }
  const { error } = await g.sb.rpc('request_currency_switch', {
    p_to: to, p_rate: rate, p_wallet_option: wallet, p_effective_at: when, p_note: str(fd, 'note') || null,
  });
  if (error) return failCur(error);
  revalidatePath('/admin/currency');
  return ok('Switch requested — a Finance user (not you) must approve it.');
}

/** Finance (not the requester): approve. Applies immediately when the effective time has passed. */
export async function approveSwitch(id: string): Promise<Result> {
  const g = await guard('finance', 'approve');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('approve_currency_switch', { p_id: id });
  if (error) return failCur(error);
  const { data } = await g.sb.from('currency_switch_requests').select('status, to_currency').eq('id', id).maybeSingle();
  revalidateCurrency();
  return ok(data?.status === 'applied' ? `Approved and applied — the platform now uses ${data.to_currency}.` : 'Approved — the switch is scheduled.');
}

export async function cancelSwitch(id: string, reason?: string): Promise<Result> {
  const g = await guard('finance', 'view');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('cancel_currency_switch', { p_id: id, p_reason: reason?.trim() || null });
  if (error) return failCur(error);
  revalidatePath('/admin/currency');
  return ok('Switch cancelled');
}
