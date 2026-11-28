import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { requireCustomer, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dropshipEverEnabled, dropshipOn, getAccountContext, nowIso, serviceOn } from '@/lib/core/account';
import { countWaiting, listWaiting, type WaitingActionItem } from '@/lib/core/waiting';
import { newQuoteCount } from '@/components/account/sourcing-data';
import { dueNow } from '@/components/account/order-utils';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { EARLY_ACCESS_DEFAULTS } from '@/lib/dropship-features-shared';
import { buildDropshipChildren } from './dropship-nav';
import { getSiteData } from '@/lib/ods-site';
import { ACCOUNT_SERVICES, type AccountServiceId } from './nav';
import {
  ACTIVE_ORDER_STATUSES, OPEN_REQUEST_STATUSES, WAITING_SERVICE_LABEL, centsToAmount, dueText, kycState,
  orderNextStep, orderStatusName, requestNextStep, requestStatusName,
} from './status';
import type {
  AccountFrameData, InProgressRow, ManagerView, NewCustomerView, ServiceTileView, VerificationView, WaitingRowView, WalletView,
} from './types';

/**
 * ODS T6 · My account data loaders (server only; call them inside <Suspense> — they read the session).
 * Reuse today's data layer unchanged: requireCustomer (lib/auth), getAccountContext (lib/core/account: company_services,
 * my_wallet_summary, my_account_team, my_notifications unread), countWaiting/listWaiting (lib/core/waiting),
 * newQuoteCount (components/account/sourcing-data), dueNow (components/account/order-utils — today's "amount payable
 * now"), isDropshipV2UiEnabled (lib/dropship), getSiteData (lib/ods-site, site_settings). All reads are under RLS (the
 * company's own rows). White-label: only customer-safe columns (codes, titles, statuses, amounts the customer pays).
 *
 * API (stable — other My account builders may import these):
 *  - `requireAccount(next = '/account')` → Session   today's guard: signed out → /login?next, staff → /admin,
 *                                                     no company yet → onboarding. React-cached per request.
 *  - `getAccountCtx()`                  → getAccountContext() of the signed-in company, React-cached per request.
 *  - `getAccountFrameData()`            → AccountFrameData   user, company, counts (Action needed = countWaiting,
 *                                          Sourcing requests = new quotes, Orders = orders waiting for payment),
 *                                          unread notifications, which services are started, the Dropshipping
 *                                          sub-items (T7, ./dropship-nav). Never throws (counts fall
 *                                          back to 0) except the guard redirects.
 *  - `loadWaiting(limit = 50)`          → { rows: WaitingRowView[]; items: WaitingActionItem[] }   throws when it can't load
 *  - `loadWallet()`                     → WalletView      throws when the wallet summary can't load
 *  - `loadServices()`                   → { tiles: ServiceTileView[]; newCustomer: NewCustomerView | null }
 *  - `loadInProgress(limit = 6)`        → InProgressRow[]  active orders + open requests, newest first
 *  - `loadManager()`                    → ManagerView      name from my_account_team(); replyTime from site_reply_time
 *  - `loadVerification()`               → VerificationView organizations.kyc_status + latest kyc_submissions message
 *  - `settle(fn)`                       → { ok: true, data } | { ok: false }   runs a loader for ONE panel; redirects /
 *                                          Next control-flow errors are re-thrown (unstable_rethrow), anything else = the
 *                                          panel's error state
 *  - `toWaitingRow(item, nowIso)`       pure mapper WaitingActionItem → WaitingRowView (exported for the fixtures/tests)
 * site_settings keys read: site_reply_time (string, e.g. "within one business day"; empty → the reply time is omitted).
 */

export async function settle<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    console.error('[ods/account] panel failed:', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

export const requireAccount = cache((next: string = '/account'): Promise<Session> => requireCustomer(next));

export const getAccountCtx = cache(async () => {
  const s = await requireAccount();
  return getAccountContext(s.org!.id);
});

const PAY_STATUSES = ['pi_issued', 'deposit_pending', 'balance_pending'];

async function headCount(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  } catch {
    return 0;
  }
}

