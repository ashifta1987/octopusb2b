-- ADDON-27 fix: products.moq is NOT NULL (default 1) — unquoted products get 1 until a quote arrives
-- (recompute_sell_prices sets the real MOQ from the price tiers).
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure);
  if position('coalesce(nullif(v->>''moq'', '''')::int, 1), v->>''incoterm''' in def) > 0 then return; end if;
  p := replace(def, $a$nullif(v->>'moq', '')::int, v->>'incoterm', 'CN'$a$, $b$coalesce(nullif(v->>'moq', '')::int, 1), v->>'incoterm', 'CN'$b$);
  if p = def then raise exception 'ADDON-27 patch: moq'; end if;
  execute p;
end $$;
