-- SPEC §20 — AI account assistant "Octo" + dedicated human account manager.
-- Customers are organisations in this app, so the account team is assigned per customer ORG (account_managers.org_id);
-- customer_user_id records the user who triggered the assignment.

-- ───────────────────────── Permission area "Assistant" ─────────────────────────
alter table role_permissions drop constraint role_permissions_action_check;
alter table role_permissions add constraint role_permissions_action_check
  check (action in ('view','create','edit','delete','approve','export','backup','download','request_restore','approve_restore',
                    'reply','take_over','close','reassign','configure'));
insert into permission_areas(code, name, sort) values ('assistant', 'Assistant', 20) on conflict (code) do nothing;
insert into role_permissions(role_code, area, action) values
  ('sourcing_agent','assistant','view'),('sourcing_agent','assistant','reply'),('sourcing_agent','assistant','take_over'),('sourcing_agent','assistant','close'),
  ('support','assistant','view'),('support','assistant','reply'),('support','assistant','take_over'),('support','assistant','close'),
  ('operations','assistant','view')
on conflict do nothing;

insert into site_settings(key, value, description, is_public) values
  ('assistant_enabled', 'true', 'AI assistant Octo on/off', true),
  ('assistant_confidence_threshold', '0.60', 'Escalate after 3 consecutive bot turns below this confidence', false),
  ('assistant_sensitive_topics', '["refund","credit note","discount","dispute","qc failure","legal","tax","customs","complaint","cancel","data request"]', 'Topics that hand off to the account manager', false),
  ('assistant_vip_customer_ids', '[]', 'VIP customer orgs: always routed to a human', false),
  ('assistant_team_country_map', '{"default":"Sourcing"}', 'Customer country → account-manager team (profiles.team)', false),
  ('assistant_max_customers_per_manager', '50', 'Cap of active customers per account manager', false),
  ('assistant_escalation_sla_minutes', '60', 'Escalation first-response SLA (minutes)', false),
  ('assistant_rate_limit_per_min', '20', 'Customer messages per minute', false),
  ('assistant_office_hours', '{"timezone":"Asia/Shanghai","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}', 'Account manager office hours', true)
on conflict (key) do nothing;

alter table profiles add column if not exists team text;
alter table profiles add column if not exists out_of_office boolean not null default false;
alter table profiles add column if not exists title text;
alter table profiles add column if not exists assistant_history_opt_out boolean not null default false;

-- ───────────────────────── Tables ─────────────────────────
create table account_managers (
  org_id uuid primary key references organizations(id) on delete cascade,
  customer_user_id uuid references auth.users(id),
  staff_user_id uuid not null references auth.users(id),
  team text,
  is_primary boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  reason text
);
create index on account_managers(staff_user_id);

create type assistant_author as enum ('bot','customer','staff','system');
create type escalation_reason as enum ('customer_request','sensitive_topic','low_confidence','negative_sentiment','needs_approval','vip','after_hours','timeout','staff_take_over');

create table assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_user_id uuid references auth.users(id),
  title text,
  channel text not null default 'page' check (channel in ('page','drawer','api')),
  page_context text,
  status text not null default 'bot' check (status in ('bot','escalated','human','closed')),
  low_confidence_turns int not null default 0,
  escalation_id uuid,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on assistant_sessions(org_id, last_message_at desc);

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references assistant_sessions(id) on delete cascade,
  org_id uuid not null,
  author assistant_author not null,
  author_user_id uuid references auth.users(id),
  content text not null,
  confidence numeric(5,2),
  tools_called jsonb not null default '[]',
  hidden_from_customer boolean not null default false,
  latency_ms int,
  tokens int,
  created_at timestamptz not null default now()
);
create index on assistant_messages(session_id, created_at);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references assistant_sessions(id) on delete cascade,
  org_id uuid not null,
  reason escalation_reason not null,
  confidence numeric(5,2),
  excerpt text,
  assigned_to uuid references auth.users(id),     -- account manager, or null = team queue
  team text,
  ticket_id uuid references tickets(id),
  requested_at timestamptz not null default now(),
  sla_due_at timestamptz,
  taken_by_staff_id uuid references auth.users(id),
  taken_at timestamptz,
  resolved_at timestamptz,
  outcome text
);
create index on escalations(assigned_to, resolved_at);
alter table assistant_sessions add constraint assistant_sessions_escalation_fk foreign key (escalation_id) references escalations(id);

