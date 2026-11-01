-- SPEC §21 chain 6: pools are settled by pg_cron (job_pools every 5 min), i.e. outside any request, so the PO/PI/
-- order/outbox rows that settle_pool writes had no trace id. job_pools now runs each pool under the trace id of the
-- pledge that filled it (app.trace_id, transaction-local) so the whole group buy stays one trace.
-- Body otherwise identical to 20261101000100_group_buy.sql.

create or replace function job_pools() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; s int := 0; e int := 0; d int := 0; r int := 0; pl record;
begin
  for v in select id from pools where status = 'open' and filled_qty >= target_qty loop
    perform set_config('app.trace_id', coalesce((select trace_id from pool_pledges where pool_id = v and trace_id is not null order by joined_at desc limit 1),
                                                (select trace_id from pools where id = v), ''), true);
    begin perform settle_pool(v); s := s + 1; exception when others then null; end;   -- unpaid card pledges may drop it below target
  end loop;
  for v in select id from pools where status = 'open' and deadline_at <= now() loop
    perform set_config('app.trace_id', coalesce((select trace_id from pools where id = v), ''), true);
    perform expire_pool(v); e := e + 1;
  end loop;
  for pl in select pp.id, pp.trace_id from pool_pledges pp join pools p on p.id = pp.pool_id
            where pp.status = 'paid' and p.status = 'locked' and p.balance_due_at <= now() loop
    perform set_config('app.trace_id', coalesce(pl.trace_id, ''), true);
    perform default_pledge(pl.id); d := d + 1;
  end loop;
  -- balance reminders at T+24h and T+36h after fill
  for pl in select pp.id, pp.org_id, pp.reminders_sent, pp.trace_id, p.id pool_id, p.code, p.filled_at from pool_pledges pp join pools p on p.id = pp.pool_id
            where pp.status = 'paid' and p.status = 'locked'
              and ((pp.reminders_sent = 0 and p.filled_at <= now() - interval '24 hours') or (pp.reminders_sent = 1 and p.filled_at <= now() - interval '36 hours')) loop
    perform set_config('app.trace_id', coalesce(pl.trace_id, ''), true);
    update pool_pledges set reminders_sent = reminders_sent + 1 where id = pl.id;
    perform emit_event('pool.balance_reminder', 'pool', pl.pool_id, jsonb_build_object('org_id', pl.org_id, 'pledge_id', pl.id, 'reminder', pl.reminders_sent + 1));
    r := r + 1;
  end loop;
  perform set_config('app.trace_id', '', true);
  return jsonb_build_object('settled', s, 'expired', e, 'defaulted', d, 'reminders', r);
end $$;
revoke all on function job_pools() from public, anon, authenticated;
