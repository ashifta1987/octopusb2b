-- ADDON-27 fix: top-level categories have level 1 (check 1–4), not 0.
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure);
  if position('''-'', ''g'')), 0, 100, false)' in def) = 0 then return; end if;
  p := replace(def, '''-'', ''g'')), 0, 100, false)', '''-'', ''g'')), 1, 100, false)');
  execute p;
end $$;
