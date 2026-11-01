-- SPEC §21 chain 2 gaps:
--  (a) approving a quote left no status_history row for the quote (only rfq/order rows) — §5 says every transition
--      writes status_history. An AFTER UPDATE trigger on quotes records quote status changes that the RPCs did not log
--      themselves (checked by txid), so core_approve_quote (money path) is not redefined.
--  (b) customer/ops business transitions (approve, pay, confirm, ship …) had no audit_log entry (§12 "audit log holds
--      every click"; §21.2 "audit log entry"). Every status_history row is mirrored into audit_log as
--      `status.<entity>` with from/to/reason (append-only, same txid and trace id).

create or replace function public.trg_quote_status_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not exists (
    select 1 from status_history h
    where h.entity = 'quote' and h.entity_id = new.id and h.to_status = new.status::text and h.txid = txid_current()
  ) then
    insert into status_history(entity, entity_id, from_status, to_status, actor_id, reason)
      values ('quote', new.id, old.status::text, new.status::text, auth.uid(), null);
  end if;
  return new;
end $$;
drop trigger if exists trg_quote_status_history on public.quotes;
create trigger trg_quote_status_history after update of status on public.quotes
  for each row execute function public.trg_quote_status_history();

create or replace function public.trg_status_history_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor_id, action, entity, entity_id, details)
    values (coalesce(new.actor_id, auth.uid()), 'status.' || new.entity, new.entity, new.entity_id::text,
            jsonb_build_object('from', new.from_status, 'to', new.to_status, 'reason', new.reason, 'status_history_id', new.id));
  return new;
end $$;
drop trigger if exists trg_status_history_audit on public.status_history;
create trigger trg_status_history_audit after insert on public.status_history
  for each row execute function public.trg_status_history_audit();
