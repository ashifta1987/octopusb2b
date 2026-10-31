-- Octopus B2B — Admin area (P3 CMS, P5 admin, P7 finance, P8). Forward-only.
-- Master switches, legal publishing guard, terms publishing, campaign moderation, outbox retry,
-- audit triggers for admin-edited tables and read-only reporting functions.

-- ───────────────────────── Master switches / settings ─────────────────────────
create or replace function set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(trim(p_key)) = 0 then raise exception 'INVALID_KEY'; end if;
  select value into v_old from site_settings where key = p_key for update;
  if not found then
    insert into site_settings(key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now());
  else
    update site_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  end if;
  perform write_audit('setting.update', 'site_settings', p_key, jsonb_build_object('old', v_old, 'new', p_value));
end $$;

-- ───────────────────────── Legal publishing guard (SPEC §3: content editors never publish legal pages) ─────────────────────────
create or replace function guard_legal_publish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') or is_admin() then return new; end if;
  if tg_table_name = 'terms_versions' then
    if new.status not in ('draft','in_review') then raise exception 'PUBLISH_NEEDS_ADMIN'; end if;
    if tg_op = 'UPDATE' and old.status not in ('draft','in_review') then raise exception 'PUBLISH_NEEDS_ADMIN'; end if;
    if tg_op = 'UPDATE' and new.publish_at is distinct from old.publish_at then raise exception 'PUBLISH_NEEDS_ADMIN'; end if;
  elsif tg_table_name = 'pages' then
    if tg_op = 'UPDATE' and new.is_legal is distinct from old.is_legal then raise exception 'PUBLISH_NEEDS_ADMIN'; end if;
    if new.is_legal then
      if new.status in ('published','scheduled') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
        raise exception 'PUBLISH_NEEDS_ADMIN';
      end if;
      -- a live legal page may only be changed by an admin (editors submit a proposal instead)
      if tg_op = 'UPDATE' and old.status in ('published','scheduled')
         and (new.body is distinct from old.body or new.title is distinct from old.title or new.status is distinct from old.status) then
        raise exception 'PUBLISH_NEEDS_ADMIN';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_terms_publish on terms_versions;
create trigger trg_guard_terms_publish before insert or update on terms_versions for each row execute function guard_legal_publish();
drop trigger if exists trg_guard_pages_publish on pages;
create trigger trg_guard_pages_publish before insert or update on pages for each row execute function guard_legal_publish();

