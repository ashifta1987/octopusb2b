# Backup setup (SPEC §16)

One-time setup for Octopus own backups (layer 2), restores and data exports. Do these steps in order. Nothing secret is
ever stored in the database: `backup_settings` only holds display values (provider, bucket, key fingerprint…).

| Piece | Where it runs |
| --- | --- |
| Nightly backup 02:00 China time + "Back up now" | GitHub Actions [`backup.yml`](../.github/workflows/backup.yml) |
| Verify / restore / partial restore | GitHub Actions [`restore.yml`](../.github/workflows/restore.yml) (protected environments) |
| Monthly restore drill | GitHub Actions [`restore-drill.yml`](../.github/workflows/restore-drill.yml) |
| Weekly staging → scratch drill (CI) | [`ci.yml`](../.github/workflows/ci.yml) job `backup-restore-drill` |
| Triggers, callbacks, downloads, exports, monitoring | The app: `/api/backups/*`, `/api/exports/*`, `/api/cron/backup-monitor` (daily Vercel cron) |

## 1. Off-site bucket (a different provider than Supabase)

Pick one S3-compatible store and create a **private** bucket, e.g. `octopus-backups`:

- **Cloudflare R2**: R2 → Create bucket → Manage R2 API tokens → *Object Read & Write* scoped to that bucket.
  Endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`, provider `Cloudflare`.
- **AWS S3**: create the bucket (block all public access, versioning optional), an IAM user with
  `s3:PutObject, s3:GetObject, s3:DeleteObject, s3:ListBucket` on that bucket only. Leave the endpoint empty, region e.g. `ap-east-1`, provider `AWS`.
- **Backblaze B2**: create bucket (private) + application key limited to it. Endpoint `https://s3.<region>.backblazeb2.com`, provider `Other`.

Retention is enforced by the workflow (14 daily, 8 weekly, 12 monthly — editable in Admin → Backup & restore → Settings).
Manual "Back up now" backups are kept until deleted by hand. Optionally add a bucket lifecycle rule that deletes objects
older than 400 days as a safety net.

## 2. Encryption key (age)

On the owner's computer (not a server): install [age](https://github.com/FiloSottile/age) (`brew install age`), then

```bash
age-keygen -o octopus-backup.key
# Public key: age1q…   ← the recipient (safe to share)
grep 'public key' octopus-backup.key
# fingerprint shown in the admin panel (first 16 hex chars of SHA-256 of the public key)
grep -o 'age1[0-9a-z]*' octopus-backup.key | head -1 | tr -d '\n' | shasum -a 256 | cut -c1-16
```

- Store `octopus-backup.key` **offline** (password manager + printed copy in a safe). Without it, backups cannot be decrypted.
- Put the **public key** in the GitHub secret `BACKUP_AGE_PUBLIC_KEY` and the fingerprint in `BACKUP_KEY_FINGERPRINT`
  and in Admin → Backup & restore → Settings → *Encryption key fingerprint*.
- The **private key** goes only into the protected restore environments (`BACKUP_AGE_PRIVATE_KEY`, the full
  `AGE-SECRET-KEY-1…` line). Rotate: generate a new pair, update both secrets; old backups still need the old private key.

## 3. GitHub repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Production **session pooler / direct** connection string (`postgresql://postgres.<ref>:<password>@…:5432/postgres`) used by `supabase db dump` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` (Storage download) |
| `SUPABASE_SERVICE_ROLE_KEY` | production service-role key (Storage download) |
| `SUPABASE_PROJECT_REF` | optional, recorded in the manifest |
| `BACKUP_AGE_PUBLIC_KEY` | `age1…` |
| `BACKUP_KEY_FINGERPRINT` | optional, recorded in the manifest |
| `BACKUP_S3_ENDPOINT` | e.g. `https://<account>.r2.cloudflarestorage.com` (empty for AWS) |
| `BACKUP_S3_BUCKET` | `octopus-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | the bucket-scoped key |
| `BACKUP_S3_REGION` | `auto` (R2) or the AWS/B2 region |
| `BACKUP_S3_PROVIDER` | optional rclone provider: `Cloudflare`, `AWS`, `Other` (default) |
| `APP_URL` | production app URL, e.g. `https://octopusb2b.com` (callbacks go to `$APP_URL/api/backups/status`) |
| `BACKUP_CALLBACK_SECRET` | long random string (`openssl rand -hex 32`) — same value as the Vercel env var |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | only if the deployment is protected (already used by CI) |
| `STAGING_DB_URL` | staging DB connection string (CI drill + `restore-staging`) |

Optional repository **variable** `BACKUP_EXCLUDE_BUCKETS` (comma list) skips buckets from the Storage backup.

## 4. GitHub environments (Settings → Environments)

