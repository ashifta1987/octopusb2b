# Runbook — restore and disaster recovery (SPEC §16.3)

Targets: lose at most 24 h of data from own backups (minutes with PITR); be back online within **4 hours**.
Keep this file printed next to the offline age key. Setup of everything referenced here: [BACKUP-SETUP.md](BACKUP-SETUP.md).

**Decide first which case you are in**

| Situation | Use | Section |
| --- | --- | --- |
| Bad change in the last days (wrong bulk update, bad migration) and PITR is on | Supabase point-in-time recovery | [A](#a-point-in-time-rollback-supabase-pitr) |
| A few records deleted/damaged (product, customer, CMS page…) | Partial restore from the admin panel | [B](#b-partial-restore-records) |
| Rebuild staging from production data | Full restore → staging (admin panel) | [C](#c-full-restore-from-the-admin-panel-staging-or-production) |
| Production database corrupted but the Supabase project works | Full restore → production (admin panel) | [C](#c-full-restore-from-the-admin-panel-staging-or-production) |
| Supabase project / region lost, or app cannot reach the panel | Manual disaster recovery into a **new project** | [D](#d-disaster-recovery-into-a-new-supabase-project-manual) |

Money is never "restored over": ledger, journals, payments, wallets, orders, invoices and approvals are only compared.
Corrections there go through finance adjustments.

---

## A. Point-in-time rollback (Supabase PITR)

Requires the PITR add-on (Admin → Backup & restore shows PITR on/off). It rolls back the **whole database**, not Storage.

1. Note the exact time just **before** the bad change (UTC). Check `audit_log` / the admin audit page.
2. Turn maintenance mode on: Admin → Settings (or SQL: `select set_maintenance(true, 'Restoring data', 1800);`).
3. Supabase Dashboard → project → **Database → Backups → Point in time** → choose date + time → *Review restore* → confirm.
   The project is unavailable for a few minutes to hours depending on size.
4. When the dashboard shows the project healthy: run `node scripts/db-migrate.mjs` with `DATABASE_URL` = production
   (re-applies migrations newer than the restore point; no-op otherwise).
5. Revalidate caches: trigger a deploy in Vercel (or `POST /api/backups/status` `{"type":"revalidate"}` signed — the restore
   workflow does this automatically).
6. Turn maintenance mode off (`select set_maintenance(false);`) and smoke-test: storefront, login, an order page, wallet balance,
   Admin → Finance ledger check (one row per currency, all balanced).
7. Write what happened in the audit log / incident note. Events after the restore point (payments, webhooks) must be
   reconciled from the providers' dashboards.

## B. Partial restore (records)

1. Admin → Backup & restore → **Restore** → choose the backup taken before the damage → type *Partial* → modules
   (e.g. products, cms) and optionally record IDs → reason.
2. **Verify**: the app dispatches `restore.yml` (mode `partial`, environment `restore-production` → a GitHub reviewer approves).
   The workflow loads only those tables from the backup into the `recovery` schema (production `public` is not touched).
3. A second approver approves in the panel (Finance if money modules are included, otherwise another Admin; both with 2FA).
4. **Run** re-loads the recovery tables (fresh) and marks the request completed.
5. Compare screen: rows are `missing` (deleted since), `changed` or `same`. Select rows → *Restore selected* →
   `restore_records(table, ids, reason)` upserts them and writes the audit log. Money tables are refused (`MONEY_RECORDS_NOT_RESTORABLE`).
6. Restore child tables after parents (e.g. `products` → `price_tiers`, `product_specs`, `product_media`).
7. Files (product images, PDFs) referenced by restored rows: if missing, take them from the backup's `storage/<bucket>.tar.gz.age`
   (decrypt as in D.4) and upload the single files in Supabase Storage.

## C. Full restore from the admin panel (staging or production)

1. Admin → Backup & restore → **Restore** → backup → *Full → staging* or *Full → production* → reason.
2. **Verify first**: restores into the scratch project and posts the checks (checksums, row counts, ledger balanced per
   currency, migration version, integration keys). Any failed check blocks approval.
3. Second approver approves in the panel (Finance — a full restore touches money). Both re-enter 2FA.
4. **Run**. For production, GitHub asks the `restore-production` reviewers to approve the job (Actions → the run → *Review deployments*).
   The workflow then:
   1. saves the backup catalogue (backups / restore history) and turns **maintenance mode on** (storefront notice, API `503` +
      `Retry-After`, outbox paused);
   2. wipes the target (`public`, `recovery`, auth users, storage metadata) and loads roles + schema + data in **one transaction**
      (if anything fails, nothing changed and maintenance is turned off again);
   3. runs row-count + ledger checks, re-applies newer migrations, checks the migration version;
   4. restores every Storage bucket; re-imports the backup catalogue; revalidates caches (`products`, `site-content`, `currency`,
      `ads`, `service-prices`, `suppliers`) — the product search index (`products.search`) is part of the database;
   5. turns maintenance mode off and posts the report (email to the alert address + panel).
5. If the run fails **after** the database was replaced, maintenance stays ON on purpose. Read the failed checks in the panel /
   Actions log, fix (often: re-run the workflow from Actions with the same `restore_id`, mode `run`, target `production`), then
   `select set_maintenance(false);`.
6. After every production restore: re-enter integration credentials if the checklist says so (§D.6), reconcile payments and
   carrier webhooks received after the backup time, check `select * from cron.job` lists the `octopus-*` jobs.

## D. Disaster recovery into a new Supabase project (manual)

Use when the production project or region is gone. You need: the offline age **private key**, read access to the off-site
bucket, the GitHub repo, Vercel access, DNS access. Work on a laptop with `psql` 17, `age`, `rclone`, `node` 24, `pnpm`.

### D.1 New Supabase project
1. Supabase → New project (same or nearby region, e.g. Singapore/Tokyo), strong DB password, same Postgres major version as the
   manifest's dump (or newer). Enable PITR if it was on.
2. Note: project ref, `SUPABASE_URL`, anon key, service-role key, DB connection string (Settings → Database → *Session pooler* or direct, port 5432).
3. Auth → URL configuration: set Site URL + redirect URLs to the production domain. Re-create SMTP / auth providers settings if used.
4. Enable the extensions the schema needs if the dump reports them missing (`pg_cron`, `pg_net`, `pgcrypto`, `pg_trgm`): Database → Extensions.

### D.2 Fetch and verify the backup
```bash
export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER=Other \
  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=… RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=… \
  RCLONE_CONFIG_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com RCLONE_CONFIG_OFFSITE_REGION=auto
rclone lsd offsite:octopus-backups                       # list backups (BK-YYYY-MMDD-HHMM)
CODE=BK-2026-1101-0200
rclone copy offsite:octopus-backups/$CODE ./restore/files
node scripts/backup/verify-files.mjs --dir restore/files --out restore/checks.json   # must print PASS checksums
```

### D.3 Restore the database
```bash
mkdir -p restore/plain
for f in roles schema data; do age -d -i ~/octopus-backup.key restore/files/db/$f.sql.gz.age | gunzip > restore/plain/$f.sql; done
node scripts/backup/prepare-restore.mjs --roles restore/plain/roles.sql --roles-out restore/plain/roles.safe.sql \
  --reset-out restore/reset.sql --post-out restore/post.sql
export NEW_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
psql --single-transaction -v ON_ERROR_STOP=1 \
  -f restore/reset.sql -f restore/plain/roles.safe.sql -f restore/plain/schema.sql \
  -c 'SET session_replication_role = replica' -f restore/plain/data.sql -f restore/post.sql \
  --dbname "$NEW_DB_URL"
node scripts/backup/checks.mjs --db-url "$NEW_DB_URL" --manifest restore/files/manifest.json --append restore/checks.json --only row_counts,ledger_balanced,integration_keys
DATABASE_URL="$NEW_DB_URL" node scripts/db-migrate.mjs           # re-apply migrations newer than the backup
node scripts/backup/checks.mjs --db-url "$NEW_DB_URL" --manifest restore/files/manifest.json --append restore/checks.json --only migration_version --after-migrate
```
All checks must be `PASS` (`integration_keys` is a `NOTE`). On a brand-new project `reset.sql` only removes empty objects.
If `psql` stops on an error, nothing was written (single transaction): fix the cause (missing extension, Postgres version) and re-run.
Then check pg_cron jobs: `select jobname from cron.job;` — if the `octopus-*` jobs are missing, re-run the cron section of
`supabase/migrations/20261101000051_api_pg_cron.sql` in the SQL editor.

### D.4 Restore Storage
```bash
mkdir -p restore/storage
for f in restore/files/storage/*.tar.gz.age; do b=$(basename "$f" .tar.gz.age); mkdir -p restore/storage/$b
  age -d -i ~/octopus-backup.key "$f" | tar -xzf - -C restore/storage/$b; done
SUPABASE_URL=https://<new-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<new service role> \
  node scripts/backup/storage.mjs upload --dir restore/storage --manifest restore/files/manifest.json --out restore/storage-check.json
```
Buckets are re-created with the same public/private flag (`product-media`, `banners` public; `kyc`, `documents`, `tickets`, `certificates`, `exports` private).

### D.5 Point the app at the new project (Vercel)
Vercel → Project → Settings → Environment Variables (Production), then **Redeploy**:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (if used by scripts),
plus unchanged: `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `WEBHOOK_SIGNING_SECRET`, `BACKUP_CALLBACK_SECRET`, `GITHUB_REPO`,
`GITHUB_ACTIONS_TOKEN`, `BACKUP_S3_*`. Update the GitHub secrets `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_PROJECT_REF`, `PRODUCTION_DB_URL` / `TARGET_SUPABASE_*` (environment `restore-production`).

### D.6 Re-enter integration secrets
Secrets in Supabase Vault are encrypted with the old project's key and cannot be decrypted in the new project. Re-enter each one
(Admin → Integrations, and Vercel env vars), then use *Test connection*:

| Integration | Where | What |
| --- | --- | --- |
| YunExpress (carrier) | Admin → Integrations → YunExpress | API customer code + key/secret, webhook secret; update the webhook URL in the YunExpress portal if the domain changed |
| Payment provider | Admin → Integrations → Payment + Vercel `PAYMENT_WEBHOOK_SECRET` | API keys; re-register the webhook endpoint `/api/webhooks/payment` |
| Email (Resend) | Vercel `EMAIL_API_KEY`, `EMAIL_FROM` | verify the sending domain DNS records still exist |
| Postman API partner | Admin → Integrations → Postman + `POSTMAN_API_KEY` | re-run the collection sync |
| OpenAI | Vercel `OPENAI_API_KEY`, `AI_MODEL` | — |
| Outgoing webhooks | customers' `webhook_endpoints` rows are restored; their signing secrets too (DB) | nothing unless secrets were in Vault |

### D.7 DNS
If the domain stays on Vercel, nothing changes. If you moved hosting: update the `A`/`CNAME` records to the new target,
keep TTL low (300 s) during the incident, verify HTTPS certificates are issued. Custom auth email links use `NEXT_PUBLIC_SITE_URL`.

### D.8 Checks before reopening
- [ ] `restore/checks.json`: checksums, row counts, ledger balanced (USD + CNY), migration version all **PASS**
- [ ] Storage check PASS; open a product image, a PDF document and a KYC file as staff
- [ ] Login as admin@, buyer@, finance@ (demo) or real staff; 2FA works
- [ ] Storefront lists products with correct currency; cart/RFQ works
- [ ] Admin → Finance: ledger check balanced per currency; wallet balances match the manifest's ledger totals
- [ ] `/api/health` OK; `/api/v1/openapi.json` 200; a sandbox API call works
- [ ] Vercel crons run (`/api/cron/outbox` returns `paused: false`), `select * from cron.job` lists the jobs
- [ ] Maintenance mode **off**: `select maintenance_enabled();` → false
- [ ] Take a fresh backup (Admin → Back up now) and confirm it completes
- [ ] Record the incident: time of loss, backup used, data gap, reconciliation of payments/shipments after the backup time

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `GITHUB_NOT_CONFIGURED` in the panel | Set `GITHUB_REPO` + `GITHUB_ACTIONS_TOKEN` in Vercel and redeploy |
| Backup stuck "queued" | Workflow not started: check the token's *Actions: write* permission and `GITHUB_DISPATCH_REF`. Rows older than 3 h no longer block a new backup |
| `BAD_SIGNATURE` in workflow logs | `BACKUP_CALLBACK_SECRET` differs between GitHub and Vercel, or the runner clock is off |
| `psql: invalid command \restrict` | Use psql 17.6+ (the workflow installs PGDG `postgresql-client-17`) |
| `permission denied to set parameter "session_replication_role"` | Connect as `postgres` (not a pooler in transaction mode); use the session pooler/direct URL |
| Delete on `storage.objects` refused | Newer Supabase blocks direct deletes; the reset sets `storage.allow_delete_query`. If still refused, delete the scratch project's buckets in the dashboard and re-run |
| Row counts differ after restore | Something wrote during the restore (scratch app running?) or a table is excluded from the dump; compare `data.diffs` in the check |
| Ledger check fails | Never "fix" by editing ledger rows; restore from an older backup or raise finance adjustments |
| Maintenance stuck ON after a failed production restore | Intentional — follow C.5, then `select set_maintenance(false);` |
