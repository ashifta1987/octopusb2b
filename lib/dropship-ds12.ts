import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Octopus Dropship · Release 5 · Steps 12, 12b, 13 — data loaders. Every screen reads through ONE SECURITY DEFINER RPC of
 * migration *_ds12_billing_reports_health (own organisation via auth.uid(); staff RPCs check the staff permission):
 * ds_billing_page, ds_reports_page, ds_dashboard, ds_settings_page, saas_billing_page, ds_health_page.
 * Money is integer US cents; unknown values stay null (never 0).
 */

export type PlanStatus = 'free' | 'none' | 'trial' | 'active' | 'grace' | 'paused' | 'free_forever' | 'cancelled';

export type PlanState = {
  billing_enabled: boolean;
  scheduled_start: string | null;
  trial_days: number;
  grace_days: number;
  status: PlanStatus;
  free_forever: boolean;
  extra_trial_days: number | null;
  limits_apply: boolean;
  channel: 'wallet' | 'shopify';
  plan_code: string | null;
  plan_name: string | null;
  plan_price_cents: number | null;
  plan_approved: boolean;
  live_products_limit: number | null;
  stores_limit: number | null;
  orders_month_limit: number | null;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  trial_used: boolean;
  grace_ends_at: string | null;
  current_period_end: string | null;
  last_charge_error: string | null;
  usage: { live_products: number; stores: number; orders_month: number };
};

export type PlanRow = {
  code: string; name: string; description: string | null; price_cents: number | null;
  live_products_limit: number | null; stores_limit: number | null; orders_month_limit: number | null;
  features: string[]; over_limit: number;
};

export type BillingDoc = {
  id: string; number: string; created_at: string; doc_type: 'commercial_invoice' | 'statement' | 'credit_note';
  amount_cents: number | null; status: string | null; kind: string | null;
};

export type BillingPageData = PlanState & {
  dropship_status: 'on' | 'paused' | 'off';
  my_role: 'owner' | 'manager' | 'support' | null;
  plans: PlanRow[];
  issuer: string | null;
  documents: BillingDoc[];
};

export type PeriodSummary = {
  orders: number; sales_cents: number; orders_without_price: number; costs_cents: number; profit_cents: number;
  product_cents: number; processing_cents: number; shipping_cents: number; duties_cents: number; refunds_cents: number;
  refunded_orders: number; refund_rate_bp: number | null; avg_delivery_days: number | null; delivered_orders: number;
};

export type TopProduct = {
  product_id: string; title: string; model_no: string; units: number | null; sales_cents: number | null; costs_cents: number | null;
  refunds: number; avg_delivery_days: number | null;
};

export type ReportsPageData = {
  from: string; to: string; country: string | null;
  current: PeriodSummary; previous: PeriodSummary;
  delivery_route: { country: string | null; method: string | null } | null;
  countries: string[];
  stores: { id: string; shop_domain: string }[];
  weeks: { week_start: string; profit_cents: number; orders: number }[];
  top_products: TopProduct[];
};

export type ReportCsvRow = {
  store_order_id: string; order_number: string; external_order_name: string | null; created_at: string; country: string | null;
  shipping_method: string | null; buyer_currency: string | null; fx_rate_to_usd: number | string | null; sales_usd_cents: number | null;
  product_cents: number; processing_cents: number; shipping_cents: number; duties_cents: number; refunds_cents: number; costs_cents: number;
  profit_cents: number | null; refunded: boolean; full_refund: boolean; delivered_at: string | null; shipped_at: string | null;
  delivery_days: number | string | null;
};

export type AttentionItem =
  | { kind: 'to_pay'; order: string; amount_cents: number; wallet_cents: number; href: string }
  | { kind: 'plan_grace' | 'plan_paused'; until: string | null; href: string }
  | { kind: 'plan_trial'; days: number; href: string }
  | { kind: 'hold_high_risk' | 'hold_address' | 'hold_stock_shortage' | 'hold_duty_unknown'; order: string; message: string | null; href: string }
  | { kind: 'rate_unmapped'; rate_name: string; href: string }
  | { kind: 'push_failed'; count: number; href: string }
  | { kind: 'margin'; product: string | null; href: string }
  | { kind: 'cost_up'; count: number; href: string };

export type DashboardData = {
  dropship_status: 'on' | 'paused' | 'off';
  current: PeriodSummary; previous: PeriodSummary;
  attention: AttentionItem[];
  recent_orders: {
    id: string; order_ref: string; created_at: string; total_cents: number | null; merchant_status: string; payment_state: string;
    hold_code: string | null; expired_at: string | null; cancelled_at: string | null; buyer: string | null; country: string | null;
    first_item: string | null; more_items: number;
  }[];
  wallet: { available_cents: number; held_cents: number; waiting_orders: number; waiting_cents: number; low: boolean };
  sync: { store: { shop_domain: string; status: string } | null; needs_reconnect: boolean; last_order_at: string | null; last_sync_at: string | null; failed_pushes: number };
  plan: PlanState;
};

