# Add-on: migrate to your Dubai data centre — staged, hybrid-first

## Why

You own a Dubai data centre with servers, backups and a dedicated IP line. Running the stack there (or part of it) gives you:
- **Data sovereignty** — important for UAE PDPL and GCC enterprise buyers who require local data residency.
- **Query speed** — co-locating the app and the database drops per-query latency from ~100 ms to under 1 ms, saving ~1 s on a typical page.
- **Predictable cost at scale** — your fixed-cost hardware replaces per-request cloud pricing.
- **IP whitelisting** — enterprise buyers can whitelist your dedicated IP for API integrations; Vercel's IPs rotate.
- **No vendor lock-in** — the whole stack is portable.

The plan is **staged**, not big-bang. Stage 1 moves the database and backups (80% of the benefit, 20% of the effort). Stage 2 moves the app server when you have DevOps capacity to own it. Stage 3 adds the advanced-ops layer (HA, DR, observability, zero-trust).

## Architecture

```
                          ┌──────────────────────────────────────┐
                          │          Cloudflare (global)         │
                          │  CDN · WAF · DDoS · Rate limits      │
                          │  Bot management · Zero Trust Access  │
                          └──────────────────┬───────────────────┘
                                             │  anycast
                     ┌───────────────────────┼────────────────────────┐
                     │                       │                        │
                 Stage 2+                Stage 1                  Stage 3
          ┌───────────────────┐   ┌──────────────────┐   ┌────────────────────┐
          │  App servers      │   │  Postgres primary│   │  Postgres replica   │
          │  (Next.js SSR +   │◀──┤  Dubai (Octopus  │   │  Hong Kong          │
          │   Edge Functions) │   │   DC, dedicated  │──▶│  (read-only, for    │
          │   Dubai DC        │   │   IP)            │   │   Shenzhen team)    │
          └────────┬──────────┘   └────────┬─────────┘   └────────────────────┘
                   │                       │
                   │              ┌────────▼────────┐
                   │              │  Backups        │
                   │              │  nightly full,  │
                   │              │  streaming WAL  │
                   │              │  (Octopus DC    │
                   │              │   + off-site    │
                   │              │   S3-compatible)│
                   │              └─────────────────┘
                   │
         ┌─────────▼─────────┐
         │  Object storage   │
         │  MinIO (S3 API)   │
         │  product images,  │
         │  invoices, QC     │
         │  reports          │
         └───────────────────┘
```

**Stage 1 (weeks 1–4):** Database + storage + backups on your DC. App stays on Vercel. Benefits: data residency, faster queries, backups you own. Risks: low — Vercel keeps handling traffic, DDoS, SSL, auto-scaling.

**Stage 2 (months 2–4):** Move the Next.js app to Dubai behind Cloudflare. Benefits: full cost control, true data sovereignty, lower per-request cost at scale. Risks: you now own deploys and uptime; needs a DevOps on-call rotation.

**Stage 3 (ongoing):** Advanced ops — HA, DR, observability, zero-trust, multi-region.

## Antigravity prompt 30-A — Stage 1: database + storage + backups to Dubai

