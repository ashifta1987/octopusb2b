# Add-on: data backup and restore

The same text as docs/SPEC.md section 16, kept here so the Antigravity prompt is easy to find. Screen design: docs/design/Backups.png and docs/design/html/Backups.html.

## 16. Addendum: data backup and restore

Added 1 Nov 2026. Admin can back up all data on demand or on a schedule, download it, and restore ("reinstall") all of it or only selected records. This section extends sections 11 and 12.

### 16.1 Three layers of backup

| Layer | What it covers | How often | Where it is kept | Used for |
| --- | --- | --- | --- | --- |
| 1. Supabase managed backups + point-in-time recovery (PITR add-on) | The whole Postgres database | Continuous (PITR) and daily | Inside Supabase | Fast rollback of the production database to a minute in the past |
| 2. Octopus own backups | Database dump (schema, data, roles) + every Storage bucket (product media, KYC, PDFs, QC reports, ticket files) | Nightly 02:00 China time, plus "Back up now" | Off-site object storage at a different provider (e.g. Cloudflare R2, AWS S3 or Backblaze B2), encrypted | Full restore to a new project, disaster recovery, downloads, partial restores |
| 3. Business data exports | Readable files per module: customers and KYC status, suppliers, products and categories, orders, invoices, ledger, wallet, services, tickets, CMS content | On demand, and monthly | Download (signed URL) and off-site storage | Accounting, audits, moving data, re-importing records |

Why layer 2 matters: Supabase database backups do not include the files in Storage, and depending only on the hosting provider is a single point of failure.

Retention (admin setting): 14 daily, 8 weekly, 12 monthly backups; exports 12 months. Targets: lose at most 24 hours of data from layer 2 (minutes with PITR); be back online within 4 hours.

### 16.2 How backups run

- A GitHub Actions workflow `backup.yml` (scheduled and `workflow_dispatch`) runs `supabase db dump` for roles, schema and data, and syncs every Storage bucket with `rclone`. It compresses and encrypts each file with a public key (the private key is held offline by the owner), uploads to the off-site bucket, and writes a manifest: file list, sizes, SHA-256 checksums, row counts per table, ledger totals per currency, and the migration version.
- "Back up now" in the admin panel calls an Edge Function that starts the workflow through the GitHub API. The workflow reports progress back to the `backups` table.
- Integration secrets in Supabase Vault are encrypted with the project's own key and cannot be decrypted in another project. After a full restore to a new project, admin re-enters integration credentials. The restore checklist shows which ones.

### 16.3 Restore ("reinstall all the data")

| Type | When | How |
| --- | --- | --- |
| Point-in-time rollback | Bad change in the last days (e.g. wrong bulk update) | Supabase PITR to a chosen minute, run by the owner from the Supabase dashboard following the runbook |
| Full restore | Disaster, move to a new Supabase project or region, rebuild staging | Workflow `restore.yml` restores the chosen backup into a target project, re-applies newer migrations, restores Storage, runs checks, then the app is pointed at it |
| Partial restore | A product, customer, order or CMS page was deleted or damaged | The backup is loaded into a separate `recovery` schema; admin compares records side by side and restores selected rows through an RPC that writes the audit log. Money records are never overwritten; corrections go through finance adjustments |
| Re-import from exports | Load customers, products or categories into a fresh system, or from another system | Upload the export file; reuses the bulk-upload validation and row-error report |

Restore workflow (`restore_requests`: draft → verifying → verified → pending\_approval → approved → running → completed / failed / cancelled):

1. Admin picks a backup and the restore type, and writes a reason.
2. **Verify first:** the backup is restored into a scratch project. Checks: checksums match the manifest, row counts match, every ledger journal balances per currency, the migration version is known.
3. Second approver: Finance for anything touching money, otherwise another Admin. The requester cannot approve. Both re-enter 2FA.
4. For a full restore to production: maintenance mode on (storefront shows a notice, API returns `503` with `Retry-After`, queues pause), restore runs in a GitHub protected environment that also needs manual approval, migrations are re-applied, caches revalidated, the search index rebuilt, queues resumed, then maintenance mode off.
5. After the restore: compare checks again, email admins the report, and record everything in the audit log.

### 16.4 Admin screen: Backup & restore (`/admin/backups`)

