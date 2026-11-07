-- Principal company bank accounts (owner, 7 Nov 2026): the accounts buyers pay into, one active account per currency.
-- Shown on the wallet top-up and order payment pages and on proforma / commercial invoices (the account matching the
-- payment currency). Admin only, each change needs a fresh 2FA code (mfa_fresh) and is written to the audit log —
-- so nobody can quietly swap the account number buyers pay into.

create table if not exists company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  bank_name text not null check (length(btrim(bank_name)) between 2 and 160),
  account_holder text not null check (length(btrim(account_holder)) between 2 and 200),
  account_number text not null check (length(btrim(account_number)) between 4 and 64),
  swift text check (swift is null or swift ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  routing_code text check (routing_code is null or length(routing_code) <= 40),   -- ABA / sort code / CNAPS / IFSC
  bank_address text check (bank_address is null or length(bank_address) <= 400),
  intermediary text check (intermediary is null or length(intermediary) <= 400),  -- intermediary / correspondent bank
  notes text check (notes is null or length(notes) <= 400),                       -- shown to buyers, e.g. "Use the invoice number as reference"
  active boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists company_bank_accounts_one_active on company_bank_accounts(currency) where active;
alter table company_bank_accounts enable row level security;
drop policy if exists cba_read on company_bank_accounts;
-- signed-in users see active accounts (needed to pay); staff with finance view see all; nobody writes directly
create policy cba_read on company_bank_accounts for select to authenticated using (active or can('finance', 'view') or is_admin());

create or replace function save_company_bank_account(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old jsonb; v_new jsonb; v_cur text := upper(btrim(coalesce(p->>'currency', '')));
begin
  if not is_admin() then raise exception 'FORBIDDEN: only an Admin can change the company bank accounts'; end if;
  if not mfa_fresh() then raise exception 'STEP_UP_REQUIRED'; end if;
  if coalesce((p->>'active')::boolean, true) then
    update company_bank_accounts set active = false, updated_at = now(), updated_by = auth.uid()
     where currency = v_cur and active and id is distinct from v_id;   -- one active account per currency: the new one replaces it
  end if;
  if v_id is null then
    insert into company_bank_accounts(currency, bank_name, account_holder, account_number, swift, routing_code, bank_address, intermediary, notes, active, updated_by)
      values (v_cur, btrim(p->>'bank_name'), btrim(p->>'account_holder'), upper(regexp_replace(btrim(p->>'account_number'), '\s+', ' ', 'g')),
              nullif(upper(btrim(p->>'swift')), ''), nullif(btrim(p->>'routing_code'), ''), nullif(btrim(p->>'bank_address'), ''),
              nullif(btrim(p->>'intermediary'), ''), nullif(btrim(p->>'notes'), ''), coalesce((p->>'active')::boolean, true), auth.uid())
      returning id, to_jsonb(company_bank_accounts.*) into v_id, v_new;
    perform write_audit('company_bank_account.created', 'company_bank_accounts', v_id::text, jsonb_build_object('new', v_new - 'updated_by'));
  else
    select to_jsonb(c.*) into v_old from company_bank_accounts c where id = v_id for update;
    if v_old is null then raise exception 'NOT_FOUND'; end if;
    update company_bank_accounts set currency = v_cur, bank_name = btrim(p->>'bank_name'), account_holder = btrim(p->>'account_holder'),
      account_number = upper(regexp_replace(btrim(p->>'account_number'), '\s+', ' ', 'g')), swift = nullif(upper(btrim(p->>'swift')), ''),
      routing_code = nullif(btrim(p->>'routing_code'), ''), bank_address = nullif(btrim(p->>'bank_address'), ''),
      intermediary = nullif(btrim(p->>'intermediary'), ''), notes = nullif(btrim(p->>'notes'), ''),
      active = coalesce((p->>'active')::boolean, true), updated_at = now(), updated_by = auth.uid()
     where id = v_id returning to_jsonb(company_bank_accounts.*) into v_new;
    perform write_audit('company_bank_account.updated', 'company_bank_accounts', v_id::text,
      jsonb_build_object('old', v_old - 'updated_by' - 'updated_at', 'new', v_new - 'updated_by' - 'updated_at'));
  end if;
  return v_id;
end $$;

create or replace function delete_company_bank_account(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not is_admin() then raise exception 'FORBIDDEN: only an Admin can change the company bank accounts'; end if;
  if not mfa_fresh() then raise exception 'STEP_UP_REQUIRED'; end if;
  delete from company_bank_accounts where id = p_id returning to_jsonb(company_bank_accounts.*) into v_old;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  perform write_audit('company_bank_account.deleted', 'company_bank_accounts', p_id::text, jsonb_build_object('old', v_old - 'updated_by'));
end $$;

revoke all on function save_company_bank_account(jsonb) from public, anon;
revoke all on function delete_company_bank_account(uuid) from public, anon;
grant execute on function save_company_bank_account(jsonb) to authenticated;
grant execute on function delete_company_bank_account(uuid) to authenticated;

