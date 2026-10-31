-- Fix: CASE returned text for approval_status column (approve path crashed).
create or replace function decide_finance_approval(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_limit bigint := coalesce((setting('finance_approval_limit_cents'))::text::bigint, 100000); v_j uuid;
begin
  if not can('finance','approve') then raise exception 'FORBIDDEN'; end if;
  select * into a from finance_approvals where id = p_id for update;
  if a.status <> 'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if a.requested_by = auth.uid() then raise exception 'MAKER_CANNOT_APPROVE'; end if;
  if p_approve and a.amount_cents > v_limit and not is_admin() then raise exception 'OVER_LIMIT_NEEDS_ADMIN'; end if;
  if not p_approve then
    update finance_approvals set status = 'rejected', approved_by = auth.uid(), decided_at = now() where id = p_id;
  else
    if a.kind in ('refund','credit_note','adjustment') and a.org_id is not null then
      v_j := post_journal(initcap(replace(a.kind,'_',' ')) || ' · ' || a.reason, jsonb_build_array(
        jsonb_build_object('account', ledger_account('exp:refunds','Refunds & credits','expense'), 'debit', a.amount_cents, 'credit', 0),
        jsonb_build_object('account', wallet_account(a.org_id), 'debit', 0, 'credit', a.amount_cents, 'org', a.org_id)
      ), 'fa:' || p_id, 'refunds', 'finance_approval', p_id);
      if a.kind = 'credit_note' then
        insert into documents(org_id, doc_type, number, order_id, amount_cents, status, data)
        values (a.org_id, 'credit_note', 'CN-' || upper(substr(p_id::text,1,8)), a.order_id, a.amount_cents, 'issued', jsonb_build_object('reason', a.reason));
      end if;
    elsif a.kind = 'payout' then
      insert into payouts(supplier_id, amount_cents, status, approval_id) values (a.supplier_id, a.amount_cents, 'approved', p_id);
    end if;
    update finance_approvals set status = (case when v_j is not null or a.kind = 'payout' then 'executed' else 'approved' end)::approval_status,
      approved_by = auth.uid(), decided_at = now(), executed_journal_id = v_j where id = p_id;
  end if;
  perform write_audit('finance.decide', 'finance_approvals', p_id::text, jsonb_build_object('approve', p_approve, 'note', p_note));
end $$;
