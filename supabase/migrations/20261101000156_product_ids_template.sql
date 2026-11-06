-- ADDON-29: every product has a Product Id (external_id) — backfill + automatic id for new products — and the import
-- commit refuses runs with validation errors. Photos shared by several rows are stored once and linked to each product.

-- <country>-<province>-<supplier code>-<NNNN>; suppliers imported with an external id use its first three parts
create or replace function next_product_external_id(p_supplier uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s suppliers; v_prefix text; v_n int;
begin
  select * into s from suppliers where id = p_supplier;
  if s.id is null then return null; end if;
  if s.external_id ~ '^[A-Z]{2}-[A-Z0-9]{2,3}-[A-Z0-9]{2,8}-' then
    v_prefix := array_to_string((string_to_array(s.external_id, '-'))[1:3], '-');
  else
    v_prefix := upper(coalesce(nullif(s.country, ''), 'XX')) || '-XX-' ||
                upper(coalesce(nullif(regexp_replace(coalesce(s.manufacturer_code, ''), '[^A-Za-z0-9]', '', 'g'), ''), 'S' || regexp_replace(s.code, '\D', '', 'g')));
  end if;
  select coalesce(max((substring(external_id from '-(\d{4})$'))::int), 0) + 1 into v_n
    from products where external_id like v_prefix || '-%' and external_id ~ '-\d{4}$';
  loop
    exit when not exists (select 1 from products where external_id = v_prefix || '-' || lpad(v_n::text, 4, '0'));
    v_n := v_n + 1;
  end loop;
  return v_prefix || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke execute on function next_product_external_id(uuid) from public, anon, authenticated;

create or replace function assign_product_external_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.external_id is null then new.external_id := next_product_external_id(new.supplier_id);
  else new.external_id := upper(new.external_id); end if;
  return new;
end $$;
drop trigger if exists trg_assign_product_external_id on products;
create trigger trg_assign_product_external_id before insert on products for each row execute function assign_product_external_id();

-- backfill (logged)
do $$
declare p record; v_id text; n int := 0;
begin
  for p in select id, supplier_id, title from products where external_id is null order by created_at loop
    v_id := next_product_external_id(p.supplier_id);
    update products set external_id = v_id where id = p.id;
    insert into audit_log(action, entity, entity_id, details)
      values ('product.external_id_assigned', 'products', p.id::text, jsonb_build_object('external_id', v_id, 'title', p.title, 'source', 'ADDON-29 backfill'));
    n := n + 1;
  end loop;
  raise notice 'ADDON-29: assigned % Product Ids', n;
end $$;

-- commit: refuse a run that has validation errors; images are matched by file name (a photo stored once can serve
-- several products, and earlier imports stored photos under a per-product path)
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure);
  if position('IMPORT_HAS_ERRORS' in def) = 0 then
    p := replace(def, $a$  s := r.staging;$a$,
      $b$  s := r.staging;
  if jsonb_array_length(coalesce(s->'errors', '[]')) > 0 then
    raise exception 'IMPORT_HAS_ERRORS: fix the % error(s) in the workbook and upload it again', jsonb_array_length(s->'errors');
  end if;$b$);
    if p = def then raise exception 'ADDON-29 patch: errors guard'; end if;
    def := p;
  end if;
  if position('array_length(string_to_array(url' in def) = 0 then
    p := replace(def, $a$if exists (select 1 from product_media where product_id = v_pid and url = v->>'url') then$a$,
      $b$if exists (select 1 from product_media where product_id = v_pid and (url = v->>'url' or (string_to_array(url, '/'))[array_length(string_to_array(url, '/'), 1)] = v->>'file')) then$b$);
    if p = def then raise exception 'ADDON-29 patch: image match'; end if;
    def := p;
  end if;
  execute def;
end $$;
