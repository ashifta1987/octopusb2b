-- Lockdown for the functions added in 172 (same rule as migration 004): no EXECUTE for anon / PUBLIC, authenticated only.
do $$
declare f text;
begin
  foreach f in array array[
    'send_quote(uuid,uuid,bigint,integer,text,integer,bigint,text,integer,bigint)', 'request_visible(text,uuid)',
    'post_request_message(text,uuid,text)', 'add_request_file(text,uuid,text,text,text,bigint)', 'mark_quotes_viewed(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function rfq_reviewed_event() from public, anon, authenticated;
end $$;
