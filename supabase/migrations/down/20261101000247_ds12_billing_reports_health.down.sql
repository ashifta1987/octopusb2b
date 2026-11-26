-- Down for 20261101000247_ds12_billing_reports_health.sql (Dropship Steps 12, 12b, 13).
-- Restores guard_saas_billing_settings_locked() EXACTLY as installed (pg_get_functiondef on staging before DS12; grants are
-- unchanged by create or replace), then drops what the up created: the cron job, the triggers on existing tables, the
-- functions, then the nine tables. Existing tables (saas_billing_settings, documents, journals, store_orders, …) are untouched.
-- Rows in the new tables are lost; issued OCT-DS plan invoices and their journals STAY (they live in the existing tables) —
-- run only within the first hour, per the release rules. The private storage bucket 'dropship-branding' and any logo in it are
-- storage data, not schema; they stay (remove them with the Storage API if needed). saas_billing_settings keeps whatever
-- values the switch wrote (it is data); with the original lock restored it can't be changed again until DS12 is re-applied.

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'octopus-dropship-billing') then
      perform cron.unschedule('octopus-dropship-billing');
    end if;
  end if;
end $$;

drop trigger if exists trg_ds12_plan_push on public.dropship_push_jobs;
drop trigger if exists trg_ds12_plan_store on public.store_connections;
drop trigger if exists trg_ds12_role_import_list on public.dropship_import_list;
drop trigger if exists trg_ds12_role_listings on public.dropship_listings;
drop trigger if exists trg_ds12_role_listing_variants on public.dropship_listing_variants;
drop trigger if exists trg_ds12_role_push_batches on public.dropship_push_batches;
drop trigger if exists trg_ds12_role_push_jobs on public.dropship_push_jobs;
drop trigger if exists trg_ds12_role_pricing on public.dropship_pricing_rules;
drop trigger if exists trg_ds12_role_price_approvals on public.dropship_price_approvals;
drop trigger if exists trg_ds12_role_packing on public.dropship_packing_settings;
drop trigger if exists trg_ds12_role_duty_modes on public.dropship_duty_modes;
drop trigger if exists trg_ds12_role_order_settings on public.dropship_order_settings;
drop trigger if exists trg_ds12_role_order_intake on public.dropship_order_intake;

-- restore the exact installed definition (migration 215)
CREATE OR REPLACE FUNCTION public.guard_saas_billing_settings_locked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'SAAS_BILLING_LOCKED: Plan fee settings can only be changed through the Step 12b two-person Finance switch';
end $function$;

drop function if exists public.ds_health_notify_merchant(uuid);
drop function if exists public.ds_health_dead_letter(text, uuid, text);
drop function if exists public.ds_health_retry(text, uuid);
drop function if exists public.ds_health_page();
drop function if exists public.ds12_health_can_view();
drop function if exists public.ds_brand_for_org(uuid);
drop function if exists public.ds_public_brand(text);
drop function if exists public.ds12_brand_json(uuid, text);
drop function if exists public.ds_close_dropshipping(text);
drop function if exists public.ds_export_rows(text);
drop function if exists public.ds_team_invite_accept(uuid);
drop function if exists public.ds_team_invites_for_me();
drop function if exists public.ds_team_invite_cancel(uuid);
drop function if exists public.ds_team_invite(text, text);
drop function if exists public.ds_team_remove(uuid);
drop function if exists public.ds_team_set_role(uuid, text);
drop function if exists public.ds_notification_prefs_save(jsonb);
drop function if exists public.ds_branding_set_logo(text);
drop function if exists public.ds_settings_save(jsonb);
drop function if exists public.ds_settings_page();
drop function if exists public.ds12_settings_org(boolean);
drop function if exists public.ds_dashboard();
drop function if exists public.ds_reports_csv(timestamptz, timestamptz, text);
drop function if exists public.ds_reports_page(timestamptz, timestamptz, text);
drop function if exists public.ds12_period_summary(uuid, timestamptz, timestamptz, text);
drop function if exists public.ds_report_orders(uuid, timestamptz, timestamptz, text);
drop function if exists public.saas_billing_page();
drop function if exists public.ds_plan_decide(uuid, boolean, text);
drop function if exists public.ds_plan_propose(text, jsonb, text);
drop function if exists public.saas_override_remove(uuid, text);
drop function if exists public.saas_override_set(uuid, text, integer, text);
drop function if exists public.saas_switch_withdraw();
drop function if exists public.saas_switch_decide(boolean, text);
drop function if exists public.saas_switch_propose(boolean, timestamptz, text);
drop function if exists public.ds_billing_choose_plan(text);
drop function if exists public.ds_billing_page();
drop function if exists public.ds_billing_jobs();
drop function if exists public.ds_billing_stop_all();
drop function if exists public.ds_billing_start_trials();
drop function if exists public.ds_billing_charge(uuid);
drop function if exists public.ds_billing_ensure(uuid);
drop function if exists public.ds_role_guard();
drop trigger if exists trg_ds12_override_guard on public.saas_billing_overrides;
drop function if exists public.saas_override_guard();
drop function if exists public.ds_plan_store_guard();
drop function if exists public.ds_plan_push_guard();
drop function if exists public.ds_plan_state(uuid);
drop function if exists public.ds_plan_live_products(uuid);
drop function if exists public.ds12_text_problem(text);
drop function if exists public.ds_notify(uuid, text, text, text, text, text);
drop function if exists public.ds_assert_role(uuid, text);
drop function if exists public.ds_role_allows(text, text);
drop function if exists public.ds_team_role(uuid, uuid);
drop function if exists public.ds12_usd(bigint);
drop function if exists public.saas_finance_can();
drop function if exists public.ds12_claims_role();

drop table if exists public.dropship_team_invites;
drop table if exists public.dropship_team_roles;
drop table if exists public.dropship_notification_prefs;
drop table if exists public.dropship_merchant_settings;
drop table if exists public.dropship_plan_charges;
drop table if exists public.dropship_plan_subscriptions;
drop table if exists public.saas_billing_overrides;
drop table if exists public.dropship_plan_changes;
drop table if exists public.dropship_plans;
