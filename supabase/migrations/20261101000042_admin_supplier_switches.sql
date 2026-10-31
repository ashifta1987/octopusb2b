-- Every supplier gets a supplier_switches row on creation (clients have no INSERT policy on supplier_switches).
create or replace function create_supplier_switches() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into supplier_switches(supplier_id) values (new.id) on conflict (supplier_id) do nothing;
  return new;
end $$;
revoke execute on function public.create_supplier_switches() from public, anon, authenticated;
drop trigger if exists trg_supplier_switches on suppliers;
create trigger trg_supplier_switches after insert on suppliers for each row execute function create_supplier_switches();
insert into supplier_switches(supplier_id) select id from suppliers on conflict do nothing;