/** Counts used by the frame and by Home: rfqs, turnkey projects, orders (all head counts). */
const getCompanyCounts = cache(async () => {
  const s = await requireAccount();
  const org = s.org!.id;
  const sb = await createClient();
  const [rfqs, turnkey, ordersAll, ordersToPay] = await Promise.all([
    headCount(sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', org)),
    headCount(sb.from('tk_client_projects').select('id', { count: 'exact', head: true }).eq('org_id', org)),
    headCount(sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', org)),
    headCount(sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', org).in('status', PAY_STATUSES)),
  ]);
  return { rfqs, turnkey, ordersAll, ordersToPay };
});

const EMPTY_STARTED: Record<AccountServiceId, boolean> = { sourcing: false, turnkey: false, warehouse: false, shipping: false, brand: false, dropship: false };

export const getAccountFrameData = cache(async (): Promise<AccountFrameData> => {
  const s = await requireAccount();
  const org = s.org!;
  const [ctx, counts, action, newQuotes, dropshipV2, dropshipFeatures] = await Promise.all([
    getAccountCtx().catch(() => null),
    getCompanyCounts(),
    countWaiting(org.id, nowIso()).catch(() => 0),
    newQuoteCount(org.id).catch(() => 0),
    // T7: same inputs as today's app/account/layout.tsx → AccountShell → AccountShellSwitcher / DropshipMerchantShell
    isDropshipV2UiEnabled().catch(() => false),
    getDropshipFeatures().catch(() => EARLY_ACCESS_DEFAULTS),
  ]);
  const started = ctx
    ? {
        sourcing: serviceOn(ctx.services.sourcing) || counts.rfqs > 0,
        turnkey: counts.turnkey > 0,
        warehouse: serviceOn(ctx.services.warehouse),
        shipping: serviceOn(ctx.services.warehouse),
        brand: serviceOn(ctx.services.brand),
        dropship: dropshipEverEnabled(ctx.services.dropship),
      }
    : { ...EMPTY_STARTED, sourcing: counts.rfqs > 0, turnkey: counts.turnkey > 0 };
  return {
    user: { name: s.profile?.full_name?.trim() || s.email || 'You', email: s.email },
    company: { id: org.id, name: org.name },
    // one login = one company today (org_members … limit 1): the switcher shows only with more than one entry
    companies: [{ id: org.id, name: org.name }],
    counts: { action, requests: newQuotes, orders: counts.ordersToPay },
    unread: ctx?.unread ?? 0,
    started,
    dropshipChildren: buildDropshipChildren({
      v2: Boolean(dropshipV2),
      enabled: Boolean(ctx && dropshipEverEnabled(ctx.services.dropship)),
      features: dropshipFeatures,
    }),
  };
});

/* ───────── Home panels ───────── */

export function toWaitingRow(i: WaitingActionItem, now: string): WaitingRowView {
  return {
    id: i.key,
    type: i.type,
    service: WAITING_SERVICE_LABEL[i.service],
    ref: i.ref,
    what: i.what,
    detail: i.body,
    due: dueText(i.dueAt, now, i.type),
    action: i.action,
    href: i.odsHref,
  };
}

export async function loadWaiting(limit = 50): Promise<{ rows: WaitingRowView[]; items: WaitingActionItem[] }> {
  const s = await requireAccount();
  const now = nowIso();
  const items = await listWaiting(s.org!.id, now, limit);
  return { items, rows: items.map((i) => toWaitingRow(i, now)) };
}

export async function loadWallet(): Promise<WalletView> {
  const s = await requireAccount();
  const sb = await createClient();
  const [ctx, orders] = await Promise.all([
    getAccountCtx(),
    sb.from('orders').select('status, total_cents, deposit_cents, paid_cents').eq('org_id', s.org!.id).in('status', PAY_STATUSES).limit(200),
  ]);
  const w = ctx.wallet;
  if (!w) throw new Error('Wallet summary not available.');
  const invoicesDue = orders.error
    ? null
    : (orders.data ?? []).reduce((sum, o) => {
        const d = dueNow({ status: String(o.status), total_cents: Number(o.total_cents ?? 0), deposit_cents: Number(o.deposit_cents ?? 0), paid_cents: Number(o.paid_cents ?? 0) });
        return sum + (d?.amount ?? 0);
      }, 0);
  return {
    available: centsToAmount(w.available_cents),
    held: centsToAmount(w.on_hold_cents),
    invoicesDue: invoicesDue === null ? null : centsToAmount(invoicesDue),
    pendingTransfers: centsToAmount(w.pending_transfers_cents),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export async function loadServices(): Promise<{ tiles: ServiceTileView[]; newCustomer: NewCustomerView | null }> {
  const s = await requireAccount();
  const org = s.org!;
  const sb = await createClient();
  const [ctx, counts, rfqs, v2Ui] = await Promise.all([
    getAccountCtx(),
    getCompanyCounts(),
    sb.from('rfqs').select('status').eq('org_id', org.id).in('status', [...OPEN_REQUEST_STATUSES]).limit(500),
    isDropshipV2UiEnabled().catch(() => false),
  ]);
  if (rfqs.error) throw new Error('Could not load the requests.');
  const open = (rfqs.data ?? []).length;
  const ready = (rfqs.data ?? []).filter((r) => r.status === 'quoted').length;
  const svc = ctx.services;
  const tile = (id: AccountServiceId, status: ServiceTileView['status'], summary: string): ServiceTileView => ({
    id,
    name: ACCOUNT_SERVICES[id].name,
    status,
    summary,
    href: status === 'on' || status === 'paused' ? ACCOUNT_SERVICES[id].page : ACCOUNT_SERVICES[id].start,
  });
  const sourcingOn = serviceOn(svc.sourcing) || counts.rfqs > 0;
  const whOn = serviceOn(svc.warehouse);
  const tiles: ServiceTileView[] = [
    sourcingOn
      ? tile('sourcing', 'on', `${plural(open, 'open request')} · ${plural(ready, 'quote')} ready`)
      : tile('sourcing', svc.sourcing.status === 'paused' ? 'paused' : 'not-started', 'Send one request and get quotes from verified factories.'),
    counts.turnkey > 0 ? tile('turnkey', 'on', plural(counts.turnkey, 'project')) : tile('turnkey', 'not-started', 'Plan a full project: design, factories, quality checks and shipping.'),
    whOn
      ? tile('warehouse', 'on', `Switched on${svc.warehouse.plan ? ` · ${svc.warehouse.plan}` : ''}`)
      : tile('warehouse', svc.warehouse.status === 'paused' ? 'paused' : 'not-started', svc.warehouse.status === 'paused' ? 'Paused' : 'Store stock with us; we ship it when you sell.'),
    whOn ? tile('shipping', 'on', 'Parcels and tracking from your warehouse') : tile('shipping', 'not-started', 'Comes with Warehouse (3PL).'),
    serviceOn(svc.brand)
      ? tile('brand', 'on', `Switched on${svc.brand.plan ? ` · ${svc.brand.plan}` : ''}`)
      : tile('brand', svc.brand.status === 'paused' ? 'paused' : 'not-started', svc.brand.status === 'paused' ? 'Paused' : 'Put your own brand on verified-supplier products.'),
    dropshipOn(svc.dropship)
      ? tile('dropship', 'on', 'Switched on')
      : dropshipEverEnabled(svc.dropship)
        ? tile('dropship', 'paused', 'Paused')
        : v2Ui
          ? tile('dropship', 'not-started', 'Not started · Request access')
          : tile('dropship', 'soon', 'Opening soon · Get notified'),
  ];
  const brandNew = ctx.onCount === 0 && counts.rfqs === 0 && counts.turnkey === 0 && counts.ordersAll === 0;
  return { tiles, newCustomer: brandNew ? { companyDone: Boolean(org.country), kyc: kycState(org.kyc_status) } : null };
}

export async function loadInProgress(limit = 6): Promise<InProgressRow[]> {
  const s = await requireAccount();
  const sb = await createClient();
  const [orders, rfqs] = await Promise.all([
    sb.from('orders').select('id, code, title, status, updated_at').eq('org_id', s.org!.id).in('status', [...ACTIVE_ORDER_STATUSES]).order('updated_at', { ascending: false }).limit(limit),
    sb.from('rfqs').select('id, code, title, status, created_at').eq('org_id', s.org!.id).in('status', [...OPEN_REQUEST_STATUSES]).order('created_at', { ascending: false }).limit(limit),
  ]);
  if (orders.error || rfqs.error) throw new Error('Could not load the work in progress.');
  const rows: (InProgressRow & { at: string })[] = [
    ...(orders.data ?? []).map((o) => ({
      id: `o-${o.id}`, ref: String(o.code), title: (o.title as string | null) ?? null, href: `/account/orders/${o.id}`, service: 'Sourcing',
      status: orderStatusName(String(o.status)), nextStep: orderNextStep(String(o.status)), at: String(o.updated_at),
    })),
    ...(rfqs.data ?? []).map((r) => ({
      id: `r-${r.id}`, ref: String(r.code), title: (r.title as string | null) ?? null, href: `/account/requests/${r.code}`, service: 'Sourcing',
      status: requestStatusName(String(r.status)), nextStep: requestNextStep(String(r.status)), at: String(r.created_at),
    })),
  ];
  return rows
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((r) => ({ id: r.id, ref: r.ref, title: r.title, href: r.href, service: r.service, status: r.status, nextStep: r.nextStep }));
}

export async function loadManager(): Promise<ManagerView> {
  const [ctx, site] = await Promise.all([getAccountCtx(), getSiteData().catch(() => null)]);
  return { name: ctx.manager?.name ?? null, title: ctx.manager?.title ?? null, replyTime: site?.settings.replyTime ?? null };
}

export async function loadVerification(): Promise<VerificationView> {
  const s = await requireAccount();
  const sb = await createClient();
  const { data, error } = await sb.from('kyc_submissions').select('status, customer_message').eq('org_id', s.org!.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
  const state = !error && data?.status === 'more_info' ? 'more_info' : kycState(s.org!.kyc_status);
  return { state, message: state === 'more_info' ? ((data?.customer_message as string | null)?.trim() || null) : null };
}
