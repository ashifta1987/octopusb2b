-- ADDON-41: every new customer company can source straight away (Sourcing is on by default; the other services start off).
create or replace function company_default_services() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into company_services(org_id, service, status, started_at) values (new.id, 'sourcing', 'on', now()) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_company_default_services on organizations;
create trigger trg_company_default_services after insert on organizations for each row execute function company_default_services();
