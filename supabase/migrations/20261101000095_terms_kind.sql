-- Group Buy terms (kind 'group_buy') live next to the general T&C: every "latest published terms" lookup and every
-- "supersede the previous version" step must stay within the same kind.
do $$
declare v_def text; v_new text;
begin
  -- orders accept/store only GENERAL terms
  v_def := pg_get_functiondef('core_approve_quote(uuid,uuid,uuid,text)'::regprocedure);
  v_new := replace(v_def, $s$where id = p_terms_version and status = 'published')$s$, $s$where id = p_terms_version and status = 'published' and kind = 'general')$s$);
  v_new := replace(v_new, $s$(select id from terms_versions where status = 'published' order by published_at desc limit 1)$s$,
                          $s$(select id from terms_versions where status = 'published' and kind = 'general' order by published_at desc limit 1)$s$);
  if v_new = v_def then raise exception 'core_approve_quote not patched'; end if;
  execute v_new;

  -- publishing supersedes only the previous version of the SAME kind
  v_def := pg_get_functiondef('publish_terms(uuid,timestamp with time zone)'::regprocedure);
  v_new := replace(v_def, $s$where status = 'published' and id <> p_id;$s$, $s$where status = 'published' and id <> p_id and kind = t.kind;$s$);
  if v_new = v_def then raise exception 'publish_terms not patched'; end if;
  execute v_new;

  v_def := pg_get_functiondef('job_publish_scheduled_terms()'::regprocedure);
  v_new := replace(v_def, $s$update terms_versions set status = 'superseded' where status = 'published';$s$,
                          $s$update terms_versions set status = 'superseded' where status = 'published' and kind = (select kind from terms_versions where id = v);$s$);
  if v_new = v_def then raise exception 'job_publish_scheduled_terms not patched'; end if;
  execute v_new;
end $$;

-- repair: orders created since the Group Buy terms were published that point at them (non-pool orders) → general terms
-- (replay fix 7 Nov 2026: orders.pool_id is added in migration 100; on a fresh database there is nothing to repair)
do $repair$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'pool_id') then
    execute $q$update orders o set terms_version_id = (select id from terms_versions where kind = 'general' and status = 'published' order by published_at desc limit 1)
      where o.pool_id is null and o.terms_version_id in (select id from terms_versions where kind = 'group_buy')$q$;
  end if;
end $repair$;