- **Status:** last successful backup, next scheduled run, off-site storage used, PITR on/off, the last restore drill and its result.
- **Backups table:** time, type (scheduled/manual), what is included (database, storage), size, checksum check, status. Actions: download (admin only, 2FA re-check, link valid 10 minutes), verify, restore.
- **Back up now** button with a progress bar.
- **Restore wizard:** choose backup → choose type (full / partial by module and records / to staging) → verification results → approval → run → report.
- **Data exports:** choose modules, date range, format (Excel, CSV, JSON), then download, and optionally email the link to the admin.
- **Settings:** schedule, retention, off-site storage connection (test connection), encryption key fingerprint, alert email.
- Permission area "Backups & restore" in the roles matrix: view, back up, download, export, request restore, approve restore. Admin only by default.

Data model additions: `backups` (kind, trigger, status, started\_at, finished\_at, size\_bytes, location, manifest jsonb, migration\_version, created\_by), `backup_files`, `restore_requests`, `restore_checks`, `data_exports`, `recovery` schema, `site_settings.maintenance_mode`.

Monitoring: alert the admin email and Sentry if a nightly backup is missing or fails; a monthly automatic restore drill restores the latest backup into a scratch project and posts the checks to the admin panel.

### 16.5 Antigravity prompt

Run this after P7 (finance approvals exist) and before P10. If the app is already live, run it now.

**Prompt 16-A — Backup and restore**

```
Read docs/SPEC.md section 16 (backup and restore) and sections 6, 10, 11 and 12. Build the backup and restore system:
1. Migrations: backups, backup_files, restore_requests (draft -> verifying -> verified -> pending_approval -> approved -> running -> completed/failed/cancelled), restore_checks, data_exports, a recovery schema, site_settings.maintenance_mode and backup settings (schedule, retention). Add the permission area "Backups & restore" with actions view, backup, download, export, request_restore, approve_restore. Everything admin-only by default, with RLS and audit log.
2. GitHub Actions backup.yml (cron 18:00 UTC = 02:00 China time, plus workflow_dispatch): supabase db dump for roles, schema and data; rclone sync of every Storage bucket; compress; encrypt with the public key from secrets (age); upload to the off-site S3-compatible bucket; write a manifest with SHA-256 checksums, row counts per table, ledger totals per currency and the migration version; report status to the backups table through a secured Edge Function. Apply retention (14 daily, 8 weekly, 12 monthly).
3. GitHub Actions restore.yml (workflow_dispatch, GitHub protected environment needing manual approval): restore a chosen backup into a target project, re-apply newer migrations, restore Storage, run checks (checksums, row counts, ledger balanced per currency), and post results to restore_checks. Support target = scratch, staging or production. For production: turn maintenance mode on first, pause queues, then revalidate caches, rebuild search, resume queues and turn maintenance mode off.
4. Edge Functions: backup-trigger and restore-trigger (start the workflows through the GitHub API; admin role and a recent 2FA check required), backup-status (signed callback from the workflows), backup-download (10-minute signed URL, audited).
5. Partial restore: load the chosen tables from a backup into the recovery schema; a side-by-side compare screen; RPC restore_records(table, ids, reason) that copies selected rows back, never overwrites ledger or payment rows, and writes the audit log.
6. Data exports: per module (customers, suppliers, products, categories, orders, invoices, ledger, wallet, services, tickets, CMS) as Excel, CSV or JSON, built by a queue worker, stored privately, downloadable by signed URL and optionally emailed. Re-import uses the existing bulk-upload validation.
7. Maintenance mode: storefront and portals show a CMS notice; API returns 503 with Retry-After; outbox dispatcher pauses.
8. Build /admin/backups to match docs/design/Backups.png and docs/design/html/Backups.html: status cards, backups table with download/verify/restore, Back up now with progress, restore wizard with verification results and approvals, data exports, and settings (schedule, retention, off-site storage test, key fingerprint, alert email).
9. Monitoring: alert if no successful backup in 26 hours; monthly restore drill into a scratch project with results shown in the panel.
10. Write docs/RUNBOOK-restore.md: full disaster recovery step by step (new Supabase project, migrations, restore, Storage, re-enter Vault secrets for each integration, Vercel env vars, DNS, checks).
Tests: pgTAP for permissions and that restore_records refuses ledger rows; a CI job that backs up the staging database and restores it into a scratch database and compares counts and ledger totals.
```

Done when: the nightly backup appears in the panel with a valid checksum; "Back up now" works; a restore drill into scratch passes all checks; a deleted product is recovered through partial restore; the runbook rebuilds staging from a backup without help.
