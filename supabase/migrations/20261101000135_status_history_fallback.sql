-- SPEC §21 chain 13 gap: record_ad_click() pauses a campaign when the budget/wallet runs out by updating
-- ad_campaigns.status directly — no status_history row, no audit (also QA FN-06: customer "pause" writes status
-- directly). A generic AFTER UPDATE OF status trigger records any status change that the writing code did not log in
-- the same transaction (checked by txid). quotes moves to the generic function too.

create or replace function public.trg_status_history_fallback() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_entity text := TG_ARGV[0];
begin
  if new.status is distinct from old.status and not exists (
    select 1 from status_history h
    where h.entity = v_entity and h.entity_id = new.id and h.to_status = new.status::text and h.txid = txid_current()
  ) then
    insert into status_history(entity, entity_id, from_status, to_status, actor_id, reason)
      values (v_entity, new.id, old.status::text, new.status::text, auth.uid(), 'recorded by trigger');
  end if;
  return new;
end $$;

drop trigger if exists trg_quote_status_history on public.quotes;
create trigger trg_quote_status_history after update of status on public.quotes
  for each row execute function public.trg_status_history_fallback('quote');
drop function if exists public.trg_quote_status_history();

drop trigger if exists trg_campaign_status_history on public.ad_campaigns;
create trigger trg_campaign_status_history after update of status on public.ad_campaigns
  for each row execute function public.trg_status_history_fallback('ad_campaign');
