/** ODS T4 · MOQ pools — shared prop types (pure, no 'use client'). */

/**
 * What the join panel shows for this company (same checks and order as today's JoinPanel on /pool/[code]):
 *  - open:    the join form;
 *  - mine:    the company already has a pledge in this pool (qty + pledge status);
 *  - full:    filled, or the buyer cap is reached ("This pool is full" + Notify me);
 *  - closed:  past its deadline / expired / cancelled ("This pool has closed" + Notify me);
 *  - blocked: can't join for a reason shown next to the disabled button (pools paused, currency, viewer role).
 */
export type JoinState =
  | { kind: 'open' }
  | { kind: 'mine'; qty: number; status: string }
  | { kind: 'full'; reason?: string }
  | { kind: 'closed' }
  | { kind: 'blocked'; reason: string };

/** Today's \"Get notified when a pool opens\" (app/(store)/pools/actions.ts subscribePoolAlerts) — or a fixture stand-in. */
export type NotifyAction = (email: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
