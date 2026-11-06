# ADDON-30 readiness checklist — Dubai data centre (Stage 1: database + storage + backups)

Owner decision (6 Nov 2026): **do not migrate yet**; produce a readiness checklist. Nothing in this repo was changed for ADDON-30.

## 1. What the app actually depends on today (measured in the repo)

| Supabase feature | Usage in code | Why it matters for Dubai |
|---|---|---|
| PostgREST (`sb.from(...)`) | ~765 calls | The app does **not** open its own SQL connection for page data; it calls the Supabase REST API. A bare Postgres in Dubai is not enough — you need PostgREST (or self-hosted Supabase) in front of it, or a rewrite of ~765 queries. |
| RPCs (`sb.rpc(...)`) | ~176 calls | Same as above: served by PostgREST. All money / ledger logic lives in these SQL functions. |
| RLS with `auth.uid()` / JWT claims | every table | Policies read Supabase-issued JWT claims. Dubai Postgres must accept the same JWTs (shared JWT secret / JWKS) or every policy breaks. |
| Supabase Auth (GoTrue) | sign-in, MFA/TOTP, Google for customers, password reset | Spec 30-A keeps Supabase Auth in phase 1 — but Auth stores users in the **same database** (`auth.users`, `auth.mfa_factors`). Splitting Auth from data needs a plan (self-hosted GoTrue in Dubai, or keep the whole DB on Supabase). |
| Storage buckets | `product-media`, `kyc`, `tickets`, `imports`, `turnkey-floorplans` (~23 call sites) | Signed upload URLs (bulk import, floor plans) are a Supabase Storage feature; MinIO needs an equivalent presign flow in a `storage.ts` adapter. |
| Realtime channels | 3 components | Needs self-hosted Realtime or a replacement (polling / SSE). |
| `pg_cron` jobs | 9 schedules | Must be recreated on the Dubai primary. |
| Vault secrets | `octopus_app_url` and others | Recreate in Dubai (pgsodium / Vault) or move to env. |
| `pgvector` | assistant | Extension must be installed. |

**Implication:** the realistic Stage-1 option is **self-hosted Supabase (Docker: Postgres + PostgREST + GoTrue + Storage-API on MinIO + Realtime) in Dubai**, not "plain Postgres + MinIO". That keeps every `sb.from/rpc`, RLS policy and auth flow unchanged and makes the cut-over an env-var flip (`NEXT_PUBLIC_SUPABASE_URL`, keys, `DATABASE_URL`).

## 2. Decisions the owner must make before any work starts

- [ ] **Target stack**: self-hosted Supabase in Dubai (recommended, no app rewrite) vs. plain Postgres + MinIO (needs a data-access rewrite, months).
- [ ] **Who owns on-call** for the DC (database down at 3 am = site down). Name a person and a backup.
- [ ] **Data-residency need**: is a customer or regulator actually asking for UAE residency (PDPL)? If not, Stage 1 is a cost/latency project, not a compliance one.
- [ ] **Vercel ↔ Dubai network path**: Vercel Secure Compute (static egress IPs, paid add-on) or a TLS proxy in the DC. Without one of these, Postgres/PostgREST must be internet-exposed.
- [ ] **Downtime budget** for the cut-over (read-only window estimate after a dry run: 30–90 min for the current data size).
- [ ] **Rollback rule**: how long Supabase stays as hot standby (spec: 1 week) and who decides to roll back.

## 3. Infrastructure prerequisites (DC side)

- [ ] 2 database hosts (primary + hot standby, different rack/power), NVMe, 16+ cores, 64 GB+ RAM.
- [ ] 3-node MinIO (erasure-coded) or equivalent S3 storage; second-site S3 bucket for off-site backups.
- [ ] Dedicated IP, DNS records (e.g. `db.hostoctopus.com`, `api.hostoctopus.com`), TLS certificates with auto-renewal.
- [ ] VPN for admin access; `pg_hba.conf` restricted to Vercel egress + VPN.
- [ ] Secrets manager (Vault / 1Password) and a rotation procedure.
- [ ] Monitoring: Prometheus + Grafana + Alertmanager → phone (replica lag, disk, backup age, cert expiry).
- [ ] Backup tooling: nightly `pg_dump`, WAL archiving (wal-g / pgBackRest), weekly automated restore test.

## 4. App-side work needed (estimate, not started)

- [ ] `lib/storage.ts` adapter only if NOT using self-hosted Supabase Storage.
- [ ] `/admin/system-health` page (primary/replica state, replica lag, last backup, last restore test, free disk) — reads from the DC's monitoring API.
- [ ] `site_settings`: `infra.region`, `infra.data_residency_statement` (privacy-page footer), `infra.db_primary`, `infra.db_replica`.
- [ ] Read-only maintenance mode switch for the cut-over window (ADDON-16 maintenance notice already exists — needs a "block writes" flag).
- [ ] `pnpm db:verify` (row-count + checksum per table) for the restore test and the cut-over check.
- [ ] Run the full test suite (unit, DB, E2E, smoke) against the Dubai stack before the switch.

## 5. Things to fix first regardless (found while checking)

- [ ] Rotate the leaked keys (Supabase service role, DB password, OpenAI, Google client secret) — a migration copies secrets around; do it with fresh ones.
- [ ] Take and restore-test a full backup (`pnpm db:backup` exists; a restore drill has not been run on a scratch project).

## 6. Recommended order

1. Decide §2. 2. Build the DC per §3 and run self-hosted Supabase there with a **copy** of production. 3. Point a Vercel preview deployment at it and run every test. 4. Dry-run the cut-over and measure downtime. 5. Only then schedule the production window (spec 30-A step 8).

Stage 2 (moving the Next.js app off Vercel) and Stage 3 (HA/DR/multi-region) should wait until Stage 1 has run for 2–3 months, as the add-on itself recommends.