```
Read docs/SPEC.md sections 6, 11, 12, 16 (backup/restore), 17 (staff login), ADDON-24 (demo data), ADDON-26 (China fonts), ADDON-27 (bulk import), ADDON-28 (PWA). We are moving the database and object storage to a self-hosted environment in a Dubai data centre. The Next.js app stays on Vercel for now.

Target topology:
- Postgres 16 primary on a dedicated host in Dubai (CPU 16 cores+, RAM 64 GB+, NVMe RAID10).
- Streaming replication to a hot-standby host in the same DC (different rack / power domain).
- Nightly logical backup (pg_dump --format=directory) + continuous WAL archiving (wal-g or barman) to S3-compatible storage in a second location.
- MinIO cluster (3 nodes, erasure-coded) for product images, invoices, QC reports, backup PDFs — presents an S3 API.
- Everything behind the dedicated IP, with TLS certs managed by a local nginx reverse proxy and renewed by acme.sh / Let's Encrypt.
- The Vercel app reaches Postgres and MinIO over the dedicated IP, over TLS, with a per-service user and least-privilege role.

1. Introduce an abstraction layer so the app can run against either Supabase or the Dubai stack by flipping env vars:
   - DATABASE_URL (Postgres connection string, with sslmode=require)
   - DATABASE_READ_URL (optional read-replica)
   - STORAGE_PROVIDER = 'supabase' | 's3'
   - STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY
   - AUTH_PROVIDER = 'supabase' | 'local' — local uses NextAuth with Postgres session store
   Wrap all DB calls through a single `db.ts` client (prisma or drizzle, whichever is already in use). Wrap storage calls through `storage.ts` with a thin provider interface (put, get, getSignedUrl, delete, list).

2. Schema export + import:
   - pg_dump the current Supabase database (schema + data + grants + RLS policies) as a logical backup.
   - Restore on the Dubai primary. Verify every table row count matches the source. Verify every RLS policy evaluates the same way against a sampled user.
   - Rebuild extensions: pgcrypto, pg_stat_statements, pg_cron, pgmq, pgvector (if assistant embeddings are used).
   - pg_cron jobs are Dubai-time (UTC+4); the cron expressions keep their current UTC semantics, so no change needed, but document the intent.

3. Storage migration:
   - Bulk copy every object from Supabase Storage to MinIO with mc mirror, preserving content-type and metadata.
   - Public buckets stay public via nginx + MinIO; private buckets issue short-lived (15 min) presigned URLs by the app's `storage.getSignedUrl`.
   - All storage_path fields in Postgres (product_images, invoices, qc_reports, backups, kyc_documents, etc.) are **provider-relative**; the provider decides how to render them, so no DB rows change.

4. Authentication:
   - Phase 1 keep Supabase Auth; the app still talks to supabase-js for login, the rest of the data goes direct to Dubai Postgres. Supabase emits JWTs that our Dubai Postgres accepts via a shared JWKS URL set as a Postgres GUC.
   - Phase 2 (optional, later) migrate to NextAuth with a Postgres session table + the existing WebAuthn / TOTP providers from SPEC §17. Document this as a separate change.

5. Networking and security:
   - Dubai Postgres listens only on the private network and the dedicated IP, with pg_hba.conf allowing only the Vercel egress IP range and the admin VPN.
   - Vercel's egress IP range is pinned via Vercel Secure Compute (or a static-egress add-on); without it, use an intermediate proxy on the Dubai DC that the app hits.
   - TLS 1.3 only, HSTS, modern cipher suite.
   - Database superuser is sealed; the app uses a role scoped to its schema; backup jobs use a read-only role.
   - Secrets in HashiCorp Vault (self-hosted on the DC) or 1Password for teams, injected into the Vercel environment via Vercel API from the DC on rotation.
   - Fail2ban on the nginx proxy, with an allowlist for Cloudflare's IP ranges.

6. Backups and PITR:
   - Nightly logical backup at 02:00 Dubai time, retained 30 days on local disk + 90 days off-site.
   - Continuous WAL archiving to the off-site S3 bucket; point-in-time recovery to any second in the last 7 days.
   - Automated restore test weekly: restore the latest backup to a scratch host, run `pnpm db:verify` (row-count checksum + a smoke-test query per table), wipe the scratch host. A failed test pages the on-call.
   - A quarterly full-DR drill: restore to the hot standby, cut traffic over, run for 10 minutes, cut back. Documented in docs/runbooks/dr.md.

7. Observability:
   - Prometheus + node_exporter + postgres_exporter + nginx_exporter on the DC.
   - Grafana dashboards: Postgres (QPS, slow queries, connection pool, replica lag), MinIO (bucket size, request rate, errors), nginx (latency p50/p95/p99, status-code mix), host (CPU, RAM, disk, I/O, NIC).
   - Alertmanager → PagerDuty / Opsgenie / webhook: replica lag > 30 s, free disk < 20%, Postgres down, SSL cert expiring in < 14 days, backup not completed in last 26 h, unusual connection count.
   - OpenTelemetry collector forwarding traces from the Next.js app to the DC Grafana Tempo.

8. Rollout plan:
   - Day 1: build the Dubai primary + replica + MinIO; confirm with a synthetic load.
   - Day 2: dry-run migration on a staging DB; measure downtime.
   - Day 3: scheduled maintenance window at 02:00 UTC (06:00 Dubai): put the app in read-only mode, final `pg_dump` + WAL ship, flip DATABASE_URL + STORAGE_* env vars on Vercel, lift read-only.
   - Day 4+: run both environments in parallel for one week with the old Supabase as hot-standby read-only; after a week, decommission.
   - Document everything in docs/runbooks/dubai-migration.md.

9. Settings and flags:
   - site_settings `infra.region` = 'dubai'
   - site_settings `infra.data_residency_statement` = 'UAE' (shown in the privacy page footer)
   - site_settings `infra.db_primary` and `infra.db_replica` (for the admin status page)
   - Admin → System health page shows DB primary/replica state, replica lag, last backup timestamp, last restore-test result, free disk.

10. Tests:
    - pgTAP suite runs against both Supabase and Dubai in CI until decommission.
    - Playwright: the storefront, admin, bulk import, and PWA golden paths all run green with DATABASE_URL pointing at Dubai.
    - Performance: a Lighthouse CI run on a buyer-portal page from a Dubai edge network returns an LCP at least 300 ms better than the Supabase baseline (co-located DB win).
    - Restore test is included in CI nightly, with its last-run status surfaced on /admin/system-health.

Done when: the production app runs with DATABASE_URL and STORAGE_S3_ENDPOINT pointing at your Dubai DC, with the Supabase project paused as a cold backup; nightly full + continuous WAL archive are proven restorable; /admin/system-health shows green on primary, replica, backup and restore-test; the privacy page footer states "Data stored in the UAE".
```

