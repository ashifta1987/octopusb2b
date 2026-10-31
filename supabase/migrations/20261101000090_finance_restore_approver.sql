-- SPEC §16.3: "Second approver: Finance for anything touching money". Finance may view backups and approve restores
-- (it cannot back up, download, export or request restores). Admin can change this in Staff & roles.
insert into role_permissions(role_code, area, action) values ('finance','backups','view'), ('finance','backups','approve_restore')
on conflict do nothing;
