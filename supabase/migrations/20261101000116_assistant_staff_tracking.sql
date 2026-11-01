-- SPEC §20.5 — Octo side rail for the assigned account manager: carrier scans of their customers' shipments
-- (read-only; same rows the customer sees). Complements 20261101000115_assistant_staff.sql.
drop policy if exists te_assistant_read on tracking_events;
create policy te_assistant_read on tracking_events for select to authenticated using (assistant_staff_can(org_id));
