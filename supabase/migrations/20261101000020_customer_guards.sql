-- Customer portal fixes (range 20–29).
-- 1) Break the RLS recursion rfqs ⇄ quotes ("infinite recursion detected in policy for relation rfqs").
-- 2) Column guards for tables customers may UPDATE through broad RLS policies, so only the intended columns change.

-- ───────── 1. rfqs / quotes policies via SECURITY DEFINER helpers (no cross-table RLS evaluation) ─────────
create or replace function rfq_in_my_org(p_rfq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from rfqs r where r.id = p_rfq and r.org_id in (select my_org_ids()));
$$;

create or replace function rfq_has_my_supplier_quote(p_rfq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from quotes q where q.rfq_id = p_rfq and is_my_supplier(q.supplier_id));
$$;

revoke execute on function rfq_in_my_org(uuid) from public, anon;
revoke execute on function rfq_has_my_supplier_quote(uuid) from public, anon;
grant execute on function rfq_in_my_org(uuid) to authenticated, service_role;
grant execute on function rfq_has_my_supplier_quote(uuid) to authenticated, service_role;

drop policy if exists rfq_read on rfqs;
create policy rfq_read on rfqs for select to authenticated using (
  org_id in (select my_org_ids()) or can('requests','view')
  or (has_role('distributor') and rfq_has_my_supplier_quote(id)));

drop policy if exists quotes_read on quotes;
create policy quotes_read on quotes for select to authenticated using (
  rfq_in_my_org(rfq_id) or can('requests','view') or is_my_supplier(supplier_id));

-- ───────── 2. Column guards (RPCs run as the function owner and bypass these) ─────────
create or replace function _is_definer_ctx() returns boolean
language sql stable as $$ select current_user in ('postgres','supabase_admin','service_role') $$;

-- Tickets: customers may only set CSAT (once, after resolution). Status etc. move via reply_ticket().
create or replace function guard_ticket_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if _is_definer_ctx() or can('support','edit') then return new; end if;
  if (to_jsonb(new) - 'csat' - 'updated_at') is distinct from (to_jsonb(old) - 'csat' - 'updated_at') then
    raise exception 'FORBIDDEN: customers may only rate a ticket';
  end if;
  if new.csat is distinct from old.csat and (old.csat is not null or old.status not in ('resolved','closed')) then
    raise exception 'FORBIDDEN: rating is allowed once after resolution';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_ticket on tickets;
create trigger trg_guard_ticket before update on tickets for each row execute function guard_ticket_update();

-- Documents: customers may only stamp emailed_at.
create or replace function guard_document_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if _is_definer_ctx() or can('finance','edit') then return new; end if;
  if (to_jsonb(new) - 'emailed_at') is distinct from (to_jsonb(old) - 'emailed_at') then
    raise exception 'FORBIDDEN: documents are read-only';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_document on documents;
create trigger trg_guard_document before update on documents for each row execute function guard_document_update();

-- API keys: customers may only revoke (set revoked_at once). Mode/hash can never be changed client-side.
create or replace function guard_api_key_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if _is_definer_ctx() or can('integrations','edit') then return new; end if;
  if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception 'FORBIDDEN: API keys can only be revoked';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'FORBIDDEN: a revoked key cannot be restored';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_api_key on api_keys;
create trigger trg_guard_api_key before update on api_keys for each row execute function guard_api_key_update();

-- Ad campaigns: advertisers cannot self-approve, touch spend, or edit a live creative without re-review.
create or replace function guard_campaign_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if _is_definer_ctx() or can('ads','edit') then return new; end if;
  if new.org_id is distinct from old.org_id or new.supplier_id is distinct from old.supplier_id
     or new.spent_today_cents is distinct from old.spent_today_cents or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'FORBIDDEN: protected campaign field';
  end if;
  if new.status is distinct from old.status and (old.status, new.status) not in (
       ('draft','in_review'),('in_review','draft'),('active','paused'),('paused','active'),
       ('draft','ended'),('in_review','ended'),('active','ended'),('paused','ended')) then
    raise exception 'INVALID_TRANSITION: % → %', old.status, new.status;
  end if;
  -- changed creative/targeting/bid on an approved campaign goes back to moderation
  if old.status in ('active','paused') and new.status <> 'ended' and (
       new.headline is distinct from old.headline or new.body is distinct from old.body or new.link is distinct from old.link
       or new.image_url is distinct from old.image_url or new.placement is distinct from old.placement
       or new.target_countries is distinct from old.target_countries or new.target_categories is distinct from old.target_categories
       or new.max_cpc_cents is distinct from old.max_cpc_cents or new.daily_budget_cents is distinct from old.daily_budget_cents) then
    new.status := 'in_review';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_campaign on ad_campaigns;
create trigger trg_guard_campaign before update on ad_campaigns for each row execute function guard_campaign_update();
