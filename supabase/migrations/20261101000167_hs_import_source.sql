-- HS codes: a code typed in the bulk template is tagged 'sheet'; a blank cell on an update keeps the current code.
do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('import_product_row(jsonb)'::regprocedure);
  patched := replace(def, 'hs_code = p->>''hs_code'', currency = v_cur,',
    'hs_code = coalesce(nullif(btrim(p->>''hs_code''), ''''), hs_code), hs_code_source = case when nullif(btrim(p->>''hs_code''), '''') is not null and nullif(btrim(p->>''hs_code''), '''') is distinct from hs_code then ''sheet'' else hs_code_source end, currency = v_cur,');
  patched := replace(patched, 'origin_country, hs_code, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title)',
    'origin_country, hs_code, hs_code_source, octopus_dropship, ready_to_ship, currency, min_price_cents, created_by, seo_title)');
  patched := replace(patched, 'p->>''origin_country'', p->>''hs_code'',',
    'p->>''origin_country'', nullif(btrim(p->>''hs_code''), ''''), case when nullif(btrim(p->>''hs_code''), '''') is not null then ''sheet'' end,');
  if patched = def or position('hs_code_source' in patched) = 0 then raise exception 'import_product_row patch did not apply'; end if;
  execute patched;
end $$;
