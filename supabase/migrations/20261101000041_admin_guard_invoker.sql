-- The legal publishing guard must run as the caller: inside a SECURITY DEFINER trigger current_user is always the
-- owner, which made the service-role bypass match every client. Invoker rights keep current_user = 'authenticated'
-- for API callers and the owner only when called from trusted SECURITY DEFINER RPCs/jobs (publish_terms, pg_cron).
alter function guard_legal_publish() security invoker;
