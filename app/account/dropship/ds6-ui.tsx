'use client';

import { useRouter } from 'next/navigation';
import { DsBadge, DsChip } from '@/components/dropship-ui';
import { pct } from '@/lib/dropship-pricing';
import type { Problem } from '@/lib/dropship-ds6';

/** Release 2 · Step 6 — small shared pieces of the import / push / pushed screens. */

const SHORT: Record<string, string> = {
  OUT_OF_STOCK: 'Out of stock',
  NEEDS_FX: 'No exchange rate yet',
  DUTY_UNKNOWN: 'Duties not known yet',
  RULES_NOT_SAVED: 'Save your pricing rule',
  TEXT_CHECK: 'Check the text',
  NO_RATE_SET: 'No shipping rate yet',
  WEIGHT_SIZE_MISSING: 'Being measured',
  NO_FEE_VERSION: 'Fees not set yet',
  RESTRICTED_ITEM: 'Method can\u2019t carry it',
  NO_MARKET: 'Choose selling countries',
  NOT_AVAILABLE: 'Not available',
  NO_RULE: 'No price yet',
  NO_PRICE: 'No price yet',
};

export function problemShort(code: string) {
  return SHORT[code] ?? 'Can\u2019t price yet';
}

/** Ready / Below minimum / the first blocking reason — with icon AND words, and the full sentence under it */
export function RowStatus({ ready, problems, minProfitBp, testId }: { ready: boolean; problems: Problem[]; minProfitBp: number; testId?: string }) {
  const blocking = problems.find((p) => p.blocking);
  const below = problems.find((p) => p.code === 'BELOW_MIN');
  if (blocking) {
    return (
      <span className="inline-flex flex-col gap-1" data-testid={testId}>
        <DsBadge tone={blocking.code === 'OUT_OF_STOCK' ? 'bad' : 'warn'}>{problemShort(blocking.code)}</DsBadge>
        <span className="text-[12px] text-muted max-w-[260px]">{blocking.message}</span>
      </span>
    );
  }
  if (ready && below) return <DsBadge tone="warn" testId={testId}>{`Below ${pct(minProfitBp)} minimum`}</DsBadge>;
  return <DsBadge tone="ok" testId={testId}>Ready</DsBadge>;
}

/** Import list (n) · Pushed (n) · Failed (n) — the chips at the top of the import and pushed screens */
export function Ds6Chips({ current, counts }: { current: 'import' | 'pushed' | 'failed'; counts: { import: number; pushed: number; failed: number } }) {
  const router = useRouter();
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label="Product lists" data-testid="ds6-chips">
      <DsChip pressed={current === 'import'} onClick={() => router.push('/account/dropship/catalogue?list=1')} testId="chip-import">{`Import list (${counts.import})`}</DsChip>
      <DsChip pressed={current === 'pushed'} onClick={() => router.push('/account/dropship/pushed')} testId="chip-pushed">{`Pushed (${counts.pushed})`}</DsChip>
      <DsChip pressed={current === 'failed'} onClick={() => router.push('/account/dropship/pushed?f=failed')} testId="chip-failed">{`Failed (${counts.failed})`}</DsChip>
    </div>
  );
}

export const newRequestKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

export const optionText = (options: Record<string, string> | null | undefined) =>
  Object.values(options ?? {}).filter(Boolean).join(' / ') || 'Default';

/** absolute UTC time (same on the server and in the browser, so no hydration mismatch) */
export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
