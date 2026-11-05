-- ADDON-24 follow-up: the end-to-end trace suite (SPEC §21) left one paused test campaign ("QA-TRACE campaign",
-- headline "QA test — please ignore", no company). It is test data, so the wipe removes it with the demo rows.
do $$
declare def text; p text;
begin
  def := pg_get_functiondef('tag_seed_rows()'::regprocedure);
  if position('QA-TRACE' in def) > 0 then return; end if;
  p := replace(def, '  update wallet_topups set is_seed = true',
               E'  update ad_campaigns set is_seed = true where name like ''QA-TRACE%'' and org_id is null and supplier_id is null;\n  update wallet_topups set is_seed = true');
  if p = def then raise exception 'ADDON-24 patch: tag_seed_rows'; end if;
  execute p;
end $$;
select tag_seed_rows();
