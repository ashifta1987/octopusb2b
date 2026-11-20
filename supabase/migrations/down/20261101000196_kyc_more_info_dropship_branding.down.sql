-- Down for 20261101000196_kyc_more_info_dropship_branding.sql: back to the state after 195.

-- dropship seller profiles
drop function if exists review_dropship_profile(uuid, text, text);
drop table if exists dropship_seller_profiles;
drop function if exists dropship_profile_reset_on_change();

-- review_kyc as in 195 (a customer message is required only when rejecting)
create or replace function review_kyc(p_submission uuid, p_to kyc_status, p_note text default null, p_customer_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_msg text := nullif(btrim(coalesce(p_customer_message, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not can('customers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into s from kyc_submissions where id = p_submission for update;
  if s is null then raise exception 'NOT_FOUND'; end if;
  if p_to not in ('in_review','verified','rejected','more_info') then raise exception 'KYC_INVALID_TRANSITION'; end if;
  if s.status in ('verified','rejected') then raise exception 'KYC_INVALID_TRANSITION: already %', s.status; end if;
  if p_to = 'rejected' and v_msg is null then raise exception 'KYC_MESSAGE_REQUIRED: write a message to the customer when rejecting'; end if;
  update kyc_submissions set status = p_to, reviewer_id = auth.uid(), internal_note = v_note, customer_message = v_msg, reviewed_at = now()
   where id = p_submission;
  update organizations set kyc_status = p_to where id = s.org_id;
  perform log_status('kyc', p_submission, s.status::text, p_to::text, v_note);
  perform write_audit('kyc.review', 'kyc_submissions', p_submission::text, jsonb_build_object('to', p_to));
  perform emit_event('kyc.' || p_to, 'kyc', p_submission, jsonb_build_object('org_id', s.org_id));
end $$;
revoke all on function review_kyc(uuid, kyc_status, text, text) from public, anon;
grant execute on function review_kyc(uuid, kyc_status, text, text) to authenticated;
comment on column kyc_submissions.customer_message is 'Shown to the customer. Required when rejecting.';