## Antigravity prompt 30-B — Stage 2: move the Next.js app to Dubai behind Cloudflare

```
Only run AFTER 30-A has been stable for at least 4 weeks and a DevOps on-call rotation exists.

1. Package the Next.js app as a Docker image (`next build && next start`, Node 20 LTS slim base).
2. Deploy on the Dubai DC behind nginx, with two app-server VMs for redundancy and a VIP in front for health-checked failover.
3. Put Cloudflare in front: CDN caching for /_next/static/*, /fonts/* (immutable; 1 year), /images/* (1 day with stale-while-revalidate), /api/* (no cache); WAF with OWASP core ruleset; rate limits by IP and by authenticated user id; Bot Management to block scrapers; Zero Trust Access to lock /admin to the staff VPN + Google OAuth.
4. CI/CD: GitHub Actions on push to main builds the Docker image, pushes to a private registry in the DC, SSHes to the two app VMs and rolls out with rolling update (drain-stop-start-check, one VM at a time). Smoke tests fail the rollout.
5. Blue/green: two app pools behind the VIP. Deploys go to the dark pool, smoke-test, then flip traffic. Revert = flip back.
6. Health checks: /api/health returns 200 iff DB reachable, Storage reachable, replica lag < 60 s, free disk > 15%.
7. Observability: same Grafana / Prometheus setup from 30-A, now with app-server metrics (requests, errors, latency, GC pauses), PM2 / Node process metrics, and application logs shipped to Loki.
8. Autoscaling (optional): add a 3rd app VM that is normally idle but brought online by Prometheus alerting when p95 latency exceeds 800 ms for 5 min.
9. Deploy preview URLs: PRs get a preview deployed to a staging subdomain in the DC with a seeded database snapshot.
10. Cancel the Vercel subscription once Dubai has run for 4 weeks without incident.

Done when: octopusb2b.com is served from Dubai through Cloudflare; a code push ships in under 10 minutes with rolling, zero-downtime deploys; /admin/system-health is green across all components; a planned 1-node failure drains traffic to the other with no user-visible impact; Vercel is decommissioned.
```