export type NotificationEvent = 'new_order' | 'awaiting_payment' | 'on_hold' | 'wallet_low' | 'out_of_stock' | 'cost_changed' | 'push_failed' | 'store_reconnect';

export type SettingsPageData = {
  dropship_status: 'on' | 'paused' | 'off';
  my_role: 'owner' | 'manager' | 'support' | null;
  me: string;
  org: { name: string; country: string | null };
  profile: { time_zone: string; display_currency: 'USD' };
  team: { user_id: string; name: string | null; email: string | null; ds_role: 'owner' | 'manager' | 'support'; is_me: boolean }[];
  invites: { id: string; email: string; ds_role: 'manager' | 'support'; expires_at: string }[];
  prefs: { event: NotificationEvent; email: boolean; in_app: boolean }[];
  branding: { brand_name: string | null; profile_status: string | null; has_logo: boolean; logo_path: string | null; show_logo_slip: boolean; show_logo_tracking: boolean };
  policies: { returns_policy: string | null; support_email: string | null };
  buyer_data_days: number | null;
};

export type SaasPageData = {
  can_decide: boolean;
  me: string;
  settings: {
    enabled: boolean; enabled_at: string | null; scheduled_start: string | null; trial_days: number; grace_days: number;
    trial_start_mode: string; one_trial_per_org: boolean; pending_enabled: boolean | null; pending_scheduled_start: string | null;
    proposal_reason: string | null; proposed_by: string | null; proposed_by_name: string | null; proposed_at: string | null;
    approved_by_name: string | null; approved_at: string | null; updated_at: string;
  };
  counts: { merchants: number; free_off: number; trial: number; paying: number; grace: number; paused: number; free_forever: number };
  merchants: {
    org_id: string; name: string; credit_eligible: boolean; plan_name: string | null; status: PlanStatus; override: 'free_forever' | 'extra_trial' | null;
    extra_trial_days: number | null; reason: string | null; set_by_name: string | null; set_at: string | null;
  }[];
  plans: {
    code: string; name: string; description: string | null; price_cents: number | null; live_products_limit: number | null; stores_limit: number | null;
    orders_month_limit: number | null; features: string[]; sort_order: number; active: boolean;
  }[];
  plan_changes: { id: string; plan_code: string; proposal: Record<string, unknown>; reason: string; proposed_by: string | null; proposed_by_name: string | null; proposed_at: string }[];
  history: { action: string; created_at: string; details: Record<string, unknown> | null; actor_name: string | null }[];
};

export type HealthJob = {
  name: string; schedule: string; active: boolean; last_start: string | null; last_end: string | null; last_status: string | null;
  last_message: string | null; failed_24h: number;
};

export type HealthPageData = {
  can_act: boolean;
  checked_at: string;
  domain_events: { pending: number; retry: number; dead: number; oldest_pending: string | null; processed_24h: number };
  outbox: { pending: number; failed: number; dead: number; oldest_pending: string | null };
  failed: { kind: 'domain_event' | 'outbox' | 'push_job'; id: string; at: string; job: string; merchant: string | null; reason: string; attempts: number; status: string }[];
  webhooks: { store_failed: { source: string; topic: string | null; received_at: string; attempts: number; error: string }[]; payment_unprocessed: number; store_received_24h: number };
  token_failures: { id: string; merchant: string; shop_domain: string; reason: string | null; at: string }[];
  stores_active: number;
  sync_errors: { at: string; merchant: string; kind: string; change: string; result: string }[];
  links_failed: number;
  carrier_last_event: string | null;
  cron_readable: boolean;
  jobs: HealthJob[];
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getBillingPage = () => call<BillingPageData>('ds_billing_page');
export const getDashboard = () => call<DashboardData>('ds_dashboard');
export const getSettingsPage = () => call<SettingsPageData>('ds_settings_page');
export const getSaasPage = () => call<SaasPageData>('saas_billing_page');
export const getHealthPage = () => call<HealthPageData>('ds_health_page');
export const getReportsPage = (from: string, to: string, country: string | null) =>
  call<ReportsPageData>('ds_reports_page', { p_from: from, p_to: to, p_country: country });
export const getReportsCsv = (from: string, to: string, country: string | null) =>
  call<ReportCsvRow[]>('ds_reports_csv', { p_from: from, p_to: to, p_country: country });
export const getInvitesForMe = () => call<{ id: string; company: string; ds_role: 'manager' | 'support'; expires_at: string }[]>('ds_team_invites_for_me');