create table assistant_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references assistant_messages(id) on delete cascade,
  org_id uuid not null,
  user_id uuid references auth.users(id),
  thumbs_up boolean not null,
  note text,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

-- ───────────────────────── Access helpers ─────────────────────────
-- staff may read a customer's assistant data only if they are its account manager, hold an escalation for it,
-- cover the team queue while the primary is out of office, or supervise (assistant:reassign / admin)
create or replace function assistant_staff_can(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or can('assistant','reassign')
      or (can('assistant','view') and (
            exists(select 1 from account_managers am where am.org_id = p_org and am.staff_user_id = auth.uid())
         or exists(select 1 from escalations e where e.org_id = p_org and (e.assigned_to = auth.uid() or e.taken_by_staff_id = auth.uid()))
         or exists(select 1 from account_managers am join profiles mp on mp.id = am.staff_user_id join profiles me on me.id = auth.uid()
                   where am.org_id = p_org and mp.out_of_office and coalesce(me.team,'') = coalesce(am.team, mp.team, ''))
         or exists(select 1 from escalations e where e.org_id = p_org and e.assigned_to is null and e.resolved_at is null)));
$$;

alter table account_managers enable row level security;
alter table assistant_sessions enable row level security;
alter table assistant_messages enable row level security;
alter table escalations enable row level security;
alter table assistant_feedback enable row level security;

create policy am_read on account_managers for select to authenticated using (org_id in (select my_org_ids()) or assistant_staff_can(org_id));
create policy as_read on assistant_sessions for select to authenticated using (org_id in (select my_org_ids()) or assistant_staff_can(org_id));
create policy msg_read on assistant_messages for select to authenticated
  using ((org_id in (select my_org_ids()) and not hidden_from_customer) or assistant_staff_can(org_id));
create policy esc_read on escalations for select to authenticated using (org_id in (select my_org_ids()) or assistant_staff_can(org_id));
create policy fb_read on assistant_feedback for select to authenticated using (user_id = auth.uid() or assistant_staff_can(org_id));

-- account manager card for the customer (name/title/team/hours only — staff can't otherwise read profiles)
create or replace function my_account_team() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_user_id', am.staff_user_id, 'name', p.full_name, 'title', coalesce(p.title, 'Dedicated account manager'),
                            'team', coalesce(am.team, p.team), 'office', p.office, 'out_of_office', p.out_of_office,
                            'email', p.email, 'phone', p.phone, 'assigned_at', am.assigned_at, 'hours', setting('assistant_office_hours'))
  from account_managers am join profiles p on p.id = am.staff_user_id where am.org_id = my_org_id();
$$;

create or replace view assistant_session_mine_view with (security_invoker = true) as
  select s.*, (select count(*) from assistant_messages m where m.session_id = s.id and not m.hidden_from_customer) as message_count,
         (select m.content from assistant_messages m where m.session_id = s.id and not m.hidden_from_customer order by m.created_at desc limit 1) as last_message
  from assistant_sessions s where s.org_id in (select my_org_ids());
grant select on assistant_session_mine_view to authenticated;

create or replace view assistant_queue_view with (security_invoker = true) as
  select s.id as session_id, s.org_id, o.name as org_name, o.buyer_code, o.country, s.status, s.title, s.low_confidence_turns, s.last_message_at,
         am.staff_user_id as account_manager_id, e.id as escalation_id, e.reason, e.assigned_to, e.taken_by_staff_id, e.sla_due_at, e.requested_at,
         e.resolved_at, e.ticket_id, (am.staff_user_id = auth.uid()) as mine
  from assistant_sessions s join organizations o on o.id = s.org_id
  left join account_managers am on am.org_id = s.org_id
  left join escalations e on e.id = s.escalation_id;
grant select on assistant_queue_view to authenticated;

-- ───────────────────────── Customer RPCs ─────────────────────────
create or replace function start_assistant_session(p_channel text default 'page', p_page text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_org uuid := my_org_id();
begin
  if not setting_bool('assistant_enabled') then raise exception 'ASSISTANT_DISABLED'; end if;
  if v_org is null then raise exception 'NO_ORG'; end if;
  insert into assistant_sessions(org_id, customer_user_id, channel, page_context) values (v_org, auth.uid(), coalesce(p_channel,'page'), p_page) returning id into v;
  return v;
end $$;

create or replace function post_customer_message(p_session uuid, p_content text, p_page text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions; v uuid; v_limit int := coalesce((setting('assistant_rate_limit_per_min'))::text::int, 20);
begin
  select * into s from assistant_sessions where id = p_session for update;
  if s.id is null or s.org_id not in (select my_org_ids()) then raise exception 'NOT_FOUND'; end if;
  if s.status = 'closed' then raise exception 'SESSION_CLOSED'; end if;
  if length(coalesce(trim(p_content),'')) = 0 or length(p_content) > 4000 then raise exception 'INVALID_MESSAGE'; end if;
  if (select count(*) from assistant_messages m join assistant_sessions x on x.id = m.session_id
      where x.org_id = s.org_id and m.author = 'customer' and m.created_at > now() - interval '1 minute') >= v_limit then
    raise exception 'RATE_LIMITED';
  end if;
  insert into assistant_messages(session_id, org_id, author, author_user_id, content) values (p_session, s.org_id, 'customer', auth.uid(), p_content) returning id into v;
  update assistant_sessions set last_message_at = now(), page_context = coalesce(p_page, page_context),
         title = coalesce(title, left(p_content, 80)) where id = p_session;
  return v;
end $$;

create or replace function assistant_feedback_set(p_message uuid, p_thumbs_up boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m assistant_messages;
begin
  select * into m from assistant_messages where id = p_message;
  if m.id is null or m.org_id not in (select my_org_ids()) or m.author <> 'bot' then raise exception 'NOT_FOUND'; end if;
  insert into assistant_feedback(message_id, org_id, user_id, thumbs_up, note) values (p_message, m.org_id, auth.uid(), p_thumbs_up, p_note)
  on conflict (message_id, user_id) do update set thumbs_up = excluded.thumbs_up, note = excluded.note;
end $$;

create or replace function set_assistant_opt_out(p_opt_out boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set assistant_history_opt_out = p_opt_out where id = auth.uid();
  if p_opt_out then   -- anonymise old sessions: drop titles + page context and blank customer message text older than today
    update assistant_sessions set title = null, page_context = null where customer_user_id = auth.uid();
  end if;
  perform write_audit('assistant.opt_out', 'profiles', auth.uid()::text, jsonb_build_object('opt_out', p_opt_out));
end $$;

-- ───────────────────────── Bot reply (server with service role) ─────────────────────────
create or replace function record_bot_reply(p_session uuid, p_content text, p_confidence numeric, p_tools jsonb default '[]',
  p_latency_ms int default null, p_tokens int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions; v uuid; v_thr numeric := coalesce((setting('assistant_confidence_threshold'))::text::numeric, 0.6); v_turns int;
begin
  select * into s from assistant_sessions where id = p_session for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  insert into assistant_messages(session_id, org_id, author, content, confidence, tools_called, latency_ms, tokens)
    values (p_session, s.org_id, 'bot', p_content, p_confidence, coalesce(p_tools,'[]'), p_latency_ms, p_tokens) returning id into v;
  v_turns := case when p_confidence is not null and p_confidence < v_thr then s.low_confidence_turns + 1 else 0 end;
  update assistant_sessions set low_confidence_turns = v_turns, last_message_at = now() where id = p_session;
  return jsonb_build_object('message_id', v, 'low_confidence_turns', v_turns, 'should_escalate_low_confidence', v_turns >= 3);
end $$;

-- ───────────────────────── Escalation ─────────────────────────
create or replace function escalate_session(p_session uuid, p_reason escalation_reason, p_excerpt text default null, p_confidence numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s assistant_sessions; am account_managers; mp profiles; v_esc uuid; v_ticket uuid; v_assignee uuid; v_team text; v_name text;
        v_transcript text; v_sla int := coalesce((setting('assistant_escalation_sla_minutes'))::text::int, 60);
begin
  select * into s from assistant_sessions where id = p_session for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if not (auth.role() = 'service_role' or auth.uid() is null or s.org_id in (select my_org_ids()) or assistant_staff_can(s.org_id)) then raise exception 'FORBIDDEN'; end if;
  if s.escalation_id is not null and exists(select 1 from escalations where id = s.escalation_id and resolved_at is null) then
    return s.escalation_id;   -- already with a human (idempotent)
  end if;
  select * into am from account_managers where org_id = s.org_id;
  if am.org_id is not null then
    select * into mp from profiles where id = am.staff_user_id;
    v_team := coalesce(am.team, mp.team);
    v_assignee := case when mp.out_of_office then null else am.staff_user_id end;   -- out of office → team queue
    v_name := case when mp.out_of_office then coalesce(v_team, 'the account team') || ' team' else split_part(mp.full_name, ' ', 1) end;
  else
    v_name := 'the account team';
  end if;
  select string_agg(to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' ' || upper(m.author::text) || ': ' || m.content, E'\n' order by m.created_at)
    into v_transcript from assistant_messages m where m.session_id = p_session and not m.hidden_from_customer;
  insert into tickets(org_id, subject, category, priority, status, assigned_to, sla_due_at, created_by)
    values (s.org_id, 'Octo handoff · ' || replace(p_reason::text, '_', ' ') || coalesce(' · ' || left(s.title, 60), ''), 'question', 'high', 'open',
            v_assignee, now() + make_interval(mins => v_sla), s.customer_user_id)
    returning id into v_ticket;
  insert into ticket_messages(ticket_id, org_id, author_id, is_staff, internal, body)
    values (v_ticket, s.org_id, s.customer_user_id, false, false,
            'Conversation handed off by Octo (' || replace(p_reason::text, '_', ' ') || ').' || coalesce(E'\nExcerpt: ' || p_excerpt, '') ||
            E'\n\n--- Transcript ---\n' || coalesce(v_transcript, '(empty)'));
  insert into escalations(session_id, org_id, reason, confidence, excerpt, assigned_to, team, ticket_id, sla_due_at)
    values (p_session, s.org_id, p_reason, p_confidence, left(p_excerpt, 1000), v_assignee, v_team, v_ticket, now() + make_interval(mins => v_sla))
    returning id into v_esc;
  update assistant_sessions set status = 'escalated', escalation_id = v_esc, last_message_at = now() where id = p_session;
  insert into assistant_messages(session_id, org_id, author, content)
    values (p_session, s.org_id, 'system', 'Octo handed this to ' || v_name || '. Ticket opened — they will reply here.');
  if v_assignee is not null then
    insert into notifications(user_id, title, body, link) values (v_assignee, 'Customer handed to you by Octo',
      (select name from organizations where id = s.org_id) || ' · ' || replace(p_reason::text, '_', ' '), '/office/assistant?session=' || p_session);
  else
    insert into notifications(user_id, title, body, link)
      select p.id, 'Octo handoff in team queue', (select name from organizations where id = s.org_id) || ' · ' || replace(p_reason::text, '_', ' '),
             '/office/assistant?session=' || p_session
      from profiles p where coalesce(p.team,'') = coalesce(v_team,'') and not p.out_of_office and user_is_staff(p.id);
  end if;
  perform emit_event('assistant.escalated', 'assistant_session', p_session,
    jsonb_build_object('org_id', s.org_id, 'escalation_id', v_esc, 'reason', p_reason, 'assigned_to', v_assignee, 'ticket_id', v_ticket, 'channels', jsonb_build_array('email','whatsapp')));
  return v_esc;
end $$;

-- ───────────────────────── Staff RPCs ─────────────────────────
create or replace function staff_assistant_reply(p_session uuid, p_content text, p_internal boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions; v uuid;
begin
  select * into s from assistant_sessions where id = p_session for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if not (can('assistant','reply') and assistant_staff_can(s.org_id)) then raise exception 'FORBIDDEN'; end if;
  if length(coalesce(trim(p_content),'')) = 0 then raise exception 'INVALID_MESSAGE'; end if;
  insert into assistant_messages(session_id, org_id, author, author_user_id, content, hidden_from_customer)
    values (p_session, s.org_id, 'staff', auth.uid(), p_content, coalesce(p_internal,false)) returning id into v;
  if not coalesce(p_internal,false) then
    update assistant_sessions set status = case when status = 'closed' then status else 'human' end, last_message_at = now() where id = p_session;
    update escalations set taken_by_staff_id = coalesce(taken_by_staff_id, auth.uid()), taken_at = coalesce(taken_at, now())
      where id = s.escalation_id;
    perform emit_event('assistant.staff_replied', 'assistant_session', p_session, jsonb_build_object('org_id', s.org_id));
  end if;
  return v;
end $$;

create or replace function take_over_session(p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions; v_esc uuid;
begin
  select * into s from assistant_sessions where id = p_session for update;
  if not (can('assistant','take_over') and assistant_staff_can(s.org_id)) then raise exception 'FORBIDDEN'; end if;
  if s.escalation_id is null or exists(select 1 from escalations where id = s.escalation_id and resolved_at is not null) then
    v_esc := escalate_session(p_session, 'staff_take_over', null, null);
  else v_esc := s.escalation_id; end if;
  update escalations set taken_by_staff_id = auth.uid(), taken_at = coalesce(taken_at, now()), assigned_to = coalesce(assigned_to, auth.uid()) where id = v_esc;
  update assistant_sessions set status = 'human' where id = p_session;
  perform write_audit('assistant.take_over', 'assistant_sessions', p_session::text, null);
  return v_esc;
end $$;

create or replace function resolve_escalation(p_session uuid, p_outcome text, p_close_session boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions;
begin
  select * into s from assistant_sessions where id = p_session for update;
  if not (can('assistant','close') and assistant_staff_can(s.org_id)) then raise exception 'FORBIDDEN'; end if;
  update escalations set resolved_at = now(), outcome = p_outcome where id = s.escalation_id and resolved_at is null;
  update assistant_sessions set status = case when p_close_session then 'closed' else 'bot' end,
         ended_at = case when p_close_session then now() else ended_at end where id = p_session;
  insert into assistant_messages(session_id, org_id, author, content) values (p_session, s.org_id, 'system',
    case when p_close_session then 'Conversation closed by your account manager.' else 'Your account manager handed the conversation back to Octo.' end);
  perform write_audit('assistant.resolved', 'assistant_sessions', p_session::text, jsonb_build_object('outcome', p_outcome));
end $$;

create or replace function log_assistant_open(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s assistant_sessions;
begin
  select * into s from assistant_sessions where id = p_session;
  if not assistant_staff_can(s.org_id) then raise exception 'FORBIDDEN'; end if;
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'assistant.opened', 'assistant_sessions', p_session::text, jsonb_build_object('org_id', s.org_id));
end $$;

create or replace function set_out_of_office(p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not user_is_staff(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  update profiles set out_of_office = p_value where id = auth.uid();
  perform write_audit('assistant.out_of_office', 'profiles', auth.uid()::text, jsonb_build_object('value', p_value));
end $$;

-- ───────────────────────── Account-manager assignment ─────────────────────────
create or replace function assign_account_manager(p_org uuid, p_reason text default 'auto') returns uuid
language plpgsql security definer set search_path = public as $$
declare o organizations; v_team text; v_cap int := coalesce((setting('assistant_max_customers_per_manager'))::text::int, 50); v_staff uuid; v_existing uuid;
begin
  select staff_user_id into v_existing from account_managers where org_id = p_org;
  if v_existing is not null then return v_existing; end if;
  select * into o from organizations where id = p_org;
  v_team := coalesce(setting('assistant_team_country_map') ->> o.country, setting('assistant_team_country_map') ->> 'default', 'Sourcing');
  -- sourcing agents in the mapped team, not out of office, under the cap, least loaded first, then least recently assigned
  select ur.user_id into v_staff
  from user_roles ur join profiles p on p.id = ur.user_id
  where ur.role_code = 'sourcing_agent' and p.active and not p.out_of_office and (coalesce(p.team, 'Sourcing') = v_team)
    and (select count(*) from account_managers a where a.staff_user_id = ur.user_id) < v_cap
  order by (select count(*) from account_managers a where a.staff_user_id = ur.user_id) asc,
           (select max(assigned_at) from account_managers a where a.staff_user_id = ur.user_id) asc nulls first
  limit 1;
  if v_staff is null then
    -- fall back to any sourcing agent under the cap
    select ur.user_id into v_staff from user_roles ur join profiles p on p.id = ur.user_id
    where ur.role_code = 'sourcing_agent' and p.active and not p.out_of_office and (select count(*) from account_managers a where a.staff_user_id = ur.user_id) < v_cap
    order by (select count(*) from account_managers a where a.staff_user_id = ur.user_id) asc limit 1;
  end if;
  if v_staff is null then return null; end if;
  insert into account_managers(org_id, customer_user_id, staff_user_id, team, assigned_by, reason)
    values (p_org, (select user_id from org_members where org_id = p_org order by created_at limit 1), v_staff, v_team, auth.uid(), p_reason);
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'assistant.assigned', 'organizations', p_org::text, jsonb_build_object('staff', v_staff, 'team', v_team, 'reason', p_reason));
  return v_staff;
end $$;

create or replace function reassign_account_manager(p_org uuid, p_staff uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or can('assistant','reassign')) then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  if not user_is_staff(p_staff) then raise exception 'NOT_STAFF'; end if;
  insert into account_managers(org_id, customer_user_id, staff_user_id, team, assigned_by, reason)
    values (p_org, (select user_id from org_members where org_id = p_org order by created_at limit 1), p_staff, (select team from profiles where id = p_staff), auth.uid(), p_reason)
  on conflict (org_id) do update set staff_user_id = excluded.staff_user_id, team = excluded.team, assigned_at = now(), assigned_by = auth.uid(), reason = excluded.reason;
  insert into audit_log(actor_id, action, entity, entity_id, details) values (auth.uid(), 'assistant.reassigned', 'organizations', p_org::text, jsonb_build_object('staff', p_staff, 'reason', p_reason));
end $$;

-- auto-assign on KYC verification
create or replace function trg_assign_on_kyc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kyc_status = 'verified' and old.kyc_status is distinct from 'verified' then perform assign_account_manager(new.id, 'kyc_verified'); end if;
  return new;
end $$;
create trigger trg_org_assign_account_manager after update of kyc_status on organizations for each row execute function trg_assign_on_kyc();

-- ───────────────────────── Metrics ─────────────────────────
create or replace function assistant_metrics(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_admin() or can('assistant','configure') or can('assistant','reassign')) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'sessions', count(*),
    'resolved_by_bot', count(*) filter (where escalation_id is null and exists(select 1 from assistant_messages m where m.session_id = s.id and m.author = 'bot')),
    'escalated', count(*) filter (where escalation_id is not null),
    'bot_resolution_rate', round(100.0 * count(*) filter (where escalation_id is null) / nullif(count(*),0), 1),
    'escalation_rate', round(100.0 * count(*) filter (where escalation_id is not null) / nullif(count(*),0), 1),
    'satisfaction', (select round(100.0 * count(*) filter (where thumbs_up) / nullif(count(*),0), 1) from assistant_feedback f where f.created_at between p_from and p_to),
    'sla_breaches', (select count(*) from escalations e where e.requested_at between p_from and p_to and coalesce(e.taken_at, now()) > e.sla_due_at),
    'sla_breach_rate', (select round(100.0 * count(*) filter (where coalesce(e.taken_at, now()) > e.sla_due_at) / nullif(count(*),0), 1) from escalations e where e.requested_at between p_from and p_to),
    'avg_latency_ms', (select round(avg(latency_ms)) from assistant_messages m where m.author = 'bot' and m.created_at between p_from and p_to),
    'tokens', (select coalesce(sum(tokens),0) from assistant_messages m where m.author = 'bot' and m.created_at between p_from and p_to))
  into v from assistant_sessions s where s.started_at between p_from and p_to;
  return v;
end $$;

-- ───────────────────────── Grants ─────────────────────────
do $$ declare f text;
begin
  foreach f in array array['start_assistant_session(text,text)','post_customer_message(uuid,text,text)','assistant_feedback_set(uuid,boolean,text)',
                           'set_assistant_opt_out(boolean)','escalate_session(uuid,escalation_reason,text,numeric)','staff_assistant_reply(uuid,text,boolean)',
                           'take_over_session(uuid)','resolve_escalation(uuid,text,boolean)','log_assistant_open(uuid)','set_out_of_office(boolean)',
                           'reassign_account_manager(uuid,uuid,text)','assistant_metrics(timestamptz,timestamptz)','my_account_team()','assistant_staff_can(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['record_bot_reply(uuid,text,numeric,jsonb,integer,integer)','assign_account_manager(uuid,text)','trg_assign_on_kyc()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Realtime for live threads
do $$ begin
  begin alter publication supabase_realtime add table assistant_messages, assistant_sessions, escalations; exception when others then null; end;
end $$;

-- ───────────────────────── Demo account manager ─────────────────────────
-- support@ also acts as the Sourcing-team account manager in the demo; existing verified customers get assigned.
do $$
declare v_staff uuid; o record;
begin
  select id into v_staff from profiles where email = 'support@demo.octopusb2b.com';
  if v_staff is not null then
    insert into user_roles(user_id, role_code) values (v_staff, 'sourcing_agent') on conflict do nothing;
    update profiles set team = 'Sourcing', title = 'Dedicated account manager', office = coalesce(office, 'Shenzhen office') where id = v_staff;
    for o in select id from organizations where kyc_status = 'verified' and not exists(select 1 from account_managers a where a.org_id = organizations.id) loop
      perform assign_account_manager(o.id, 'backfill');
    end loop;
  end if;
end $$;