## Antigravity prompt 30-C — Stage 3: advanced features (HA, DR, zero-trust, multi-region)

```
Run after 30-B is stable, or in parallel if you have the ops capacity.

1. High availability
   - Streaming Postgres replication with automated failover via Patroni + etcd (3 nodes). Primary dies → replica promotes within 30 s; app reconnects via the floating virtual IP.
   - MinIO erasure-coded across 3+ nodes survives 1 node loss with no data loss.
   - Two network uplinks on the dedicated IP line, with BGP failover.
   - Dual-PSU on every production host, A/B feed from independent PDUs.

2. Disaster recovery
   - A warm DR site in another DC (e.g. Riyadh or Frankfurt) with continuous WAL shipping and nightly file sync; RPO 5 minutes, RTO 30 minutes.
   - Runbook docs/runbooks/dr.md tested quarterly: full failover to DR, verify, fail back.

3. Zero-trust
   - All staff traffic to the admin surface requires VPN + hardware security key (WebAuthn, per SPEC §17).
   - mTLS between the app server and Postgres.
   - Postgres row-level audit via pgaudit; log shipped to Loki with 1-year retention.
   - CIS Benchmarks Level 2 applied to every host.
   - Quarterly external pentest; findings tracked in /admin/security.

4. Multi-region read replicas
   - Hong Kong replica for the Shenzhen team — faster reads for admin/sourcing/support users identified by their staff account's region = 'CN'.
   - Singapore replica later, for Southeast Asian buyer traffic once it justifies it.
   - App uses DATABASE_URL (writes) and DATABASE_READ_URL (reads) with a lag-tolerant read-after-write guard on freshly written rows (sticky session for 30 s).

5. Advanced caching
   - Redis cluster (3 nodes) for session cache, assistant conversation context, rate-limit counters, pool-pledge counters (hot keys).
   - Cloudflare Workers KV for ultra-edge caching of category pages and hot product pages, invalidated by a Cloudflare webhook on content change.

6. Cost + capacity planning
   - Daily cost dashboard: compute-hour, network egress, storage used, backup storage.
   - Projection model: given today's QPS growth rate, when does the current hardware hit 70% utilisation? Alert at 180 days out.

7. Compliance artefacts
   - SOC 2 Type I readiness: control library mapped to the stack, with evidence collection on a /admin/compliance page.
   - UAE PDPL data-processing record auto-generated weekly as a PDF.
   - GDPR DSAR: a request form routes to a worker that exports or deletes a user's data within SLA; audit-logged.

Done when: a planned single-host failure in any component (DB primary, app VM, MinIO node, uplink) causes no measurable outage; the DR drill restores service in another DC within 30 minutes with less than 5 minutes of data loss; compliance artefacts are generated automatically and can be handed to an auditor the same day.
```

## My honest recommendation on sequencing

1. Run **30-A now** — the database and storage move is the real win and it's low-risk because Vercel keeps handling the app. Four weeks of weekend work for a solid DevOps-literate engineer. Data residency ✓, query speed ✓, backups you own ✓.
2. Keep Vercel for 2–3 months. Watch costs and incidents.
3. Run **30-B** when you've hired or assigned someone who owns on-call for the app layer. Don't skip this condition — ops burden is where DIY hosting fails.
4. Run **30-C** piece by piece as needed; HA and DR are the first priorities; multi-region replicas and Cloudflare Workers can wait until traffic justifies.

## What this doesn't change

- Users see no difference. The URL stays the same, the UX is identical.
- Code under `apps/web/app/` barely changes; the migration is almost entirely infrastructure + the `db.ts` and `storage.ts` providers.
- ADDON-26 (China fonts) and ADDON-28 (PWA) still apply unchanged — they're about client-side assets, not where the server runs.
