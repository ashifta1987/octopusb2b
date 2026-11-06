-- ADDON-33: bulk template v2 — the images .zip of a job (private `imports` bucket) and the zip report.
alter table import_jobs add column if not exists zip_path text;
alter table import_jobs add column if not exists zip_unreferenced jsonb not null default '[]';
alter table import_jobs add column if not exists unchanged_rows int not null default 0;
alter table import_rows add column if not exists warnings jsonb;