-- Publish now (supersedes the current version) or schedule for publish_at (job_publish_scheduled_terms picks it up).
create or replace function publish_terms(p_id uuid, p_publish_at timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not is_admin() then raise exception 'PUBLISH_NEEDS_ADMIN'; end if;
  select * into t from terms_versions where id = p_id for update;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if t.status not in ('draft','in_review','scheduled') then raise exception 'INVALID_TRANSITION: %', t.status; end if;
  if jsonb_array_length(coalesce(t.sections,'[]'::jsonb)) <> 15 then raise exception 'TERMS_NEED_15_SECTIONS'; end if;
  if p_publish_at is not null and p_publish_at > now() then
    update terms_versions set status = 'scheduled', publish_at = p_publish_at, reviewed_by = auth.uid() where id = p_id;
    perform log_status('terms', p_id, t.status::text, 'scheduled');
    perform write_audit('terms.schedule', 'terms_versions', p_id::text, jsonb_build_object('version', t.version, 'publish_at', p_publish_at));
    return 'scheduled';
  end if;
  update terms_versions set status = 'superseded' where status = 'published' and id <> p_id;
  update terms_versions set status = 'published', published_at = now(), publish_at = null, reviewed_by = auth.uid() where id = p_id;
  insert into content_versions(entity, entity_id, snapshot, created_by)
    values ('terms', p_id::text, jsonb_build_object('version', t.version, 'sections', t.sections, 'status', 'published'), auth.uid());
  perform log_status('terms', p_id, t.status::text, 'published');
  perform write_audit('terms.publish', 'terms_versions', p_id::text, jsonb_build_object('version', t.version));
  perform emit_event('terms.published', 'terms', p_id, jsonb_build_object('version', t.version));
  return 'published';
end $$;

-- ───────────────────────── Ad campaign moderation (SPEC §5: draft → in_review → active → paused → ended / rejected) ─────────────────────────
create or replace function transition_campaign(p_id uuid, p_to campaign_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c record; ok boolean;
begin
  if not can('ads','edit') then raise exception 'FORBIDDEN'; end if;
  select * into c from ad_campaigns where id = p_id for update;
  if c is null then raise exception 'NOT_FOUND'; end if;
  ok := (c.status, p_to) in (('draft','in_review'),('in_review','active'),('in_review','rejected'),('active','paused'),
        ('paused','active'),('active','ended'),('paused','ended'),('rejected','in_review'));
  if not ok then raise exception 'INVALID_TRANSITION: % → %', c.status, p_to; end if;
  if p_to = 'rejected' and coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  update ad_campaigns set status = p_to, rejection_reason = case when p_to = 'rejected' then p_reason else null end where id = p_id;
  perform log_status('ad_campaign', p_id, c.status::text, p_to::text, p_reason);
  perform write_audit('ads.' || p_to, 'ad_campaigns', p_id::text, jsonb_build_object('from', c.status, 'reason', p_reason));
  perform emit_event('ad_campaign.' || p_to, 'ad_campaign', p_id, jsonb_build_object('org_id', c.org_id));
end $$;

-- ───────────────────────── Outbox: dead-letter retry (SPEC §10.2) ─────────────────────────
create or replace function retry_outbox(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not can('integrations','edit') then raise exception 'FORBIDDEN'; end if;
  select * into e from outbox_events where id = p_id for update;
  if e is null then raise exception 'NOT_FOUND'; end if;
  if e.status not in ('failed','dead') then raise exception 'INVALID_TRANSITION: %', e.status; end if;
  update outbox_events set status = 'pending', attempts = 0, last_error = null, available_at = now() where id = p_id;
  perform write_audit('outbox.retry', 'outbox_events', p_id::text, jsonb_build_object('event', e.event_type, 'was', e.status));
end $$;

-- ───────────────────────── Integration test result (status + log row) ─────────────────────────
create or replace function record_integration_test(p_code text, p_ok boolean, p_summary text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can('integrations','edit') then raise exception 'FORBIDDEN'; end if;
  update integrations set last_tested_at = now(), status = case when p_ok then 'connected' else 'error' end, updated_at = now() where code = p_code;
  insert into integration_logs(integration_code, direction, status, summary) values (p_code, 'test', case when p_ok then 200 else 500 end, left(p_summary, 500));
  perform write_audit('integration.test', 'integrations', p_code, jsonb_build_object('ok', p_ok));
end $$;

-- ───────────────────────── Audit triggers for admin-edited tables (audit_log is append-only, clients cannot insert) ─────────────────────────
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_details jsonb;
begin
  if tg_op = 'DELETE' then
    v_details := jsonb_build_object('old', to_jsonb(old));
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'code', to_jsonb(old)->>'key', '');
  elsif tg_op = 'INSERT' then
    v_details := jsonb_build_object('new', to_jsonb(new));
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'code', to_jsonb(new)->>'key', '');
  else
    v_details := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'code', to_jsonb(new)->>'key', '');
  end if;
  -- composite keys
  if tg_table_name = 'role_permissions' then v_id := coalesce(to_jsonb(coalesce(new, old))->>'role_code','') || ':' || coalesce(to_jsonb(coalesce(new, old))->>'area','') || ':' || coalesce(to_jsonb(coalesce(new, old))->>'action',''); end if;
  if tg_table_name = 'user_roles' then v_id := coalesce(to_jsonb(coalesce(new, old))->>'user_id','') || ':' || coalesce(to_jsonb(coalesce(new, old))->>'role_code',''); end if;
  if tg_table_name = 'distributor_suppliers' then v_id := coalesce(to_jsonb(coalesce(new, old))->>'distributor_id','') || ':' || coalesce(to_jsonb(coalesce(new, old))->>'supplier_id',''); end if;
  if tg_table_name = 'supplier_switches' then v_id := coalesce(to_jsonb(coalesce(new, old))->>'supplier_id',''); end if;
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_id, v_details);
  return coalesce(new, old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['service_prices','services','role_permissions','user_roles','ad_placements','company_profile','branches',
                           'integrations','suppliers','supplier_switches','distributor_suppliers','content_blocks','pages'] loop
    execute format('drop trigger if exists trg_audit_%1$s on %1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row_change()', t);
  end loop;
end $$;
drop trigger if exists trg_audit_profiles_active on profiles;
create trigger trg_audit_profiles_active after update on profiles for each row
  when (old.active is distinct from new.active or old.totp_required is distinct from new.totp_required)
  execute function audit_row_change();

-- ───────────────────────── Reporting (read-only, permission-checked) ─────────────────────────
create or replace function admin_wallet_balances()
returns table(org_id uuid, org_name text, country text, kyc_status kyc_status, balance_cents bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can('wallet','view') or can('finance','view')) then raise exception 'FORBIDDEN'; end if;
  return query
    select o.id, o.name, o.country, o.kyc_status,
           coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint,
           max(le.created_at)
    from ledger_accounts la
    join organizations o on o.id = la.org_id
    left join ledger_entries le on le.account_id = la.id
    where la.code like 'wallet:%'
    group by o.id, o.name, o.country, o.kyc_status
    order by 5 desc;
end $$;

create or replace function admin_revenue_by_stream(p_from timestamptz default null, p_to timestamptz default null)
returns table(month date, stream text, credit_cents bigint, debit_cents bigint, net_cents bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can('finance','view') or can('dashboard','view')) then raise exception 'FORBIDDEN'; end if;
  return query
    select date_trunc('month', j.created_at)::date, coalesce(j.stream, replace(la.code, 'rev:', '')),
           sum(le.credit_cents)::bigint, sum(le.debit_cents)::bigint, sum(le.credit_cents - le.debit_cents)::bigint
    from ledger_entries le
    join ledger_accounts la on la.id = le.account_id and la.kind = 'revenue'
    join journals j on j.id = le.journal_id
    where (p_from is null or j.created_at >= p_from) and (p_to is null or j.created_at < p_to)
    group by 1, 2
    order by 1 desc, 5 desc;
end $$;

create or replace function admin_ledger_check()
returns table(total_debit bigint, total_credit bigint, journals bigint, unbalanced_journals bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can('finance','view') then raise exception 'FORBIDDEN'; end if;
  return query
    select (select coalesce(sum(debit_cents),0) from ledger_entries)::bigint,
           (select coalesce(sum(credit_cents),0) from ledger_entries)::bigint,
           (select count(*) from journals)::bigint,
           (select count(*) from (select journal_id from ledger_entries group by journal_id having sum(debit_cents) <> sum(credit_cents)) x)::bigint;
end $$;

create or replace function admin_geography()
returns table(country text, customers bigint, verified bigint, pending bigint, not_started bigint, rejected bigint, orders bigint, gmv_cents bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can('customers','view') then raise exception 'FORBIDDEN'; end if;
  return query
    with oc as (
      select o.org_id, count(*)::bigint n, sum(o.total_cents)::bigint gmv from orders o where o.status <> 'cancelled' group by o.org_id
    )
    select coalesce(g.country, '??'),
           count(*)::bigint,
           count(*) filter (where g.kyc_status = 'verified')::bigint,
           count(*) filter (where g.kyc_status in ('submitted','in_review','more_info'))::bigint,
           count(*) filter (where g.kyc_status = 'not_started')::bigint,
           count(*) filter (where g.kyc_status = 'rejected')::bigint,
           coalesce(sum(oc.n), 0)::bigint,
           coalesce(sum(oc.gmv), 0)::bigint
    from organizations g left join oc on oc.org_id = g.id
    where g.archived_at is null
    group by 1
    order by 8 desc, 2 desc;
end $$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array[
    'set_setting(text,jsonb)','publish_terms(uuid,timestamptz)','transition_campaign(uuid,campaign_status,text)','retry_outbox(uuid)',
    'record_integration_test(text,boolean,text)','admin_wallet_balances()','admin_revenue_by_stream(timestamptz,timestamptz)',
    'admin_ledger_check()','admin_geography()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['guard_legal_publish()','audit_row_change()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
