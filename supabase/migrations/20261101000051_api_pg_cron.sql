-- Octopus B2B — scheduled jobs via pg_cron (SPEC §10.3), when the extension is available.
-- Vercel Cron (vercel.json) also calls /api/cron/<job> daily as a fallback (Hobby plan only allows daily crons).
-- The outbox worker needs HTTP (email, outgoing webhooks) so it runs as the /api/cron/outbox Route Handler, not here.
do $outer$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available (%), skipping SQL schedules — rely on Vercel Cron', sqlerrm;
    return;
  end;

  begin
    perform cron.schedule('octopus-expire-quotes',  '*/15 * * * *', 'select public.job_expire_quotes()');
    perform cron.schedule('octopus-terms-publish',  '*/5 * * * *',  'select public.job_publish_scheduled_terms()');
    perform cron.schedule('octopus-ads-reset',      '0 0 * * *',    'select public.job_reset_ad_budgets()');
    perform cron.schedule('octopus-claim-windows',  '15 0 * * *',   'select public.job_close_claim_windows()');
    perform cron.schedule('octopus-certificates',   '30 0 * * *',   'select public.job_certificate_expiry()');
    perform cron.schedule('octopus-cleanup',        '45 0 * * *',   'select public.job_cleanup()');
  exception when others then
    raise notice 'pg_cron scheduling failed (%), rely on Vercel Cron', sqlerrm;
  end;
end
$outer$;
