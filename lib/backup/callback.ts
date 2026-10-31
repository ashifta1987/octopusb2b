import 'server-only';
import { z } from 'zod';
import { verifySignature } from '@/lib/adapters';

/**
 * Workflow → app callback contract for POST /api/backups/status (SPEC §16.2). The body is signed with
 * BACKUP_CALLBACK_SECRET using the same "t=…,v1=…" HMAC-SHA256 scheme as lib/adapters signPayload (header Octopus-Signature).
 * The GitHub workflows sign with scripts/backup/lib.mjs signPayload (unit-tested for compatibility).
 */
const CHECK_KINDS = ['checksums', 'row_counts', 'ledger_balanced', 'migration_version', 'integration_keys', 'storage', 'other'] as const;
const RESTORE_STATUSES = ['draft', 'verifying', 'verified', 'pending_approval', 'approved', 'running', 'completed', 'failed', 'cancelled'] as const;

const check = z.object({
  kind: z.string().transform((k) => ((CHECK_KINDS as readonly string[]).includes(k) ? k : 'other')),
  status: z.enum(['pass', 'fail', 'note']),
  detail: z.string().max(2000).default(''),
  data: z.unknown().optional(),
});
export type RestoreCheck = z.infer<typeof check>;

const file = z.object({
  path: z.string().min(1),
  kind: z.string().optional(),
  bucket: z.string().nullable().optional(),
  size_bytes: z.union([z.number(), z.string()]).nullable().optional(),
  sha256: z.string().nullable().optional(),
});

const backupBody = z.object({
  type: z.literal('backup'),
  code: z.string().regex(/^BK-[0-9A-Z-]+$/),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().int().min(0).max(100).optional(),
  trigger: z.enum(['scheduled', 'manual', 'drill', 'retry']).optional(),
  retention_class: z.enum(['daily', 'weekly', 'monthly', 'manual']).optional(),
  size_bytes: z.number().nonnegative().optional(),
  location: z.string().max(500).optional(),
  manifest: z.record(z.string(), z.unknown()).optional(),
  files: z.array(file).optional(),
  checksum_ok: z.boolean().optional(),
  migration_version: z.string().max(200).optional(),
  error: z.string().max(4000).optional(),
  github_run_id: z.union([z.string(), z.number()]).transform(String).optional(),
  includes: z.record(z.string(), z.unknown()).optional(),
});

const restoreBody = z.object({
  type: z.literal('restore'),
  restore_id: z.uuid(),
  status: z.enum(RESTORE_STATUSES),
  checks: z.array(check).optional(),
  report: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(4000).optional(),
  github_run_id: z.union([z.string(), z.number()]).transform(String).optional(),
  phase: z.enum(['verify', 'post_restore', 'drill', 'backup']).optional(),
});

export const callbackBody = z.discriminatedUnion('type', [
  backupBody,
  restoreBody,
  z.object({ type: z.literal('retention_plan') }),
  z.object({ type: z.literal('mark_expired'), ids: z.array(z.uuid()).max(500) }),
  z.object({ type: z.literal('maintenance'), enabled: z.boolean(), message: z.string().max(500).optional(), retry_after: z.number().int().positive().optional() }),
  z.object({ type: z.literal('revalidate'), tags: z.array(z.string().max(100)).max(20).optional() }),
  z.object({ type: z.literal('drill_start'), force: z.boolean().optional(), backup_code: z.string().optional() }),
  z.object({ type: z.literal('restore_info'), restore_id: z.uuid() }),
  z.object({ type: z.literal('catalog'), op: z.enum(['export', 'import']), catalog: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional() }),
]);
export type CallbackBody = z.infer<typeof callbackBody>;

/** Cache tags revalidated after a restore (SPEC §16.3 step 4). */
export const RESTORE_TAGS = ['products', 'site-content', 'currency', 'ads', 'service-prices', 'suppliers'];

export type Parsed = { ok: true; body: CallbackBody } | { ok: false; status: number; error: string; issues?: unknown };

/** Verify the signature (5-minute replay window) and parse the body. */
export function parseCallback(raw: string, signature: string | null, secret: string | undefined): Parsed {
  if (!secret) return { ok: false, status: 503, error: 'CALLBACK_NOT_CONFIGURED' };
  if (!verifySignature(raw, signature, secret)) return { ok: false, status: 401, error: 'BAD_SIGNATURE' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: 'INVALID_JSON' };
  }
  if (json && typeof json === 'object' && !('type' in json) && 'action' in json) (json as Record<string, unknown>).type = (json as Record<string, unknown>).action;
  const r = callbackBody.safeParse(json);
  if (!r.success) return { ok: false, status: 422, error: 'INVALID_PAYLOAD', issues: r.error.issues.slice(0, 10) };
  return { ok: true, body: r.data };
}

type BackupBody = z.infer<typeof backupBody>;
type RestoreBody = z.infer<typeof restoreBody>;

/** backup_report(p_*) arguments. */
export function backupReportArgs(b: BackupBody) {
  return {
    p_code: b.code,
    p_status: b.status,
    p_progress: b.progress ?? null,
    p_trigger: b.trigger ?? null,
    p_retention_class: b.retention_class ?? null,
    p_size_bytes: b.size_bytes ?? null,
    p_location: b.location ?? null,
    p_manifest: b.manifest ?? null,
    p_files: b.files?.map((f) => ({ ...f, size_bytes: f.size_bytes == null ? null : Number(f.size_bytes) })) ?? null,
    p_checksum_ok: b.checksum_ok ?? null,
    p_migration_version: b.migration_version ?? null,
    p_error: b.error ?? null,
    p_github_run_id: b.github_run_id ?? null,
    p_includes: b.includes ?? null,
  };
}

/** restore_report(p_*) arguments. Phase defaults: verified → verify, completed/failed after a run → post_restore. */
export function restoreReportArgs(b: RestoreBody) {
  return {
    p_id: b.restore_id,
    p_status: b.status,
    p_checks: b.checks ?? null,
    p_report: b.report ?? null,
    p_error: b.error ?? null,
    p_github_run_id: b.github_run_id ?? null,
    p_phase: b.phase ?? (b.status === 'completed' || b.status === 'failed' ? 'post_restore' : 'verify'),
  };
}