Create three environments. Environment secrets override repository secrets with the same name.

| Environment | Required reviewers | Secrets |
| --- | --- | --- |
| `restore-scratch` | none (used by verify, drills and the CI job) | `SCRATCH_DB_URL`, `BACKUP_AGE_PRIVATE_KEY`, optional `TARGET_SUPABASE_URL` + `TARGET_SUPABASE_SERVICE_ROLE_KEY` of the scratch project (Storage in drills) |
| `restore-staging` | 1 admin | `STAGING_DB_URL`, `BACKUP_AGE_PRIVATE_KEY`, `TARGET_SUPABASE_URL`, `TARGET_SUPABASE_SERVICE_ROLE_KEY` (staging) |
| `restore-production` | **required: the owner + 1 admin, "Prevent self-review" on, deployment branch = `main` only** | `PRODUCTION_DB_URL`, `BACKUP_AGE_PRIVATE_KEY`, `TARGET_SUPABASE_URL`, `TARGET_SUPABASE_SERVICE_ROLE_KEY` (production) |

> [!IMPORTANT]
> `restore-production` must require manual approval. Full production restores **and partial restores** (which only write
> to the `recovery` schema of production) run there, so every production job is approved twice: in the app (maker–checker
> with 2FA) and in GitHub.

The scratch project is a separate, disposable Supabase project (free tier is fine): the workflow **wipes** its
`public` schema, auth users and storage metadata on every verify/drill.

## 5. Vercel environment variables (Production)

| Variable | Value |
| --- | --- |
| `GITHUB_REPO` | `owner/repo` |
| `GITHUB_ACTIONS_TOKEN` | fine-grained PAT (or GitHub App token) for this repository only, permission **Actions: Read and write** (needed for `workflow_dispatch`), 1-year expiry with a calendar reminder |
| `GITHUB_DISPATCH_REF` | optional, branch to run workflows from (default `main`) |
| `BACKUP_CALLBACK_SECRET` | same value as the GitHub secret |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` | as above |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | a **read-only** key is enough for downloads; the connection test also writes/deletes a small test object, so use read/write if you want the test to pass |
| `BACKUP_S3_PROVIDER` | optional display name |
| `CRON_SECRET` | already set (the daily `/api/cron/backup-monitor` uses it) |

Redeploy after adding them. Then in Admin → Backup & restore → Settings click **Test connection**.

## 6. First run

1. GitHub → Actions → *Backup* → Run workflow (trigger `manual`) — or click **Back up now** in the admin panel.
2. The panel shows the row going queued → running (5/40/70 %) → completed with a valid checksum.
3. Actions → *Restore drill* → Run workflow with `force` → the drill result appears under the last restore drill.
4. Run CI → *backup-restore-drill* (workflow_dispatch on `ci.yml`) once to confirm staging → scratch works.

## How it works (reference)

- Dumps: `supabase db dump --role-only`, schema, `--data-only --use-copy`, each `gzip | age -r <public key>` →
  `<code>/db/{roles,schema,data}.sql.gz.age`. Storage: every bucket downloaded through the service-role REST API
  ([`scripts/backup/storage.mjs`](../scripts/backup/storage.mjs) — no separate Storage S3 keys needed), `tar.gz | age` →
  `<code>/storage/<bucket>.tar.gz.age`. rclone uploads to `offsite:<bucket>/<code>/` and checks sizes.
- `manifest.json` ([`manifest.mjs`](../scripts/backup/manifest.mjs)): files + sizes + SHA-256, row counts per public table and
  ledger totals per currency **computed from the dump itself** (same snapshot), migration version (`max(_migrations.name)`), buckets.
- Callbacks are signed `Octopus-Signature: t=…,v1=HMAC-SHA256(t.body)` (5-minute window) and handled by
  `POST /api/backups/status` (`backup`, `restore`, `retention_plan`, `mark_expired`, `maintenance`, `revalidate`, `drill_start`, `restore_info`, `catalog`).
- Retention class: monthly on the 1st, weekly on Sundays, else daily (China time); manual backups are never auto-expired.
- Monitoring: `/api/cron/backup-monitor` (daily 01:30 UTC) emails `alert_email`, logs `integration_logs` (`backups`) and emits
  `backup.missing` when no backup succeeded within `alert_missing_hours` (26 h); queues the monthly export pack on the 1st;
  runs queued exports; expires old exports; dispatches the drill if none ran for 35 days.
- Exports: `request_export` → `POST /api/exports/[id]/run` (or the cron) builds xlsx (sheet per module) / csv (one file per
  sheet under `<code>/`) / json in the private bucket `exports`. The `products` sheet has exactly the bulk-upload template columns,
  so it can be re-imported through Distributor → Products → Import. KYC files, ticket attachments and API key hashes are never exported.
