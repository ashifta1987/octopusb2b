-- QA §19 Security (SPEC §19.1: "audit log entries for … pool settles"; §12 Audit).
-- settle_pool / expire_pool did not write audit_log (cancel_pool already does). Audit every automatic pool state
-- change with a trigger instead of editing the money RPCs: additive, no change to ledger or pledge logic.
create or replace function public.audit_pool_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status::text <> 'cancelled' then
    perform write_audit('pool.' || new.status::text, 'pools', new.id::text, jsonb_build_object(
      'code', new.code, 'from', old.status, 'filled_qty', new.filled_qty, 'target_qty', new.target_qty,
      'final_price_minor', new.final_price_minor, 'currency', new.currency));
  end if;
  return null;
end $$;

revoke all on function public.audit_pool_status() from public, anon, authenticated;

drop trigger if exists trg_audit_pool_status on public.pools;
create trigger trg_audit_pool_status after update of status on public.pools
  for each row execute function public.audit_pool_status();
